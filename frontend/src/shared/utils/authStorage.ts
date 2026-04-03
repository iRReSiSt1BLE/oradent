const TOKEN_KEY = 'oradent_access_token';
const ROLE_KEY = 'oradent_user_role';
const USER_KEY = 'oradent_user';

export type StoredUser = {
    id: string;
    email: string;
    role: string;
    patientId?: string | null;
};

export type TokenPayload = {
    sub?: string;
    id?: string;
    email?: string;
    role?: string;
    patientId?: string | null;
    exp?: number;
    iat?: number;
    [key: string]: unknown;
};

function isBrowser(): boolean {
    return typeof window !== 'undefined';
}

function decodeBase64Url(value: string): string | null {
    try {
        const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
        return atob(padded);
    } catch {
        return null;
    }
}

function parseJwtPayload(token: string): TokenPayload | null {
    const parts = token.split('.');
    if (parts.length < 2) return null;

    const decoded = decodeBase64Url(parts[1]);
    if (!decoded) return null;

    try {
        return JSON.parse(decoded) as TokenPayload;
    } catch {
        return null;
    }
}

export function getToken(): string | null {
    if (!isBrowser()) return null;
    return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
    if (!isBrowser()) return;
    window.localStorage.setItem(TOKEN_KEY, token);
}

export function saveToken(token: string): void {
    setToken(token);
}

export function removeToken(): void {
    if (!isBrowser()) return;
    window.localStorage.removeItem(TOKEN_KEY);
}

export function getTokenPayload(): TokenPayload | null {
    const token = getToken();
    if (!token) return null;
    return parseJwtPayload(token);
}

export function getUserRole(): string | null {
    if (!isBrowser()) return null;

    const roleFromStorage = window.localStorage.getItem(ROLE_KEY);
    if (roleFromStorage) return roleFromStorage;

    const payload = getTokenPayload();
    return typeof payload?.role === 'string' ? payload.role : null;
}

export function setUserRole(role: string): void {
    if (!isBrowser()) return;
    window.localStorage.setItem(ROLE_KEY, role);
}

export function saveUserRole(role: string): void {
    setUserRole(role);
}

export function removeUserRole(): void {
    if (!isBrowser()) return;
    window.localStorage.removeItem(ROLE_KEY);
}

export function getStoredUser(): StoredUser | null {
    if (!isBrowser()) return null;

    try {
        const raw = window.localStorage.getItem(USER_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as StoredUser;
    } catch {
        return null;
    }
}

export function getUser(): StoredUser | null {
    return getStoredUser();
}

export function setStoredUser(user: StoredUser): void {
    if (!isBrowser()) return;
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function saveUser(user: StoredUser): void {
    setStoredUser(user);
}

export function removeStoredUser(): void {
    if (!isBrowser()) return;
    window.localStorage.removeItem(USER_KEY);
}

export function removeUser(): void {
    removeStoredUser();
}

export function setAuthData(params: {
    accessToken: string;
    user: StoredUser;
}): void {
    setToken(params.accessToken);
    setUserRole(params.user.role);
    setStoredUser(params.user);
}

export function clearAuthData(): void {
    removeToken();
    removeUserRole();
    removeStoredUser();
}

export function clearUserData(): void {
    clearAuthData();
}