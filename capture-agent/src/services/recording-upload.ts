import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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

export type BeginRecordingUploadInput = {
  appointmentId: string;
  cabinetDeviceId?: string;
  pairKey?: string;
  mimeType?: string;
  originalFileName?: string;
  startedAt?: string;
};

export type AppendRecordingChunkInput = {
  entryId: string;
  buffer: ArrayBuffer;
};

export type FinalizeRecordingUploadInput = {
  entryId: string;
  endedAt?: string;
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

type RawRecordingMeta = {
  entryId: string;
  appointmentId: string;
  cabinetDeviceId: string | null;
  pairKey: string | null;
  mimeType: string;
  originalFileName: string;
  startedAt: string | null;
  createdAt: string;
  rawFileName: string;
  totalBytes: number;
};

export type RecoverInterruptedRecordingUploadsResult = {
  ok: boolean;
  recoveredCount: number;
  uploadedCount: number;
  queuedCount: number;
  failedCount: number;
};

const LEGACY_DEFAULT_TRANSPORT_SECRET = 'oradent-capture-transport';
const LOCAL_ENV_TRANSPORT_SECRET = process.env.CAPTURE_AGENT_TRANSPORT_KEY || process.env.ORADENT_CAPTURE_TRANSPORT_KEY || '';
const MAX_RAW_RECORDING_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_QUEUE_UPLOAD_ATTEMPTS_PER_FLUSH = 1;

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function queueDir(): string {
  const dir = path.join(app.getPath('userData'), 'recording-queue');
  ensureDir(dir);
  return dir;
}

function entryPaths(entryId: string): { metaPath: string; binPath: string; rawMetaPath: string; rawPath: string } {
  const dir = queueDir();
  return {
    metaPath: path.join(dir, `${entryId}.json`),
    binPath: path.join(dir, `${entryId}.bin`),
    rawMetaPath: path.join(dir, `${entryId}.raw.json`),
    rawPath: path.join(dir, `${entryId}.raw.webm`),
  };
}

function transportKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

function normalizeBackendUrl(value: string): string {
  return String(value || '').trim().replace(/\/$/, '');
}

function normalizeNullable(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function readRawMeta(entryId: string): RawRecordingMeta {
  const { rawMetaPath } = entryPaths(entryId);
  if (!fs.existsSync(rawMetaPath)) {
    throw new Error(`Raw recording metadata not found: ${entryId}`);
  }
  return JSON.parse(fs.readFileSync(rawMetaPath, 'utf-8')) as RawRecordingMeta;
}

function writeRawMeta(meta: RawRecordingMeta): void {
  const { rawMetaPath } = entryPaths(meta.entryId);
  ensureDir(path.dirname(rawMetaPath));
  fs.writeFileSync(rawMetaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

async function resolveTransportSecret(): Promise<{ secret: string; hint: 'configured' | 'default' }> {
  let config = getConfig();
  let transportSecret = String(config.transportKey || LOCAL_ENV_TRANSPORT_SECRET || '').trim();
  if (transportSecret === LEGACY_DEFAULT_TRANSPORT_SECRET) {
    transportSecret = '';
  }

  if (config.agentToken && !transportSecret) {
    const response = await getAgentTransportSecret(config);
    if (response.transportKey) {
      config = saveConfig({ transportKey: response.transportKey });
      transportSecret = response.transportKey;
    }
  }

  if (!transportSecret) {
    throw new Error('Не задано transportKey для доказового завантаження відео. Перереєструй агента або налаштуй CAPTURE_AGENT_TRANSPORT_KEY на backend.');
  }

  return {
    secret: transportSecret,
    hint: 'configured',
  };
}

async function encryptRawFileToQueue(
  rawPath: string,
  binPath: string,
  secret: string,
): Promise<{ sha256Hash: string; transportIv: string; transportAuthTag: string }> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', transportKey(secret), iv);
  const hash = createHash('sha256');

  const hashTransform = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk as Buffer);
      callback(null, chunk);
    },
  });

  await pipeline(
    fs.createReadStream(rawPath),
    hashTransform,
    cipher,
    fs.createWriteStream(binPath),
  );

  return {
    sha256Hash: hash.digest('hex'),
    transportIv: iv.toString('base64'),
    transportAuthTag: cipher.getAuthTag().toString('base64'),
  };
}

function deleteEntry(entryId: string): void {
  const { metaPath, binPath, rawMetaPath, rawPath } = entryPaths(entryId);
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  if (fs.existsSync(binPath)) fs.unlinkSync(binPath);
  if (fs.existsSync(rawMetaPath)) fs.unlinkSync(rawMetaPath);
  if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
}

function multipartField(boundary: string, name: string, value: string): string {
  return `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
}

function multipartFileHeader(boundary: string, name: string, fileName: string, contentType: string): string {
  const safeFileName = fileName.replace(/"/g, '');
  return `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${safeFileName}"\r\nContent-Type: ${contentType}\r\n\r\n`;
}

function requestMultipartUpload(
  urlString: string,
  agentToken: string,
  fields: Record<string, string>,
  file: { fieldName: string; fileName: string; filePath: string; contentType: string },
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const boundary = `----OradentAgentBoundary${randomUUID().replace(/-/g, '')}`;
    const client = url.protocol === 'https:' ? https : http;

    const request = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'x-agent-token': agentToken,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'transfer-encoding': 'chunked',
      },
    }, (response) => {
      const chunks: Buffer[] = [];

      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      response.on('end', () => {
        resolve({
          statusCode: response.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });

    request.on('error', reject);

    Object.entries(fields).forEach(([name, value]) => {
      request.write(multipartField(boundary, name, value));
    });

    request.write(multipartFileHeader(boundary, file.fieldName, file.fileName, file.contentType));

    const fileStream = fs.createReadStream(file.filePath);
    fileStream.on('error', (error) => {
      request.destroy(error);
    });

    fileStream.on('end', () => {
      request.write(`\r\n--${boundary}--\r\n`);
      request.end();
    });

    fileStream.pipe(request, { end: false });
  });
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

  const fields: Record<string, string> = {
    appointmentId: meta.appointmentId,
    mimeType: meta.mimeType,
    originalFileName: meta.originalFileName,
    sha256Hash: meta.sha256Hash,
    transportIv: meta.transportIv,
    transportAuthTag: meta.transportAuthTag,
  };

  if (meta.cabinetDeviceId) fields.cabinetDeviceId = meta.cabinetDeviceId;
  if (meta.pairKey) fields.pairKey = meta.pairKey;
  if (meta.startedAt) fields.startedAt = meta.startedAt;
  if (meta.endedAt) fields.endedAt = meta.endedAt;

  const response = await requestMultipartUpload(
    `${normalizeBackendUrl(config.backendUrl)}/video/agent-upload`,
    config.agentToken,
    fields,
    {
      fieldName: 'video',
      fileName: meta.encryptedFileName,
      filePath: binPath,
      contentType: 'application/octet-stream',
    },
  );

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const unrecoverableTransportError = [400, 401, 403].includes(response.statusCode)
      && /розшифрувати|decrypt|transport|SHA-256|auth/i.test(response.body);

    if (unrecoverableTransportError) {
      deleteEntry(meta.entryId);
      return true;
    }

    return false;
  }

  return true;
}

export async function beginRecordingUpload(input: BeginRecordingUploadInput): Promise<{ ok: boolean; entryId: string }> {
  const entryId = randomUUID();
  const meta: RawRecordingMeta = {
    entryId,
    appointmentId: String(input.appointmentId || '').trim(),
    cabinetDeviceId: normalizeNullable(input.cabinetDeviceId),
    pairKey: normalizeNullable(input.pairKey),
    mimeType: String(input.mimeType || 'video/webm').trim() || 'video/webm',
    originalFileName: String(input.originalFileName || `appointment-${input.appointmentId}.webm`).trim(),
    startedAt: normalizeNullable(input.startedAt),
    createdAt: new Date().toISOString(),
    rawFileName: `${entryId}.raw.webm`,
    totalBytes: 0,
  };

  if (!meta.appointmentId) {
    throw new Error('Cannot start recording queue: appointmentId is missing.');
  }

  const { rawPath, rawMetaPath } = entryPaths(entryId);
  ensureDir(path.dirname(rawPath));
  fs.writeFileSync(rawPath, Buffer.alloc(0));
  fs.writeFileSync(rawMetaPath, JSON.stringify(meta, null, 2), 'utf-8');

  return { ok: true, entryId };
}

export async function appendRecordingChunk(input: AppendRecordingChunkInput): Promise<{ ok: boolean; totalBytes: number }> {
  const entryId = String(input.entryId || '').trim();
  if (!entryId) {
    throw new Error('Cannot append recording chunk: entryId is missing.');
  }

  const meta = readRawMeta(entryId);
  const { rawPath } = entryPaths(entryId);
  const buffer = Buffer.from(input.buffer);

  if (!buffer.byteLength) {
    return { ok: true, totalBytes: meta.totalBytes };
  }

  const nextTotal = Number(meta.totalBytes || 0) + buffer.byteLength;
  if (nextTotal > MAX_RAW_RECORDING_BYTES) {
    throw new Error('Recording file exceeded the local safety limit.');
  }

  fs.appendFileSync(rawPath, buffer);
  meta.totalBytes = nextTotal;
  writeRawMeta(meta);

  return { ok: true, totalBytes: nextTotal };
}

export async function finalizeRecordingUpload(input: FinalizeRecordingUploadInput): Promise<{ ok: boolean; queued: boolean; uploaded: boolean; entryId: string; sha256Hash: string; totalBytes: number }> {
  const entryId = String(input.entryId || '').trim();
  if (!entryId) {
    throw new Error('Cannot finalize recording queue: entryId is missing.');
  }

  const rawMeta = readRawMeta(entryId);
  const { rawPath, rawMetaPath, metaPath, binPath } = entryPaths(entryId);

  if (!fs.existsSync(rawPath)) {
    throw new Error(`Raw recording file not found: ${entryId}`);
  }

  const { secret, hint } = await resolveTransportSecret();
  const encrypted = await encryptRawFileToQueue(rawPath, binPath, secret);

  const meta: QueueEntryMeta = {
    entryId,
    transportKeyHint: hint,
    appointmentId: rawMeta.appointmentId,
    cabinetDeviceId: rawMeta.cabinetDeviceId,
    pairKey: rawMeta.pairKey,
    mimeType: rawMeta.mimeType,
    originalFileName: rawMeta.originalFileName,
    startedAt: rawMeta.startedAt,
    endedAt: normalizeNullable(input.endedAt),
    sha256Hash: encrypted.sha256Hash,
    transportIv: encrypted.transportIv,
    transportAuthTag: encrypted.transportAuthTag,
    createdAt: rawMeta.createdAt,
    encryptedFileName: `recording-${entryId}.bin`,
  };

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

  if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
  if (fs.existsSync(rawMetaPath)) fs.unlinkSync(rawMetaPath);

  let uploaded = false;
  try {
    uploaded = await uploadEntry(meta);
  } catch {
    uploaded = false;
  }

  if (uploaded) {
    deleteEntry(entryId);
  }

  return { ok: true, queued: true, uploaded, entryId, sha256Hash: meta.sha256Hash, totalBytes: rawMeta.totalBytes };
}

export async function discardRecordingUpload(entryId: string): Promise<{ ok: boolean }> {
  const normalized = String(entryId || '').trim();
  if (normalized) {
    deleteEntry(normalized);
  }

  return { ok: true };
}

export async function recoverInterruptedRecordingUploads(maxEntries = 5): Promise<RecoverInterruptedRecordingUploadsResult> {
  const dir = queueDir();
  const rawMetaFiles = fs.readdirSync(dir)
    .filter((fileName) => fileName.endsWith('.raw.json'))
    .sort()
    .slice(0, Math.max(1, maxEntries));

  let recoveredCount = 0;
  let uploadedCount = 0;
  let queuedCount = 0;
  let failedCount = 0;

  for (const fileName of rawMetaFiles) {
    const entryId = fileName.replace(/\.raw\.json$/, '');
    const paths = entryPaths(entryId);

    try {
      if (!fs.existsSync(paths.rawPath)) {
        if (fs.existsSync(paths.rawMetaPath)) fs.unlinkSync(paths.rawMetaPath);
        failedCount += 1;
        continue;
      }

      const rawSize = fs.statSync(paths.rawPath).size;
      if (rawSize <= 0) {
        deleteEntry(entryId);
        failedCount += 1;
        continue;
      }

      const finalized = await finalizeRecordingUpload({
        entryId,
        endedAt: new Date().toISOString(),
      });

      recoveredCount += 1;
      if (finalized.uploaded) {
        uploadedCount += 1;
      } else {
        queuedCount += 1;
      }
    } catch {
      failedCount += 1;
    }
  }

  return {
    ok: true,
    recoveredCount,
    uploadedCount,
    queuedCount,
    failedCount,
  };
}

export async function enqueueRecordingUpload(input: QueueRecordingUploadInput): Promise<{ ok: boolean; queued: boolean; uploaded: boolean; entryId: string; sha256Hash: string; totalBytes: number }> {
  const started = await beginRecordingUpload({
    appointmentId: input.appointmentId,
    cabinetDeviceId: input.cabinetDeviceId,
    pairKey: input.pairKey,
    mimeType: input.mimeType,
    originalFileName: input.originalFileName,
    startedAt: input.startedAt,
  });

  await appendRecordingChunk({
    entryId: started.entryId,
    buffer: input.buffer,
  });

  return finalizeRecordingUpload({
    entryId: started.entryId,
    endedAt: input.endedAt,
  });
}

export async function flushRecordingQueue(maxEntries = MAX_QUEUE_UPLOAD_ATTEMPTS_PER_FLUSH): Promise<{ ok: boolean; uploadedCount: number; pendingCount: number }> {
  const dir = queueDir();
  const entries = fs.readdirSync(dir)
    .filter((fileName) => fileName.endsWith('.json') && !fileName.endsWith('.raw.json'))
    .sort()
    .slice(0, Math.max(1, maxEntries));

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
