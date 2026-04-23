import { AgentConfig } from '../state/default-config';
import { EnrollResponse, PingResponse } from '../services/http-client';
import { DeviceSyncSnapshot, SocketCommandPayload, SocketStatusPayload } from '../services/socket-client';

declare global {
  interface Window {
    agentApi: {
      getConfig(): Promise<AgentConfig>;
      saveConfig(payload: Partial<AgentConfig>): Promise<AgentConfig>;
      pingBackend(): Promise<PingResponse>;
      enroll(snapshot: DeviceSyncSnapshot): Promise<{ ok: boolean; config: AgentConfig; enrolled: EnrollResponse }>;
      connectSocket(snapshot: DeviceSyncSnapshot): Promise<{ ok: boolean }>;
      disconnectSocket(): Promise<{ ok: boolean }>;
      copyText(value: string): Promise<{ ok: boolean }>;
      syncSnapshot(snapshot: DeviceSyncSnapshot): Promise<{ ok: boolean }>;
      sendPreviewResponse(payload: Record<string, unknown>): Promise<{ ok: boolean }>;
      sendPreviewSignal(payload: Record<string, unknown>): Promise<{ ok: boolean }>;
      sendPreviewFrame(payload: Record<string, unknown>): Promise<{ ok: boolean }>;
      queueRecordingUpload(payload: Record<string, unknown>): Promise<{ ok: boolean; queued: boolean; uploaded: boolean; entryId: string }>;
      flushRecordingQueue(): Promise<{ ok: boolean; uploadedCount: number; pendingCount: number }>;
      onSocketStatus(callback: (payload: SocketStatusPayload) => void): () => void;
      onSocketCommand(callback: (payload: SocketCommandPayload) => void): () => void;
    };
  }
}

export {};
