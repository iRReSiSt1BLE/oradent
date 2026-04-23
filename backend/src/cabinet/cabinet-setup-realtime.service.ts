import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import WebSocket from 'ws';
import { MoreThan, Repository } from 'typeorm';
import { CabinetSetupSession } from './entities/cabinet-setup-session.entity';

type Subscriber = {
  setupSessionId: string;
  client: WebSocket;
};

type PreviewBinaryMetadata = {
  pairKey?: string;
  mimeType?: string;
  capturedAt?: string;
};

const PREVIEW_BINARY_MAGIC = Buffer.from('OPF1');

function buildPreviewBinaryPacket(
  metadata: PreviewBinaryMetadata,
  imageBytes: Uint8Array,
): Buffer {
  const metaBytes = Buffer.from(JSON.stringify(metadata || {}), 'utf8');
  const header = Buffer.allocUnsafe(PREVIEW_BINARY_MAGIC.length + 4);
  PREVIEW_BINARY_MAGIC.copy(header, 0);
  header.writeUInt32BE(metaBytes.length, PREVIEW_BINARY_MAGIC.length);
  return Buffer.concat([header, metaBytes, Buffer.from(imageBytes)]);
}

@Injectable()
export class CabinetSetupRealtimeService {
  private readonly subscribers = new Set<Subscriber>();
  private readonly agentKeyBySetupSessionId = new Map<string, string>();
  private readonly setupSessionIdsByAgentKey = new Map<string, Set<string>>();

  constructor(
    @InjectRepository(CabinetSetupSession)
    private readonly cabinetSetupSessionRepository: Repository<CabinetSetupSession>,
  ) {}

  private normalizeAgentKey(agentKey?: string | null) {
    return (agentKey || '').trim();
  }

  private unlinkSetupSession(setupSessionId: string) {
    const existingAgentKey = this.agentKeyBySetupSessionId.get(setupSessionId);
    if (!existingAgentKey) {
      return;
    }

    this.agentKeyBySetupSessionId.delete(setupSessionId);
    const sessions = this.setupSessionIdsByAgentKey.get(existingAgentKey);
    if (!sessions) {
      return;
    }

    sessions.delete(setupSessionId);
    if (sessions.size === 0) {
      this.setupSessionIdsByAgentKey.delete(existingAgentKey);
    }
  }

  private linkSetupSessionToAgentKey(setupSessionId: string, agentKey?: string | null) {
    this.unlinkSetupSession(setupSessionId);

    const normalizedAgentKey = this.normalizeAgentKey(agentKey);
    if (!normalizedAgentKey) {
      return;
    }

    this.agentKeyBySetupSessionId.set(setupSessionId, normalizedAgentKey);
    const sessions = this.setupSessionIdsByAgentKey.get(normalizedAgentKey) || new Set<string>();
    sessions.add(setupSessionId);
    this.setupSessionIdsByAgentKey.set(normalizedAgentKey, sessions);
  }

  private hasAnySubscriberForSetupSession(setupSessionId: string) {
    for (const entry of this.subscribers) {
      if (entry.setupSessionId === setupSessionId) {
        return true;
      }
    }

    return false;
  }

  private async hydrateSetupSessionsForAgentKey(agentKey?: string | null) {
    const normalizedAgentKey = this.normalizeAgentKey(agentKey);
    if (!normalizedAgentKey || this.setupSessionIdsByAgentKey.has(normalizedAgentKey)) {
      return;
    }

    const sessions = await this.cabinetSetupSessionRepository.find({
      where: {
        agentKey: normalizedAgentKey,
        expiresAt: MoreThan(new Date()),
      },
      select: ['id'],
    });

    if (!sessions.length) {
      return;
    }

    const sessionIds = new Set<string>();
    sessions.forEach((session) => {
      sessionIds.add(session.id);
      this.agentKeyBySetupSessionId.set(session.id, normalizedAgentKey);
    });
    this.setupSessionIdsByAgentKey.set(normalizedAgentKey, sessionIds);
  }

  subscribe(setupSessionId: string, client: WebSocket, agentKey?: string | null) {
    this.unsubscribe(client);
    this.subscribers.add({ setupSessionId, client });
    this.linkSetupSessionToAgentKey(setupSessionId, agentKey);
  }

  updateSubscriberAgentKey(client: WebSocket, agentKey?: string | null) {
    for (const entry of this.subscribers) {
      if (entry.client !== client) {
        continue;
      }

      this.linkSetupSessionToAgentKey(entry.setupSessionId, agentKey);
      return;
    }
  }

  unsubscribe(client: WebSocket) {
    for (const entry of [...this.subscribers]) {
      if (entry.client !== client) {
        continue;
      }

      this.subscribers.delete(entry);
      if (!this.hasAnySubscriberForSetupSession(entry.setupSessionId)) {
        this.unlinkSetupSession(entry.setupSessionId);
      }
    }
  }

  sendToSetupSession(setupSessionId: string, payload: Record<string, unknown>) {
    for (const entry of [...this.subscribers]) {
      if (entry.setupSessionId !== setupSessionId) {
        continue;
      }

      if (entry.client.readyState !== WebSocket.OPEN) {
        this.subscribers.delete(entry);
        if (!this.hasAnySubscriberForSetupSession(entry.setupSessionId)) {
          this.unlinkSetupSession(entry.setupSessionId);
        }
        continue;
      }

      entry.client.send(JSON.stringify(payload));
    }
  }

  sendBinaryPreviewToSetupSession(
    setupSessionId: string,
    metadata: PreviewBinaryMetadata,
    imageBytes: Uint8Array,
  ) {
    const packet = buildPreviewBinaryPacket(metadata, imageBytes);

    for (const entry of [...this.subscribers]) {
      if (entry.setupSessionId !== setupSessionId) {
        continue;
      }

      if (entry.client.readyState !== WebSocket.OPEN) {
        this.subscribers.delete(entry);
        if (!this.hasAnySubscriberForSetupSession(entry.setupSessionId)) {
          this.unlinkSetupSession(entry.setupSessionId);
        }
        continue;
      }

      entry.client.send(packet);
    }
  }

  async relayPreviewFrameByAgentKey(
    agentKey: string | null | undefined,
    payload: Record<string, unknown>,
    imageBytes?: Uint8Array,
  ) {
    const normalizedAgentKey = this.normalizeAgentKey(agentKey);
    if (!normalizedAgentKey) {
      return;
    }

    await this.hydrateSetupSessionsForAgentKey(normalizedAgentKey);
    const sessionIds = this.setupSessionIdsByAgentKey.get(normalizedAgentKey);
    if (!sessionIds?.size) {
      return;
    }

    if (imageBytes?.length) {
      const metadata: PreviewBinaryMetadata = {
        pairKey: typeof payload.pairKey === 'string' ? payload.pairKey : undefined,
        mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : undefined,
        capturedAt: typeof payload.capturedAt === 'string' ? payload.capturedAt : undefined,
      };

      sessionIds.forEach((setupSessionId) =>
        this.sendBinaryPreviewToSetupSession(setupSessionId, metadata, imageBytes),
      );
      return;
    }

    sessionIds.forEach((setupSessionId) => this.sendToSetupSession(setupSessionId, payload));
  }

  notifySetupSessionUpdated(setupSessionId: string) {
    for (const entry of [...this.subscribers]) {
      if (entry.setupSessionId !== setupSessionId) {
        continue;
      }

      if (entry.client.readyState !== WebSocket.OPEN) {
        this.subscribers.delete(entry);
        if (!this.hasAnySubscriberForSetupSession(entry.setupSessionId)) {
          this.unlinkSetupSession(entry.setupSessionId);
        }
        continue;
      }

      entry.client.send(
        JSON.stringify({
          type: 'setup.updated',
          payload: {
            setupSessionId,
            serverTime: new Date().toISOString(),
          },
        }),
      );
    }
  }

  async notifyByAgentKey(agentKey?: string | null) {
    const normalizedAgentKey = this.normalizeAgentKey(agentKey);
    if (!normalizedAgentKey) {
      return;
    }

    const sessions = await this.cabinetSetupSessionRepository.find({
      where: {
        agentKey: normalizedAgentKey,
        expiresAt: MoreThan(new Date()),
      },
      select: ['id'],
    });

    if (sessions.length) {
      const sessionIds = new Set<string>();
      sessions.forEach((session) => {
        sessionIds.add(session.id);
        this.agentKeyBySetupSessionId.set(session.id, normalizedAgentKey);
      });
      this.setupSessionIdsByAgentKey.set(normalizedAgentKey, sessionIds);
    }

    sessions.forEach((session) => this.notifySetupSessionUpdated(session.id));
  }

  async notifyByConnectionCode(connectionCode?: string | null) {
    const normalizedConnectionCode = (connectionCode || '').trim();
    if (!normalizedConnectionCode) {
      return;
    }

    const session = await this.cabinetSetupSessionRepository.findOne({
      where: {
        connectionCode: normalizedConnectionCode,
        expiresAt: MoreThan(new Date()),
      },
      select: ['id', 'agentKey'],
    });

    if (session) {
      this.linkSetupSessionToAgentKey(session.id, session.agentKey);
      this.notifySetupSessionUpdated(session.id);
    }
  }
}
