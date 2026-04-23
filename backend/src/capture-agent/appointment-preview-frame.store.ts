import { Injectable } from '@nestjs/common';

type PreviewFramePayload = {
  agentKey: string;
  pairKey: string;
  imageDataUrl: string;
  mimeType?: string;
  capturedAt?: string;
};

export type StoredAppointmentPreviewFrame = {
  agentKey: string;
  pairKey: string;
  imageDataUrl: string;
  mimeType: string;
  capturedAt: string;
  updatedAt: number;
};

@Injectable()
export class AppointmentPreviewFrameStore {
  private readonly frames = new Map<string, StoredAppointmentPreviewFrame>();

  private buildKey(agentKey: string, pairKey: string): string {
    return `${String(agentKey || '').trim()}::${String(pairKey || '').trim()}`;
  }

  setFrame(payload: PreviewFramePayload): void {
    const agentKey = String(payload.agentKey || '').trim();
    const pairKey = String(payload.pairKey || '').trim();
    const imageDataUrl = String(payload.imageDataUrl || '').trim();

    if (!agentKey || !pairKey || !imageDataUrl) {
      return;
    }

    this.frames.set(this.buildKey(agentKey, pairKey), {
      agentKey,
      pairKey,
      imageDataUrl,
      mimeType: String(payload.mimeType || 'image/webp').trim() || 'image/webp',
      capturedAt: String(payload.capturedAt || new Date().toISOString()).trim() || new Date().toISOString(),
      updatedAt: Date.now(),
    });
  }

  getFrame(agentKey: string, pairKey: string): StoredAppointmentPreviewFrame | null {
    return this.frames.get(this.buildKey(agentKey, pairKey)) || null;
  }

  clearFrame(agentKey: string, pairKey?: string): void {
    const normalizedAgentKey = String(agentKey || '').trim();
    const normalizedPairKey = String(pairKey || '').trim();

    if (!normalizedAgentKey) {
      return;
    }

    if (normalizedPairKey) {
      this.frames.delete(this.buildKey(normalizedAgentKey, normalizedPairKey));
      return;
    }

    for (const key of [...this.frames.keys()]) {
      if (key.startsWith(`${normalizedAgentKey}::`)) {
        this.frames.delete(key);
      }
    }
  }
}
