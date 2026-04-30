import { Logger, UnauthorizedException } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import WebSocket from 'ws';
import { CabinetSetupRealtimeService } from '../cabinet/cabinet-setup-realtime.service';
import { AppointmentPreviewFrameStore } from './appointment-preview-frame.store';
import { CaptureAgentRealtimeService } from './capture-agent-realtime.service';
import { CaptureAgentService } from './capture-agent.service';
import { CaptureAgentPreviewSignalingService } from './capture-agent-preview-signaling.service';

const PREVIEW_BINARY_MAGIC = Buffer.from('OPF1');

type BinaryPreviewPacket = {
  metadata: {
    pairKey?: string;
    mimeType?: string;
    capturedAt?: string;
  };
  imageBytes: Uint8Array;
};

function toBuffer(raw: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(raw)) {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw);
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw.map((chunk) => Buffer.from(chunk)));
  }
  return Buffer.from(raw as any);
}

function parseBinaryPreviewPacket(raw: WebSocket.RawData): BinaryPreviewPacket | null {
  const buffer = toBuffer(raw);
  const headerLength = PREVIEW_BINARY_MAGIC.length + 4;

  if (buffer.length <= headerLength || !buffer.subarray(0, PREVIEW_BINARY_MAGIC.length).equals(PREVIEW_BINARY_MAGIC)) {
    return null;
  }

  const metadataLength = buffer.readUInt32BE(PREVIEW_BINARY_MAGIC.length);
  const metadataStart = headerLength;
  const metadataEnd = metadataStart + metadataLength;

  if (metadataLength <= 0 || metadataEnd > buffer.length) {
    return null;
  }

  const metadata = JSON.parse(buffer.subarray(metadataStart, metadataEnd).toString('utf8')) as BinaryPreviewPacket['metadata'];
  const imageBytes = buffer.subarray(metadataEnd);
  if (!imageBytes.length) {
    return null;
  }

  return {
    metadata,
    imageBytes: new Uint8Array(imageBytes),
  };
}

function buildDataUrl(imageBytes: Uint8Array, mimeType?: string): string {
  const normalizedMimeType = String(mimeType || 'image/webp').trim() || 'image/webp';
  return `data:${normalizedMimeType};base64,${Buffer.from(imageBytes).toString('base64')}`;
}

@WebSocketGateway({
  path: '/capture-agent/ws',
})
export class CaptureAgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CaptureAgentGateway.name);
  private readonly clientAgentMap = new WeakMap<WebSocket, string>();

  constructor(
    private readonly captureAgentService: CaptureAgentService,
    private readonly captureAgentRealtimeService: CaptureAgentRealtimeService,
    private readonly cabinetSetupRealtimeService: CabinetSetupRealtimeService,
    private readonly appointmentPreviewFrameStore: AppointmentPreviewFrameStore,
    private readonly previewSignalingService: CaptureAgentPreviewSignalingService,
  ) {}

  private send(client: WebSocket, payload: unknown): void {
    if (client.readyState !== WebSocket.OPEN) {
      return;
    }
    client.send(JSON.stringify(payload));
  }

  private parseIp(request?: any): string | null {
    const forwardedForHeader = request?.headers?.['x-forwarded-for'];
    if (typeof forwardedForHeader === 'string') {
      return forwardedForHeader.split(',')[0]?.trim() || null;
    }
    if (Array.isArray(forwardedForHeader)) {
      return forwardedForHeader[0]?.trim() || null;
    }
    return request?.socket?.remoteAddress || null;
  }

  private rememberPreviewFrame(agentId: string, payload: { pairKey?: string; imageDataUrl?: string; mimeType?: string; capturedAt?: string }): void {
    const agentKey = this.captureAgentRealtimeService.getAgentKeyById(agentId);
    if (!agentKey || !payload.pairKey || !payload.imageDataUrl) {
      return;
    }

    this.appointmentPreviewFrameStore.setFrame({
      agentKey,
      pairKey: payload.pairKey,
      imageDataUrl: payload.imageDataUrl,
      mimeType: payload.mimeType,
      capturedAt: payload.capturedAt,
    });
  }

  private async processMessage(client: WebSocket, raw: WebSocket.RawData): Promise<void> {
    const agentId = this.clientAgentMap.get(client);
    if (!agentId) {
      this.send(client, {
        type: 'agent.error',
        payload: { message: 'Агента не ідентифіковано' },
      });
      client.close(1008, 'Unknown agent');
      return;
    }

    try {
      const binaryPreviewPacket = parseBinaryPreviewPacket(raw);
      if (binaryPreviewPacket) {
        const agentKey = this.captureAgentRealtimeService.getAgentKeyById(agentId);
        this.appointmentPreviewFrameStore.setFrame({
          agentKey: String(agentKey || ''),
          pairKey: String(binaryPreviewPacket.metadata.pairKey || ''),
          imageDataUrl: buildDataUrl(binaryPreviewPacket.imageBytes, binaryPreviewPacket.metadata.mimeType),
          mimeType: binaryPreviewPacket.metadata.mimeType,
          capturedAt: binaryPreviewPacket.metadata.capturedAt,
        });

        await this.cabinetSetupRealtimeService.relayPreviewFrameByAgentKey(
          agentKey,
          {
            type: 'preview.frame',
            pairKey: binaryPreviewPacket.metadata.pairKey,
            mimeType: binaryPreviewPacket.metadata.mimeType,
            capturedAt: binaryPreviewPacket.metadata.capturedAt,
          },
          binaryPreviewPacket.imageBytes,
        );
        return;
      }

      const parsed = JSON.parse(toBuffer(raw).toString()) as { type?: string; payload?: Record<string, unknown> };
      const messageType = parsed.type || '';

      if (messageType === 'agent.hello') {
        await this.captureAgentService.processHello(agentId, {
          agentName: typeof parsed.payload?.agentName === 'string' ? parsed.payload.agentName : undefined,
          cabinetCode: typeof parsed.payload?.cabinetCode === 'string' ? parsed.payload.cabinetCode : undefined,
          appVersion: typeof parsed.payload?.appVersion === 'string' ? parsed.payload.appVersion : undefined,
          devices: Array.isArray(parsed.payload?.devices) ? (parsed.payload.devices as any[]) : undefined,
          devicePairs: Array.isArray(parsed.payload?.devicePairs) ? (parsed.payload.devicePairs as any[]) : undefined,
        });
        this.send(client, {
          type: 'agent.ready',
          payload: { message: 'Агента успішно синхронізовано з backend' },
        });
        return;
      }

      if (messageType === 'agent.heartbeat') {
        await this.captureAgentService.touchHeartbeat(agentId);
        this.send(client, {
          type: 'agent.heartbeat.ack',
          payload: { serverTime: new Date().toISOString() },
        });
        return;
      }

      if (messageType === 'agent.preview.frame') {
        const payload = {
          pairKey: typeof parsed.payload?.pairKey === 'string' ? parsed.payload.pairKey : undefined,
          imageDataUrl: typeof parsed.payload?.imageDataUrl === 'string' ? parsed.payload.imageDataUrl : undefined,
          mimeType: typeof parsed.payload?.mimeType === 'string' ? parsed.payload.mimeType : undefined,
          capturedAt: typeof parsed.payload?.capturedAt === 'string' ? parsed.payload.capturedAt : undefined,
        };

        this.rememberPreviewFrame(agentId, payload);
        const agentKey = this.captureAgentRealtimeService.getAgentKeyById(agentId);
        await this.cabinetSetupRealtimeService.relayPreviewFrameByAgentKey(agentKey, {
          type: 'preview.frame',
          payload,
        });
        return;
      }

      if (messageType === 'agent.preview.response') {
        this.captureAgentRealtimeService.resolvePreviewResponse(agentId, {
          requestId: typeof parsed.payload?.requestId === 'string' ? parsed.payload.requestId : undefined,
          pairKey: typeof parsed.payload?.pairKey === 'string' ? parsed.payload.pairKey : undefined,
          imageDataUrl: typeof parsed.payload?.imageDataUrl === 'string' ? parsed.payload.imageDataUrl : undefined,
          mimeType: typeof parsed.payload?.mimeType === 'string' ? parsed.payload.mimeType : undefined,
          capturedAt: typeof parsed.payload?.capturedAt === 'string' ? parsed.payload.capturedAt : undefined,
          error: typeof parsed.payload?.error === 'string' ? parsed.payload.error : undefined,
        });
        return;
      }

      if (messageType === 'agent.recording.state') {
        await this.captureAgentRealtimeService.updateRecordingState(agentId, parsed.payload || {});
        this.logger.log(`Recording state from agent ${agentId}: ${JSON.stringify(parsed.payload || {})}`);
        return;
      }

      if (messageType === 'agent.preview.signal') {
        const previewSessionId = typeof parsed.payload?.previewSessionId === 'string' ? parsed.payload.previewSessionId.trim() : '';
        if (previewSessionId) {
          this.previewSignalingService.relayFromAgent(agentId, {
            pairKey: typeof parsed.payload?.pairKey === 'string' ? parsed.payload.pairKey : undefined,
            description: parsed.payload && typeof parsed.payload.description === 'object' ? parsed.payload.description : undefined,
            candidate: parsed.payload && typeof parsed.payload.candidate === 'object' ? parsed.payload.candidate : undefined,
            error: typeof parsed.payload?.error === 'string' ? parsed.payload.error : undefined,
            previewSessionId,
          });
          return;
        }

        const setupSessionId = typeof parsed.payload?.setupSessionId === 'string' ? parsed.payload.setupSessionId.trim() : '';
        if (!setupSessionId) {
          return;
        }

        this.cabinetSetupRealtimeService.sendToSetupSession(setupSessionId, {
          type: 'preview.signal',
          payload: {
            pairKey: typeof parsed.payload?.pairKey === 'string' ? parsed.payload.pairKey : undefined,
            description: parsed.payload && typeof parsed.payload.description === 'object' ? parsed.payload.description : undefined,
            candidate: parsed.payload && typeof parsed.payload.candidate === 'object' ? parsed.payload.candidate : undefined,
            error: typeof parsed.payload?.error === 'string' ? parsed.payload.error : undefined,
            setupSessionId,
          },
        });
        return;
      }

      if (messageType === 'agent.devices.sync') {
        await this.captureAgentService.syncSnapshot(
          agentId,
          Array.isArray(parsed.payload?.devices) ? (parsed.payload.devices as any[]) : [],
          Array.isArray(parsed.payload?.devicePairs) ? (parsed.payload.devicePairs as any[]) : [],
        );
        this.send(client, {
          type: 'agent.devices.synced',
          payload: { message: 'Список пристроїв і пар синхронізовано' },
        });
        return;
      }

      this.send(client, {
        type: 'agent.unhandled',
        payload: { message: `Команда ${messageType || 'unknown'} ще не обробляється backend-ом` },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown websocket error';
      if (agentId) {
        await this.captureAgentService.markError(agentId, errorMessage);
      }
      this.send(client, {
        type: 'agent.error',
        payload: { message: errorMessage },
      });
    }
  }

  async handleConnection(client: WebSocket, ...args: any[]): Promise<void> {
    const request = args[0];
    try {
      const rawAgentToken = request?.headers?.['x-agent-token'];
      const agentToken = Array.isArray(rawAgentToken) ? rawAgentToken[0] : rawAgentToken;
      const agent = await this.captureAgentService.validateAgentToken(agentToken);
      this.clientAgentMap.set(client, agent.id);
      this.captureAgentRealtimeService.register(agent.id, agent.agentKey, client);
      await this.captureAgentService.markConnected(agent.id, this.parseIp(request));
      this.logger.log(`Capture agent connected: ${agent.name} (${agent.id})`);
      this.send(client, {
        type: 'server.connected',
        payload: {
          agentId: agent.id,
          message: 'Backend websocket зʼєднання встановлено',
        },
      });
      client.on('message', (raw) => {
        void this.processMessage(client, raw);
      });
    } catch (error) {
      const errorMessage =
        error instanceof UnauthorizedException
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Unauthorized capture agent';
      this.logger.warn(`Capture agent rejected: ${errorMessage}`);
      client.close(1008, errorMessage);
    }
  }

  async handleDisconnect(client: WebSocket): Promise<void> {
    const mappedAgentId = this.clientAgentMap.get(client);
    const agentKeyBeforeUnregister = mappedAgentId ? this.captureAgentRealtimeService.getAgentKeyById(mappedAgentId) : null;
    const unregisteredAgentId = this.captureAgentRealtimeService.unregister(client);
    const agentId = mappedAgentId || unregisteredAgentId;
    if (!agentId) {
      return;
    }

    if (agentKeyBeforeUnregister) {
      this.appointmentPreviewFrameStore.clearFrame(agentKeyBeforeUnregister);
    }

    await this.captureAgentService.markDisconnected(agentId);
    this.logger.log(`Capture agent disconnected: ${agentId}`);
  }
}
