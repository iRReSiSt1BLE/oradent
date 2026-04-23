import path from 'node:path';
import { app, BrowserWindow, clipboard, ipcMain, session } from 'electron';
import { getConfig, saveConfig } from './services/config-store';
import { enrollAgent, pingBackend } from './services/http-client';
import socketClient, { DeviceSyncSnapshot, SocketStatusPayload } from './services/socket-client';
import { enqueueRecordingUpload, flushRecordingQueue } from './services/recording-upload';
import { AgentConfig } from './state/default-config';

let mainWindow: BrowserWindow | null = null;

function broadcastSocketStatus(payload: SocketStatusPayload): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('agent:socket-status', payload);
}

function setupMediaPermissions(): void {
  const ses = session.defaultSession;

  ses.setPermissionCheckHandler((_webContents, permission) => permission === 'media');
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 920,
    minWidth: 880,
    minHeight: 760,
    backgroundColor: '#edf1f4',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  void mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'));
}

let queueFlushTimer: NodeJS.Timeout | null = null;

void app.whenReady().then(() => {
  setupMediaPermissions();
  socketClient.onStatus = (payload) => {
    broadcastSocketStatus(payload);
    if (payload.type === 'connected') {
      void flushRecordingQueue().catch(() => undefined);
    }
  };
  socketClient.onCommand = (payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('agent:socket-command', payload);
  };

  ipcMain.handle('agent:get-config', () => getConfig());
  ipcMain.handle('agent:save-config', (_event, payload: Partial<AgentConfig>) => saveConfig(payload));
  ipcMain.handle('agent:ping-backend', async () => pingBackend(getConfig()));
  ipcMain.handle('agent:enroll', async (_event, snapshot: DeviceSyncSnapshot) => {
    const config = getConfig();
    const enrolled = await enrollAgent(config, snapshot?.devices || [], snapshot?.devicePairs || []);
    const nextConfig = saveConfig({
      agentId: enrolled.agentId,
      agentKey: enrolled.agentKey,
      agentName: enrolled.agentName,
      agentToken: enrolled.accessToken,
      wsPath: enrolled.wsPath,
      heartbeatSeconds: enrolled.heartbeatSeconds,
      cabinetCode: enrolled.cabinetCode || config.cabinetCode,
      transportKey: enrolled.transportKey || config.transportKey,
    });

    return { ok: true, config: nextConfig, enrolled };
  });
  ipcMain.handle('agent:connect-socket', (_event, snapshot: DeviceSyncSnapshot) => {
    socketClient.connect(getConfig(), snapshot || { devices: [], devicePairs: [] });
    return { ok: true };
  });
  ipcMain.handle('agent:disconnect-socket', () => {
    socketClient.disconnect();
    return { ok: true };
  });
  ipcMain.handle('agent:copy-text', (_event, value: string) => {
    clipboard.writeText(String(value || ''));
    return { ok: true };
  });
  ipcMain.handle('agent:sync-snapshot', (_event, snapshot: DeviceSyncSnapshot) => {
    return { ok: socketClient.syncSnapshot(snapshot || { devices: [], devicePairs: [] }) };
  });
  ipcMain.handle('agent:preview-response', (_event, payload: Record<string, unknown>) => {
    return { ok: socketClient.sendPreviewResponse(payload || {}) };
  });
  ipcMain.handle('agent:preview-signal', (_event, payload: Record<string, unknown>) => {
    return { ok: socketClient.sendPreviewSignal(payload || {}) };
  });
  ipcMain.handle('agent:preview-frame', (_event, payload: Record<string, unknown>) => {
    return { ok: socketClient.sendPreviewFrame(payload || {}) };
  });
  ipcMain.handle('agent:queue-recording-upload', async (_event, payload: Record<string, unknown>) => {
    return enqueueRecordingUpload({
      appointmentId: String(payload.appointmentId || ''),
      cabinetDeviceId: typeof payload.cabinetDeviceId === 'string' ? payload.cabinetDeviceId : undefined,
      pairKey: typeof payload.pairKey === 'string' ? payload.pairKey : undefined,
      mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : undefined,
      originalFileName: typeof payload.originalFileName === 'string' ? payload.originalFileName : undefined,
      startedAt: typeof payload.startedAt === 'string' ? payload.startedAt : undefined,
      endedAt: typeof payload.endedAt === 'string' ? payload.endedAt : undefined,
      buffer: payload.buffer as ArrayBuffer,
    });
  });
  ipcMain.handle('agent:flush-recording-queue', async () => {
    return flushRecordingQueue();
  });

  if (queueFlushTimer) {
    clearInterval(queueFlushTimer);
  }
  queueFlushTimer = setInterval(() => {
    void flushRecordingQueue().catch(() => undefined);
  }, 5000);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (queueFlushTimer) {
    clearInterval(queueFlushTimer);
  }
  queueFlushTimer = setInterval(() => {
    void flushRecordingQueue().catch(() => undefined);
  }, 5000);

  createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (queueFlushTimer) {
    clearInterval(queueFlushTimer);
    queueFlushTimer = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
