import { Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import { AppointmentPreviewService } from './appointment-preview.service';
import { CaptureAgentPreviewSignalingService } from './capture-agent-preview-signaling.service';
import { CaptureAgentRealtimeService } from './capture-agent-realtime.service';
import { CaptureAgentIceService } from './capture-agent-ice.service';

type JwtPreviewUser = {
  id: string;
  email?: string;
  role?: string;
  patientId?: string | null;
};

@WebSocketGateway({ path: '/capture-agent/preview/ws' })
export class CaptureAgentPreviewGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CaptureAgentPreviewGateway.name);
  private readonly usersByClient = new WeakMap<WebSocket, JwtPreviewUser>();
  private readonly sessionsByClient = new WeakMap<WebSocket, Map<string, { agentId: string; pairKey: string }>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly appointmentPreviewService: AppointmentPreviewService,
    private readonly captureAgentRealtimeService: CaptureAgentRealtimeService,
    private readonly previewSignalingService: CaptureAgentPreviewSignalingService,
    private readonly captureAgentIceService: CaptureAgentIceService,
  ) {}

  private send(client: WebSocket, payload: Record<string, unknown>): void {
    if (client.readyState !== WebSocket.OPEN) return;
    client.send(JSON.stringify(payload));
  }

  private getJwtSecret(): string {
    return this.configService.get<string>('JWT_SECRET') || 'fallback_secret';
  }

  private parseRequest(request?: IncomingMessage) {
    const requestUrl = new URL(
      request?.url || '/',
      `http://${request?.headers.host || 'localhost'}`,
    );

    return {
      token: requestUrl.searchParams.get('token') || '',
    };
  }

  private async authenticate(request?: IncomingMessage): Promise<JwtPreviewUser> {
    const { token } = this.parseRequest(request);
    if (!token) {
      throw new UnauthorizedException('Відсутній token для preview websocket.');
    }

    const payload = await this.jwtService.verifyAsync<{ sub: string; email?: string; role?: string; patientId?: string | null }>(token, {
      secret: this.getJwtSecret(),
    });

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      patientId: payload.patientId ?? null,
    };
  }

  private rememberSession(client: WebSocket, sessionId: string, agentId: string, pairKey: string): void {
    const sessions = this.sessionsByClient.get(client) || new Map<string, { agentId: string; pairKey: string }>();
    sessions.set(sessionId, { agentId, pairKey });
    this.sessionsByClient.set(client, sessions);
  }

  private forgetSession(client: WebSocket, sessionId: string): void {
    this.sessionsByClient.get(client)?.delete(sessionId);
    this.previewSignalingService.removeSession(sessionId);
  }

  private async handleOffer(client: WebSocket, payload: Record<string, unknown>): Promise<void> {
    const user = this.usersByClient.get(client);
    if (!user) throw new UnauthorizedException('Preview websocket не авторизовано.');

    const description = payload.description && typeof payload.description === 'object' ? payload.description : null;
    if (!description) {
      throw new Error('Не передано WebRTC offer.');
    }

    const appointmentId = typeof payload.appointmentId === 'string' ? payload.appointmentId.trim() : '';
    const cabinetDeviceId = typeof payload.cabinetDeviceId === 'string' ? payload.cabinetDeviceId.trim() : '';
    const cabinetId = typeof payload.cabinetId === 'string' ? payload.cabinetId.trim() : '';
    const pairKey = typeof payload.pairKey === 'string' ? payload.pairKey.trim() : '';

    const target = appointmentId
      ? await this.appointmentPreviewService.resolveWebRtcAppointmentPreviewTarget(user, appointmentId, cabinetDeviceId)
      : await this.appointmentPreviewService.resolveWebRtcCabinetPreviewTarget(user, cabinetId, pairKey);

    const session = this.previewSignalingService.createSession(client, target.agentId, target.pairKey);
    this.rememberSession(client, session.id, target.agentId, target.pairKey);

    const iceConfig = this.captureAgentIceService.getIceServers();

    const sent = this.captureAgentRealtimeService.send(target.agentId, {
      type: 'agent.preview.signal',
      payload: {
        previewSessionId: session.id,
        pairKey: target.pairKey,
        description,
        appointmentId: appointmentId || undefined,
        cabinetDeviceId: cabinetDeviceId || undefined,
        cabinetId: cabinetId || undefined,
        iceServers: iceConfig.iceServers,
        iceTransportPolicy: iceConfig.iceTransportPolicy,
        iceCredentialExpiresAt: iceConfig.expiresAt,
      },
    });

    if (!sent) {
      this.forgetSession(client, session.id);
      throw new Error('Capture agent зараз офлайн або недоступний для WebRTC preview.');
    }

    this.send(client, {
      type: 'preview.session',
      payload: {
        previewSessionId: session.id,
        pairKey: target.pairKey,
        iceServers: iceConfig.iceServers,
        iceTransportPolicy: iceConfig.iceTransportPolicy,
        iceCredentialExpiresAt: iceConfig.expiresAt,
      },
    });
  }

  private handleIce(client: WebSocket, payload: Record<string, unknown>): void {
    const previewSessionId = typeof payload.previewSessionId === 'string' ? payload.previewSessionId.trim() : '';
    const candidate = payload.candidate && typeof payload.candidate === 'object' ? payload.candidate : null;
    if (!previewSessionId || !candidate) return;

    const session = this.sessionsByClient.get(client)?.get(previewSessionId);
    if (!session) return;

    this.captureAgentRealtimeService.send(session.agentId, {
      type: 'agent.preview.signal',
      payload: {
        previewSessionId,
        pairKey: session.pairKey,
        candidate,
      },
    });
  }

  private handleStop(client: WebSocket, payload: Record<string, unknown>): void {
    const previewSessionId = typeof payload.previewSessionId === 'string' ? payload.previewSessionId.trim() : '';
    if (!previewSessionId) return;

    const session = this.sessionsByClient.get(client)?.get(previewSessionId);
    if (session) {
      this.captureAgentRealtimeService.send(session.agentId, {
        type: 'agent.preview.stop',
        payload: {
          previewSessionId,
          pairKey: session.pairKey,
        },
      });
    }

    this.forgetSession(client, previewSessionId);
    this.send(client, { type: 'preview.stopped', payload: { previewSessionId } });
  }

  private async processMessage(client: WebSocket, raw: WebSocket.RawData): Promise<void> {
    const parsed = JSON.parse(raw.toString()) as { type?: string; payload?: Record<string, unknown> };
    const payload = parsed.payload || {};

    if (parsed.type === 'preview.offer') {
      await this.handleOffer(client, payload);
      return;
    }

    if (parsed.type === 'preview.ice') {
      this.handleIce(client, payload);
      return;
    }

    if (parsed.type === 'preview.stop') {
      this.handleStop(client, payload);
      return;
    }

    this.send(client, { type: 'preview.unhandled', payload: { message: parsed.type || 'unknown' } });
  }

  async handleConnection(client: WebSocket, ...args: any[]): Promise<void> {
    const request = args[0] as IncomingMessage | undefined;
    try {
      const user = await this.authenticate(request);
      this.usersByClient.set(client, user);
      this.send(client, { type: 'preview.connected', payload: { serverTime: new Date().toISOString() } });

      client.on('message', (raw) => {
        void this.processMessage(client, raw).catch((error) => {
          const message = error instanceof Error ? error.message : 'Preview websocket error.';
          this.send(client, { type: 'preview.error', payload: { message } });
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Preview websocket auth error.';
      this.logger.warn(message);
      this.send(client, { type: 'preview.error', payload: { message } });
      client.close(1008, 'Unauthorized');
    }
  }

  handleDisconnect(client: WebSocket): void {
    const sessions = this.sessionsByClient.get(client);
    if (sessions?.size) {
      for (const [sessionId, session] of [...sessions.entries()]) {
        this.captureAgentRealtimeService.send(session.agentId, {
          type: 'agent.preview.stop',
          payload: { previewSessionId: sessionId, pairKey: session.pairKey },
        });
        this.previewSignalingService.removeSession(sessionId);
      }
      sessions.clear();
    }

    this.previewSignalingService.removeClient(client);
  }
}
