import { http } from './http';

export type CaptureAgentIceServer = {
    urls: string | string[];
    username?: string;
    credential?: string;
};

export type CaptureAgentIceServersResponse = {
    ok: boolean;
    enabled: boolean;
    mode: 'temporary' | 'static' | 'fallback' | string;
    expiresAt?: string;
    ttlSeconds?: number;
    iceTransportPolicy?: RTCIceTransportPolicy;
    iceServers: CaptureAgentIceServer[];
};

const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

export function buildRtcConfiguration(config?: Partial<CaptureAgentIceServersResponse> | null): RTCConfiguration {
    const iceServers = Array.isArray(config?.iceServers) && config.iceServers.length
        ? config.iceServers as RTCIceServer[]
        : FALLBACK_ICE_SERVERS;

    return {
        iceServers,
        iceTransportPolicy: config?.iceTransportPolicy || 'all',
    };
}

export async function getWebRtcIceServers(token: string) {
    return http<CaptureAgentIceServersResponse>('/capture-agent/webrtc/ice-servers', {
        method: 'GET',
        token,
    });
}
