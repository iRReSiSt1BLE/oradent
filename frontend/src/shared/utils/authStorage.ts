const TOKEN_KEY = 'oradent_access_token';

export type JwtPayload = {
    sub?: string;
    email?: string;
    role?: 'PATIENT' | 'ADMIN' | 'SUPER_ADMIN' | 'DOCTOR' | string;
    exp?: number;
    iat?: number;
};

export function saveToken(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
}

export function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

export function removeToken() {
    localStorage.removeItem(TOKEN_KEY);
}

function parseJwt(token: string): JwtPayload | null {
    try {
        const parts = token.split('.');
        if (parts.length < 2) return null;

        const payloadPart = parts[1];
        const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
        const json = atob(padded);

        return JSON.parse(json) as JwtPayload;
    } catch {
        return null;
    }
}

export function getTokenPayload(): JwtPayload | null {
    const token = getToken();
    if (!token) return null;

    return parseJwt(token);
}

export function getUserRole(): JwtPayload['role'] | null {
    return getTokenPayload()?.role ?? null;
}