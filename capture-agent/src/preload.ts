import { contextBridge, ipcRenderer } from 'electron';
import { AgentConfig } from './state/default-config';
import { EnrollResponse, PingResponse } from './services/http-client';
import { DeviceSyncSnapshot, SocketCommandPayload, SocketStatusPayload } from './services/socket-client';

contextBridge.exposeInMainWorld('agentApi', {
  getConfig: () => ipcRenderer.invoke('agent:get-config') as Promise<AgentConfig>,
  saveConfig: (payload: Partial<AgentConfig>) =>
    ipcRenderer.invoke('agent:save-config', payload) as Promise<AgentConfig>,
  pingBackend: () => ipcRenderer.invoke('agent:ping-backend') as Promise<PingResponse>,
  enroll: (snapshot: DeviceSyncSnapshot) =>
    ipcRenderer.invoke('agent:enroll', snapshot) as Promise<{
      ok: boolean;
      config: AgentConfig;
      enrolled: EnrollResponse;
    }>,
  connectSocket: (snapshot: DeviceSyncSnapshot) =>
    ipcRenderer.invoke('agent:connect-socket', snapshot) as Promise<{ ok: boolean }>,
  disconnectSocket: () => ipcRenderer.invoke('agent:disconnect-socket') as Promise<{ ok: boolean }>,
  copyText: (value: string) => ipcRenderer.invoke('agent:copy-text', value) as Promise<{ ok: boolean }>,
  syncSnapshot: (snapshot: DeviceSyncSnapshot) =>
    ipcRenderer.invoke('agent:sync-snapshot', snapshot) as Promise<{ ok: boolean }>,
  sendPreviewResponse: (payload: Record<string, unknown>) =>
    ipcRenderer.invoke('agent:preview-response', payload) as Promise<{ ok: boolean }>,
  sendPreviewSignal: (payload: Record<string, unknown>) =>
    ipcRenderer.invoke('agent:preview-signal', payload) as Promise<{ ok: boolean }>,
  sendPreviewFrame: (payload: Record<string, unknown>) =>
    ipcRenderer.invoke('agent:preview-frame', payload) as Promise<{ ok: boolean }>,
  sendRecordingState: (payload: Record<string, unknown>) =>
    ipcRenderer.invoke('agent:recording-state', payload) as Promise<{ ok: boolean }>,
  queueRecordingUpload: (payload: Record<string, unknown>) =>
    ipcRenderer.invoke('agent:queue-recording-upload', payload) as Promise<{ ok: boolean; queued: boolean; uploaded: boolean; entryId: string }>,
  beginRecordingUpload: (payload: Record<string, unknown>) =>
    ipcRenderer.invoke('agent:begin-recording-upload', payload) as Promise<{ ok: boolean; entryId: string }>,
  appendRecordingChunk: (payload: Record<string, unknown>) =>
    ipcRenderer.invoke('agent:append-recording-chunk', payload) as Promise<{ ok: boolean; totalBytes: number }>,
  finalizeRecordingUpload: (payload: Record<string, unknown>) =>
    ipcRenderer.invoke('agent:finalize-recording-upload', payload) as Promise<{ ok: boolean; queued: boolean; uploaded: boolean; entryId: string; sha256Hash?: string; totalBytes?: number }>,
  discardRecordingUpload: (payload: Record<string, unknown>) =>
    ipcRenderer.invoke('agent:discard-recording-upload', payload) as Promise<{ ok: boolean }>,
  flushRecordingQueue: () =>
    ipcRenderer.invoke('agent:flush-recording-queue') as Promise<{ ok: boolean; uploadedCount: number; pendingCount: number }>,
  recoverInterruptedRecordings: () =>
    ipcRenderer.invoke('agent:recover-interrupted-recordings') as Promise<{ ok: boolean; recoveredCount: number; uploadedCount: number; queuedCount: number; failedCount: number }>,
  onSocketStatus: (callback: (payload: SocketStatusPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: SocketStatusPayload) => callback(payload);
    ipcRenderer.on('agent:socket-status', handler);
    return () => ipcRenderer.removeListener('agent:socket-status', handler);
  },
  onSocketCommand: (callback: (payload: SocketCommandPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: SocketCommandPayload) => callback(payload);
    ipcRenderer.on('agent:socket-command', handler);
    return () => ipcRenderer.removeListener('agent:socket-command', handler);
  },
});
