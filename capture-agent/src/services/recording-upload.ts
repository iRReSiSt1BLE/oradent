import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createHash, randomUUID } from 'node:crypto';
import { app } from 'electron';
import { getConfig, saveConfig } from './config-store';
import { getAgentTransportSecret } from './http-client';

export type QueueRecordingUploadInput = {
  appointmentId: string;
  cabinetDeviceId?: string;
  pairKey?: string;
  mimeType?: string;
  originalFileName?: string;
  startedAt?: string;
  endedAt?: string;
  buffer: ArrayBuffer;
};

type QueueEntryMeta = {
  transportKeyHint: 'configured' | 'default';
  entryId: string;
  appointmentId: string;
  cabinetDeviceId: string | null;
  pairKey: string | null;
  mimeType: string;
  originalFileName: string;
  startedAt: string | null;
  endedAt: string | null;
  sha256Hash: string;
  transportIv: string;
  transportAuthTag: string;
  createdAt: string;
  encryptedFileName: string;
};

const DEFAULT_SECRET = process.env.CAPTURE_AGENT_TRANSPORT_KEY || process.env.ORADENT_CAPTURE_TRANSPORT_KEY || 'oradent-capture-transport';

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function queueDir(): string {
  const dir = path.join(app.getPath('userData'), 'recording-queue');
  ensureDir(dir);
  return dir;
}

function entryPaths(entryId: string): { metaPath: string; binPath: string } {
  const dir = queueDir();
  return {
    metaPath: path.join(dir, `${entryId}.json`),
    binPath: path.join(dir, `${entryId}.bin`),
  };
}

function transportKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

function encryptForTransport(buffer: Buffer, secret: string): { encryptedBuffer: Buffer; ivBase64: string; authTagBase64: string } {
  const iv = Buffer.from(Array.from({ length: 12 }, () => Math.floor(Math.random() * 256)));
  const cipher = createCipheriv('aes-256-gcm', transportKey(secret), iv);
  const encryptedBuffer = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedBuffer,
    ivBase64: iv.toString('base64'),
    authTagBase64: authTag.toString('base64'),
  };
}

function normalizeBackendUrl(value: string): string {
  return String(value || '').trim().replace(/\/$/, '');
}

async function uploadEntry(meta: QueueEntryMeta): Promise<boolean> {
  const config = getConfig();
  if (!config.backendUrl || !config.agentToken) {
    return false;
  }

  const { binPath } = entryPaths(meta.entryId);
  if (!fs.existsSync(binPath)) {
    throw new Error(`Queue binary not found: ${binPath}`);
  }

  const encryptedBuffer = fs.readFileSync(binPath);
  const form = new FormData();
  const blob = new Blob([encryptedBuffer], { type: 'application/octet-stream' });
  form.append('video', blob, meta.encryptedFileName);
  form.append('appointmentId', meta.appointmentId);
  if (meta.cabinetDeviceId) form.append('cabinetDeviceId', meta.cabinetDeviceId);
  if (meta.pairKey) form.append('pairKey', meta.pairKey);
  form.append('mimeType', meta.mimeType);
  form.append('originalFileName', meta.originalFileName);
  if (meta.startedAt) form.append('startedAt', meta.startedAt);
  if (meta.endedAt) form.append('endedAt', meta.endedAt);
  form.append('sha256Hash', meta.sha256Hash);
  form.append('transportIv', meta.transportIv);
  form.append('transportAuthTag', meta.transportAuthTag);

  const response = await fetch(`${normalizeBackendUrl(config.backendUrl)}/video/agent-upload`, {
    method: 'POST',
    headers: {
      'x-agent-token': config.agentToken,
    },
    body: form,
  });

  if (!response.ok) {
    return false;
  }

  return true;
}

function deleteEntry(entryId: string): void {
  const { metaPath, binPath } = entryPaths(entryId);
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  if (fs.existsSync(binPath)) fs.unlinkSync(binPath);
}

export async function enqueueRecordingUpload(input: QueueRecordingUploadInput): Promise<{ ok: boolean; queued: boolean; uploaded: boolean; entryId: string }> {
  let config = getConfig();
  let transportSecret = String(config.transportKey || DEFAULT_SECRET);

  if (config.agentToken && (!config.transportKey || config.transportKey === DEFAULT_SECRET)) {
    try {
      const response = await getAgentTransportSecret(config);
      if (response.transportKey) {
        config = saveConfig({ transportKey: response.transportKey });
        transportSecret = response.transportKey;
      }
    } catch {
      transportSecret = String(config.transportKey || DEFAULT_SECRET);
    }
  }

  const plainBuffer = Buffer.from(input.buffer);
  const entryId = randomUUID();
  const sha256Hash = createHash('sha256').update(plainBuffer).digest('hex');
  const encrypted = encryptForTransport(plainBuffer, transportSecret);
  const meta: QueueEntryMeta = {
    entryId,
    transportKeyHint: transportSecret === DEFAULT_SECRET ? 'default' : 'configured',
    appointmentId: input.appointmentId,
    cabinetDeviceId: input.cabinetDeviceId?.trim() || null,
    pairKey: input.pairKey?.trim() || null,
    mimeType: input.mimeType?.trim() || 'video/webm',
    originalFileName: input.originalFileName?.trim() || `appointment-${input.appointmentId}.webm`,
    startedAt: input.startedAt?.trim() || null,
    endedAt: input.endedAt?.trim() || null,
    sha256Hash,
    transportIv: encrypted.ivBase64,
    transportAuthTag: encrypted.authTagBase64,
    createdAt: new Date().toISOString(),
    encryptedFileName: `recording-${entryId}.bin`,
  };

  const { metaPath, binPath } = entryPaths(entryId);
  ensureDir(path.dirname(metaPath));
  fs.writeFileSync(binPath, encrypted.encryptedBuffer);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

  let uploaded = false;
  try {
    uploaded = await uploadEntry(meta);
  } catch {
    uploaded = false;
  }

  if (uploaded) {
    deleteEntry(entryId);
  }

  return { ok: true, queued: true, uploaded, entryId };
}

export async function flushRecordingQueue(): Promise<{ ok: boolean; uploadedCount: number; pendingCount: number }> {
  const dir = queueDir();
  const entries = fs.readdirSync(dir)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort();

  let uploadedCount = 0;
  let pendingCount = 0;

  for (const fileName of entries) {
    const fullPath = path.join(dir, fileName);
    try {
      const meta = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as QueueEntryMeta;
      const uploaded = await uploadEntry(meta);
      if (uploaded) {
        deleteEntry(meta.entryId);
        uploadedCount += 1;
      } else {
        pendingCount += 1;
      }
    } catch {
      pendingCount += 1;
    }
  }

  return { ok: true, uploadedCount, pendingCount };
}
