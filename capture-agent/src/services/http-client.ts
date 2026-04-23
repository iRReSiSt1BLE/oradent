import { AgentConfig } from '../state/default-config';
import { DevicePairSnapshot, RawDeviceSnapshot } from './socket-client';

export type PingResponse = {
  ok: boolean;
  service?: string;
  time?: string;
};

export type EnrollResponse = {
  ok: boolean;
  agentId: string;
  agentKey: string;
  agentName: string;
  cabinetId: string | null;
  cabinetCode?: string | null;
  accessToken: string;
  wsPath: string;
  heartbeatSeconds: number;
  transportKey?: string;
};

function normalizeBackendUrl(value: string): string {
  return value.trim().replace(/\/$/, '');
}

function getValidatedBackendUrl(config: AgentConfig): string {
  const value = normalizeBackendUrl(config.backendUrl);
  if (!value) {
    throw new Error('Не задано адресу backend для агента.');
  }

  const url = new URL(value);
  const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

  if (url.protocol === 'http:' && !isLocalhost) {
    throw new Error('Для віддаленого сервера дозволено тільки HTTPS.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Backend URL має починатися з http:// або https://');
  }

  return value;
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message?: unknown }).message || 'Запит завершився помилкою.')
        : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return body as T;
}

export async function pingBackend(config: AgentConfig): Promise<PingResponse> {
  const baseUrl = getValidatedBackendUrl(config);
  return requestJson<PingResponse>(`${baseUrl}/capture-agent/ping`, {
    method: 'GET',
  });
}

export async function enrollAgent(
  config: AgentConfig,
  devices: RawDeviceSnapshot[],
  devicePairs: DevicePairSnapshot[],
): Promise<EnrollResponse> {
  const baseUrl = getValidatedBackendUrl(config);

  return requestJson<EnrollResponse>(`${baseUrl}/capture-agent/enroll`, {
    method: 'POST',
    body: JSON.stringify({
      agentKey: config.agentKey || undefined,
      agentName: config.agentName,
      cabinetCode: config.cabinetCode,
      appVersion: '1.0.0',
      devices,
      devicePairs,
    }),
  });
}

export async function getAgentTransportSecret(config: AgentConfig): Promise<{ transportKey: string }> {
  const baseUrl = getValidatedBackendUrl(config);
  if (!config.agentToken) {
    throw new Error('Немає agent token для отримання transport key.');
  }

  return requestJson<{ transportKey: string }>(`${baseUrl}/capture-agent/transport-secret`, {
    method: 'GET',
    headers: {
      'x-agent-token': config.agentToken,
    },
  });
}
