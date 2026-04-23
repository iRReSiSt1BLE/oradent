import WebSocket from 'ws';
import { AgentConfig } from '../state/default-config';

export type RawDeviceSnapshot = {
  kind: 'videoinput' | 'audioinput';
  deviceId: string;
  label: string | null;
};

export type DevicePairSnapshot = {
  pairKey: string;
  displayName: string | null;
  videoDeviceId: string;
  videoLabel: string | null;
  audioDeviceId: string;
  audioLabel: string | null;
  sortOrder: number;
};

export type DeviceSyncSnapshot = {
  devices: RawDeviceSnapshot[];
  devicePairs: DevicePairSnapshot[];
};

export type SocketStatusPayload = {
  type: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'message';
  message: string;
};

export type SocketCommandPayload =
  | { type: 'preview.request'; payload: Record<string, unknown> }
  | { type: 'preview.start'; payload: Record<string, unknown> }
  | { type: 'preview.stop'; payload: Record<string, unknown> }
  | { type: 'preview.signal'; payload: Record<string, unknown> }
  | { type: 'recording.start'; payload: Record<string, unknown> }
  | { type: 'recording.stop'; payload: Record<string, unknown> };

const PREVIEW_BINARY_MAGIC = Buffer.from('OPF1');

function buildPreviewBinaryPacket(payload: Record<string, unknown>): Buffer | null {
  const rawImageBytes = payload.imageBytes;
  let imageBytes: Uint8Array | null = null;

  if (rawImageBytes instanceof Uint8Array) {
    imageBytes = rawImageBytes;
  } else if (rawImageBytes instanceof ArrayBuffer) {
    imageBytes = new Uint8Array(rawImageBytes);
  } else if (Array.isArray(rawImageBytes)) {
    imageBytes = Uint8Array.from(rawImageBytes);
  }

  if (!imageBytes?.length) {
    return null;
  }

  const metadata = {
    pairKey: typeof payload.pairKey === 'string' ? payload.pairKey : undefined,
    mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : undefined,
    capturedAt: typeof payload.capturedAt === 'string' ? payload.capturedAt : undefined,
  };

  const metaBytes = Buffer.from(JSON.stringify(metadata), 'utf8');
  const header = Buffer.allocUnsafe(PREVIEW_BINARY_MAGIC.length + 4);
  PREVIEW_BINARY_MAGIC.copy(header, 0);
  header.writeUInt32BE(metaBytes.length, PREVIEW_BINARY_MAGIC.length);
  return Buffer.concat([header, metaBytes, Buffer.from(imageBytes)]);
}

function normalizeBackendUrl(value: string): string {
  return value.trim().replace(/\/$/, '');
}

function buildWsBaseUrl(backendUrl: string): string {
  const url = new URL(normalizeBackendUrl(backendUrl));
  const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

  if (url.protocol === 'https:') {
    url.protocol = 'wss:';
    return url.toString().replace(/\/$/, '');
  }

  if (url.protocol === 'http:' && isLocalhost) {
    url.protocol = 'ws:';
    return url.toString().replace(/\/$/, '');
  }

  throw new Error('Для віддаленого сервера websocket дозволено тільки через WSS.');
}

class SocketClient {
  private socket: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private manualDisconnect = false;
  private lastConfig: AgentConfig | null = null;
  private lastSnapshot: DeviceSyncSnapshot = { devices: [], devicePairs: [] };
  onStatus: (payload: SocketStatusPayload) => void = () => undefined;
  onCommand: (payload: SocketCommandPayload) => void = () => undefined;

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(config: AgentConfig): void {
    this.stopHeartbeat();
    const intervalMs = Math.max(5, Number(config.heartbeatSeconds || 15)) * 1000;
    this.heartbeatTimer = setInterval(() => {
      this.send({
        type: 'agent.heartbeat',
        payload: { sentAt: new Date().toISOString() },
      });
    }, intervalMs);
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect || !this.lastConfig?.agentToken) {
      return;
    }

    this.stopReconnect();
    this.reconnectAttempts += 1;
    const delayMs = Math.min(10000, 1500 * this.reconnectAttempts);
    this.onStatus({ type: 'connecting', message: `Повторне підключення через ${Math.round(delayMs / 1000)} с…` });

    this.reconnectTimer = setTimeout(() => {
      if (!this.lastConfig) {
        return;
      }

      try {
        this.connect(this.lastConfig, this.lastSnapshot);
      } catch (error) {
        this.onStatus({
          type: 'error',
          message: error instanceof Error ? error.message : 'Не вдалося перепідключити websocket.',
        });
      }
    }, delayMs);
  }

  connect(config: AgentConfig, snapshot: DeviceSyncSnapshot): void {
    this.manualDisconnect = false;
    this.stopReconnect();
    this.stopHeartbeat();

    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.close();
      } catch {
        // noop
      }
      this.socket = null;
    }

    if (!config.agentToken) {
      throw new Error('Немає agent token. Спочатку зареєструй агента.');
    }

    this.lastConfig = config;
    this.lastSnapshot = snapshot;

    const base = buildWsBaseUrl(config.backendUrl);
    const wsPath = config.wsPath || '/capture-agent/ws';
    const url = `${base}${wsPath}`;

    this.onStatus({ type: 'connecting', message: `Підключення до ${url}` });

    this.socket = new WebSocket(url, {
      headers: {
        'x-agent-token': config.agentToken,
      },
      perMessageDeflate: false,
      handshakeTimeout: 10000,
    });

    this.socket.on('open', () => {
      this.reconnectAttempts = 0;
      this.onStatus({ type: 'connected', message: 'WebSocket підключено.' });
      this.send({
        type: 'agent.hello',
        payload: {
          agentName: config.agentName,
          cabinetCode: config.cabinetCode,
          appVersion: '0.7.0',
          devices: snapshot.devices,
          devicePairs: snapshot.devicePairs,
        },
      });
      this.startHeartbeat(config);
    });

    this.socket.on('message', (raw: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(raw.toString()) as { type?: string; payload?: Record<string, unknown> };

        if (parsed.type === 'agent.preview.request') {
          this.onCommand({ type: 'preview.request', payload: parsed.payload || {} });
          return;
        }

        if (parsed.type === 'agent.preview.start') {
          this.onCommand({ type: 'preview.start', payload: parsed.payload || {} });
          return;
        }

        if (parsed.type === 'agent.preview.stop') {
          this.onCommand({ type: 'preview.stop', payload: parsed.payload || {} });
          return;
        }


        if (parsed.type === 'agent.recording.start') {
          this.onCommand({ type: 'recording.start', payload: parsed.payload || {} });
          return;
        }

        if (parsed.type === 'agent.recording.stop') {
          this.onCommand({ type: 'recording.stop', payload: parsed.payload || {} });
          return;
        }

        if (parsed.type === 'agent.preview.signal') {
          this.onCommand({ type: 'preview.signal', payload: parsed.payload || {} });
          return;
        }

        if (parsed.type === 'agent.error') {
          this.onStatus({ type: 'error', message: String(parsed.payload?.message || 'Помилка websocket') });
          return;
        }

        if (parsed.type === 'agent.ready') {
          this.onStatus({ type: 'connected', message: String(parsed.payload?.message || 'Агента синхронізовано') });
          return;
        }

        if (parsed.type === 'agent.devices.synced') {
          this.onStatus({ type: 'message', message: String(parsed.payload?.message || 'Пристрої синхронізовано') });
          return;
        }

        if (parsed.type === 'server.connected' || parsed.type === 'agent.heartbeat.ack') {
          return;
        }

        this.onStatus({ type: 'message', message: `Отримано: ${raw.toString()}` });
      } catch {
        this.onStatus({ type: 'message', message: `Отримано: ${raw.toString()}` });
      }
    });

    this.socket.on('close', () => {
      this.stopHeartbeat();
      this.socket = null;
      if (this.manualDisconnect) {
        this.onStatus({ type: 'disconnected', message: 'WebSocket відключено.' });
        return;
      }
      this.onStatus({ type: 'error', message: 'Зʼєднання втрачено.' });
      this.scheduleReconnect();
    });

    this.socket.on('error', (error: Error) => {
      this.onStatus({ type: 'error', message: error.message || 'WebSocket error' });
    });
  }

  syncSnapshot(snapshot: DeviceSyncSnapshot): boolean {
    this.lastSnapshot = snapshot;
    return this.send({
      type: 'agent.devices.sync',
      payload: snapshot,
    });
  }

  sendPreviewResponse(payload: Record<string, unknown>): boolean {
    return this.send({
      type: 'agent.preview.response',
      payload: payload || {},
    });
  }

  sendPreviewSignal(payload: Record<string, unknown>): boolean {
    return this.send({
      type: 'agent.preview.signal',
      payload: payload || {},
    });
  }

  sendPreviewFrame(payload: Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    const bufferedAmount = Number((this.socket as WebSocket & { bufferedAmount?: number }).bufferedAmount || 0);
    if (bufferedAmount > 512 * 1024) {
      return false;
    }

    const binaryPacket = buildPreviewBinaryPacket(payload || {});
    if (binaryPacket) {
      this.socket.send(binaryPacket);
      return true;
    }

    this.socket.send(
      JSON.stringify({
        type: 'agent.preview.frame',
        payload: payload || {},
      }),
    );
    return true;
  }

  private send(data: unknown): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.socket.send(JSON.stringify(data));
    return true;
  }

  disconnect(): void {
    this.manualDisconnect = true;
    this.stopReconnect();
    this.stopHeartbeat();
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // noop
      }
      this.socket = null;
    }
  }
}

export default new SocketClient();
