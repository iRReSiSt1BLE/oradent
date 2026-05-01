import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';

export type CaptureAgentIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type CaptureAgentIceServersResponse = {
  ok: true;
  enabled: boolean;
  mode: 'temporary' | 'static' | 'fallback';
  expiresAt?: string;
  ttlSeconds?: number;
  iceTransportPolicy: 'all' | 'relay';
  iceServers: CaptureAgentIceServer[];
};

@Injectable()
export class CaptureAgentIceService {
  constructor(private readonly configService: ConfigService) {}

  private bool(name: string, fallback = false): boolean {
    const value = String(this.configService.get<string>(name) ?? '').trim().toLowerCase();
    if (!value) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value);
  }

  private text(name: string): string {
    return String(this.configService.get<string>(name) ?? '').trim();
  }

  private number(name: string, fallback: number): number {
    const raw = Number(this.configService.get<string>(name));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
  }

  private makeTemporaryCredential(secret: string, ttlSeconds: number) {
    const expiresAtUnix = Math.floor(Date.now() / 1000) + ttlSeconds;
    const username = `${expiresAtUnix}:oradent-preview`;
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    return { username, credential, expiresAt: new Date(expiresAtUnix * 1000).toISOString() };
  }

  getIceServers(): CaptureAgentIceServersResponse {
    const enabled = this.bool('TURN_ENABLED', false);
    const forceRelay = this.bool('TURN_FORCE_RELAY', false);
    const useTemporaryCredentials = this.bool('TURN_TEMPORARY_CREDENTIALS', false);
    const ttlSeconds = this.number('TURN_CREDENTIAL_TTL_SECONDS', 1800);

    const stunUrl = this.text('TURN_STUN_URL') || this.text('STUN_URL');
    const turnUrl = this.text('TURN_URL');
    const staticUsername = this.text('TURN_USERNAME');
    const staticCredential = this.text('TURN_CREDENTIAL');
    const sharedSecret = this.text('TURN_SHARED_SECRET');
    const iceTransportPolicy: 'all' | 'relay' = forceRelay ? 'relay' : 'all';

    if (!enabled) {
      return {
        ok: true,
        enabled: false,
        mode: 'fallback',
        iceTransportPolicy: 'all',
        iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
      };
    }

    const iceServers: CaptureAgentIceServer[] = [];
    if (stunUrl) iceServers.push({ urls: stunUrl });

    if (turnUrl && useTemporaryCredentials && sharedSecret) {
      const credential = this.makeTemporaryCredential(sharedSecret, ttlSeconds);
      iceServers.push({ urls: turnUrl, username: credential.username, credential: credential.credential });
      return {
        ok: true,
        enabled: true,
        mode: 'temporary',
        expiresAt: credential.expiresAt,
        ttlSeconds,
        iceTransportPolicy,
        iceServers,
      };
    }

    if (turnUrl && staticUsername && staticCredential) {
      iceServers.push({ urls: turnUrl, username: staticUsername, credential: staticCredential });
      return { ok: true, enabled: true, mode: 'static', iceTransportPolicy, iceServers };
    }

    return {
      ok: true,
      enabled: false,
      mode: 'fallback',
      iceTransportPolicy: 'all',
      iceServers: iceServers.length ? iceServers : [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
    };
  }
}
