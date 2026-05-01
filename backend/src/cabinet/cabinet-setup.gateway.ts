import {
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import { Repository } from 'typeorm';
import WebSocket from 'ws';
import { CabinetSetupRealtimeService } from './cabinet-setup-realtime.service';
import { CaptureAgentRealtimeService } from '../capture-agent/capture-agent-realtime.service';
import { CaptureAgentIceService } from '../capture-agent/capture-agent-ice.service';
import { CabinetSetupSession } from './entities/cabinet-setup-session.entity';

@WebSocketGateway({
  path: '/cabinets/setup/ws',
})
export class CabinetSetupGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(CabinetSetupGateway.name);
  private readonly clientSessionMap = new WeakMap<WebSocket, string>();

  constructor(
    @InjectRepository(CabinetSetupSession)
    private readonly cabinetSetupSessionRepository: Repository<CabinetSetupSession>,
    private readonly cabinetSetupRealtimeService: CabinetSetupRealtimeService,
    private readonly captureAgentRealtimeService: CaptureAgentRealtimeService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly captureAgentIceService: CaptureAgentIceService,
  ) {}

  private send(client: WebSocket, payload: Record<string, unknown>) {
    if (client.readyState !== WebSocket.OPEN) {
      return;
    }

    client.send(JSON.stringify(payload));
  }

  private getJwtSecret() {
    return this.configService.get<string>('JWT_SECRET') || 'fallback_secret';
  }

  private parseRequest(request?: IncomingMessage) {
    const requestUrl = new URL(
      request?.url || '/',
      `http://${request?.headers.host || 'localhost'}`,
    );

    return {
      token: requestUrl.searchParams.get('token') || '',
      setupSessionId: requestUrl.searchParams.get('setupSessionId') || '',
    };
  }

  private async processClientMessage(client: WebSocket, raw: WebSocket.RawData) {
    const setupSessionId = this.clientSessionMap.get(client);
    if (!setupSessionId) {
      return;
    }

    try {
      const parsed = JSON.parse(raw.toString()) as {
        type?: string;
        payload?: Record<string, unknown>;
      };

      const session = await this.cabinetSetupSessionRepository.findOne({
        where: { id: setupSessionId },
        select: ['id', 'agentKey'],
      });

      this.cabinetSetupRealtimeService.updateSubscriberAgentKey(client, session?.agentKey);

      if (!session?.agentKey) {
        this.send(client, {
          type: 'preview.error',
          payload: { message: 'Capture agent для preview не підключено.' },
        });
        return;
      }

      if (parsed.type === 'preview.start') {
        const pairKey = String(parsed.payload?.pairKey || '').trim();
        if (!pairKey) {
          this.send(client, {
            type: 'preview.error',
            payload: { message: 'Не вказано pairKey для preview.' },
          });
          return;
        }

        const started = this.captureAgentRealtimeService.startContinuousPreview(session.agentKey, pairKey, {
          width: Number(parsed.payload?.width || 960),
          quality: Number(parsed.payload?.quality || 0.72),
          fps: Number(parsed.payload?.fps || 10),
          mimeType:
            typeof parsed.payload?.mimeType === 'string'
              ? parsed.payload.mimeType
              : 'image/webp',
        });

        if (!started) {
          this.send(client, {
            type: 'preview.error',
            payload: { message: 'Capture agent зараз офлайн або недоступний для preview.' },
          });
          return;
        }

        this.send(client, {
          type: 'preview.started',
          payload: { pairKey },
        });
        return;
      }

      if (parsed.type === 'preview.signal') {
        const pairKey = String(parsed.payload?.pairKey || '').trim();
        if (!pairKey) {
          this.send(client, {
            type: 'preview.error',
            payload: { message: 'Не вказано pairKey для WebRTC preview.' },
          });
          return;
        }

        const agentId = this.captureAgentRealtimeService.getAgentIdByKey(session.agentKey);
        if (!agentId) {
          this.send(client, {
            type: 'preview.error',
            payload: { message: 'Capture agent зараз офлайн або недоступний для preview.' },
          });
          return;
        }

        const iceConfig = this.captureAgentIceService.getIceServers();

        const forwarded = this.captureAgentRealtimeService.send(agentId, {
          type: 'agent.preview.signal',
          payload: {
            ...parsed.payload,
            setupSessionId,
            pairKey,
            iceServers: iceConfig.iceServers,
            iceTransportPolicy: iceConfig.iceTransportPolicy,
            iceCredentialExpiresAt: iceConfig.expiresAt,
          },
        });

        if (!forwarded) {
          this.send(client, {
            type: 'preview.error',
            payload: { message: 'Не вдалося передати WebRTC signal до capture agent.' },
          });
        }
        return;
      }

      if (parsed.type === 'preview.stop') {
        const pairKey = String(parsed.payload?.pairKey || '').trim() || undefined;
        this.captureAgentRealtimeService.stopContinuousPreview(session.agentKey, pairKey);

        const agentId = this.captureAgentRealtimeService.getAgentIdByKey(session.agentKey);
        if (agentId) {
          this.captureAgentRealtimeService.send(agentId, {
            type: 'agent.preview.stop',
            payload: {
              pairKey,
              setupSessionId,
            },
          });
        }

        this.send(client, { type: 'preview.stopped', payload: { pairKey } });
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не вдалося обробити preview-повідомлення.';
      this.send(client, { type: 'preview.error', payload: { message } });
    }
  }

  async handleConnection(client: WebSocket, ...args: unknown[]) {
    const request = args[0] as IncomingMessage | undefined;

    try {
      const { token, setupSessionId } = this.parseRequest(request);

      if (!token) {
        throw new UnauthorizedException('Відсутній токен доступу.');
      }

      if (!setupSessionId) {
        throw new UnauthorizedException('Не вказано setupSessionId.');
      }

      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        role?: string;
      }>(token, {
        secret: this.getJwtSecret(),
      });

      const session = await this.cabinetSetupSessionRepository.findOne({
        where: { id: setupSessionId },
        select: ['id', 'createdByUserId', 'agentKey'],
      });

      if (!session) {
        throw new UnauthorizedException('Setup-сесію не знайдено.');
      }

      if (session.createdByUserId !== payload.sub) {
        throw new ForbiddenException('Немає доступу до цієї setup-сесії.');
      }

      this.clientSessionMap.set(client, session.id);
      this.cabinetSetupRealtimeService.subscribe(session.id, client, session.agentKey);
      this.logger.log(`Cabinet setup subscriber connected: ${session.id}`);

      client.on('message', (raw) => {
        void this.processClientMessage(client, raw);
      });

      this.send(client, {
        type: 'setup.connected',
        payload: {
          setupSessionId: session.id,
          serverTime: new Date().toISOString(),
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Cabinet setup websocket unauthorized';
      this.logger.warn(`Cabinet setup subscriber rejected: ${message}`);
      client.close(1008, message);
    }
  }

  handleDisconnect(client: WebSocket) {
    const setupSessionId = this.clientSessionMap.get(client);
    if (setupSessionId) {
      void this.cabinetSetupSessionRepository
        .findOne({ where: { id: setupSessionId }, select: ['agentKey'] })
        .then((session) => {
          if (session?.agentKey) {
            this.captureAgentRealtimeService.stopContinuousPreview(session.agentKey);
          }
        })
        .catch(() => undefined);
    }
    this.cabinetSetupRealtimeService.unsubscribe(client);
  }
}
