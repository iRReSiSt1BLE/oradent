import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

type PreviewSession = {
  id: string;
  client: WebSocket;
  agentId: string;
  pairKey: string;
  createdAt: Date;
};

@Injectable()
export class CaptureAgentPreviewSignalingService {
  private readonly sessions = new Map<string, PreviewSession>();
  private readonly sessionIdsByClient = new WeakMap<WebSocket, Set<string>>();

  createSession(client: WebSocket, agentId: string, pairKey: string): PreviewSession {
    const session: PreviewSession = {
      id: randomUUID(),
      client,
      agentId,
      pairKey,
      createdAt: new Date(),
    };

    this.sessions.set(session.id, session);
    const clientSessions = this.sessionIdsByClient.get(client) || new Set<string>();
    clientSessions.add(session.id);
    this.sessionIdsByClient.set(client, clientSessions);
    return session;
  }

  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.sessions.delete(sessionId);
    const clientSessions = this.sessionIdsByClient.get(session.client);
    if (clientSessions) {
      clientSessions.delete(sessionId);
    }
  }

  removeClient(client: WebSocket): void {
    const clientSessions = this.sessionIdsByClient.get(client);
    if (!clientSessions?.size) return;

    for (const sessionId of [...clientSessions]) {
      this.sessions.delete(sessionId);
    }
    clientSessions.clear();
  }

  relayFromAgent(agentId: string, payload: Record<string, unknown>): boolean {
    const previewSessionId = String(payload.previewSessionId || '').trim();
    if (!previewSessionId) return false;

    const session = this.sessions.get(previewSessionId);
    if (!session || session.agentId !== agentId) return false;

    if (session.client.readyState !== WebSocket.OPEN) {
      this.removeSession(previewSessionId);
      return false;
    }

    session.client.send(JSON.stringify({
      type: 'preview.signal',
      payload: {
        ...payload,
        previewSessionId,
        pairKey: session.pairKey,
      },
    }));
    return true;
  }
}
