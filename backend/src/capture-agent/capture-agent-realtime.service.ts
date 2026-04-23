import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

export type PreviewRequestPayload = {
  requestId: string;
  pairKey: string;
  width?: number;
  quality?: number;
  fps?: number;
  mimeType?: string;
};

export type PreviewResponsePayload = {
  requestId?: string;
  pairKey?: string;
  imageDataUrl?: string;
  mimeType?: string;
  capturedAt?: string;
  error?: string;
};

type PendingPreviewRequest = {
  agentId: string;
  resolve: (payload: PreviewResponsePayload) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

@Injectable()
export class CaptureAgentRealtimeService {
  private readonly agentSockets = new Map<string, WebSocket>();
  private readonly socketAgents = new WeakMap<WebSocket, string>();
  private readonly agentKeysById = new Map<string, string>();
  private readonly agentIdsByKey = new Map<string, string>();
  private readonly pendingPreviewRequests = new Map<string, PendingPreviewRequest>();

  register(agentId: string, agentKey: string, client: WebSocket) {
    const previous = this.agentSockets.get(agentId);
    if (previous && previous !== client) {
      try {
        previous.close();
      } catch {
        // noop
      }
    }

    this.agentSockets.set(agentId, client);
    this.socketAgents.set(client, agentId);
    const normalizedAgentKey = (agentKey || '').trim();
    if (normalizedAgentKey) {
      this.agentKeysById.set(agentId, normalizedAgentKey);
      this.agentIdsByKey.set(normalizedAgentKey, agentId);
    }
  }

  unregister(client: WebSocket) {
    const agentId = this.socketAgents.get(client);
    if (!agentId) {
      return null;
    }

    const activeClient = this.agentSockets.get(agentId);
    if (activeClient === client) {
      this.agentSockets.delete(agentId);
    }

    const agentKey = this.agentKeysById.get(agentId);
    if (agentKey) {
      this.agentKeysById.delete(agentId);
      this.agentIdsByKey.delete(agentKey);
    }

    for (const [requestId, pending] of [...this.pendingPreviewRequests.entries()]) {
      if (pending.agentId !== agentId) {
        continue;
      }

      clearTimeout(pending.timer);
      pending.reject(new Error('Зʼєднання з capture agent втрачено.'));
      this.pendingPreviewRequests.delete(requestId);
    }

    return agentId;
  }

  send(agentId: string, payload: Record<string, unknown>) {
    const client = this.agentSockets.get(agentId);
    if (!client || client.readyState !== WebSocket.OPEN) {
      return false;
    }

    client.send(JSON.stringify(payload));
    return true;
  }

  getAgentIdByKey(agentKey: string | null | undefined) {
    const normalizedAgentKey = (agentKey || '').trim();
    if (!normalizedAgentKey) {
      return null;
    }

    return this.agentIdsByKey.get(normalizedAgentKey) || null;
  }

  getAgentKeyById(agentId: string | null | undefined) {
    const normalizedAgentId = (agentId || '').trim();
    if (!normalizedAgentId) {
      return null;
    }

    return this.agentKeysById.get(normalizedAgentId) || null;
  }

  startContinuousPreview(
    agentKey: string,
    pairKey: string,
    options?: { width?: number; quality?: number; fps?: number; mimeType?: string },
  ) {
    const agentId = this.getAgentIdByKey(agentKey);
    if (!agentId) {
      return false;
    }

    return this.send(agentId, {
      type: 'agent.preview.start',
      payload: {
        pairKey,
        width: options?.width,
        quality: options?.quality,
        fps: options?.fps,
        mimeType: options?.mimeType,
      },
    });
  }

  stopContinuousPreview(agentKey: string, pairKey?: string) {
    const agentId = this.getAgentIdByKey(agentKey);
    if (!agentId) {
      return false;
    }

    return this.send(agentId, {
      type: 'agent.preview.stop',
      payload: { pairKey },
    });
  }

  async requestPreview(
    agentId: string,
    pairKey: string,
    options?: { width?: number; quality?: number; timeoutMs?: number },
  ) {
    const requestId = randomUUID();
    const timeoutMs = Math.max(1000, Number(options?.timeoutMs || 6000));

    const sent = this.send(agentId, {
      type: 'agent.preview.request',
      payload: {
        requestId,
        pairKey,
        width: options?.width,
        quality: options?.quality,
      },
    });

    if (!sent) {
      throw new Error('Capture agent зараз офлайн або недоступний для preview.');
    }

    return new Promise<PreviewResponsePayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPreviewRequests.delete(requestId);
        reject(new Error('Capture agent не повернув preview вчасно.'));
      }, timeoutMs);

      this.pendingPreviewRequests.set(requestId, {
        agentId,
        resolve,
        reject,
        timer,
      });
    });
  }

  resolvePreviewResponse(agentId: string, payload: PreviewResponsePayload) {
    const requestId = String(payload.requestId || '').trim();
    if (!requestId) {
      return false;
    }

    const pending = this.pendingPreviewRequests.get(requestId);
    if (!pending || pending.agentId !== agentId) {
      return false;
    }

    clearTimeout(pending.timer);
    this.pendingPreviewRequests.delete(requestId);

    if (payload.error) {
      pending.reject(new Error(payload.error));
      return true;
    }

    pending.resolve(payload);
    return true;
  }
}
