import { http } from './http';

export type RegisterPayload = {
    lastName: string;
    firstName: string;
    middleName?: string;
    email: string;
    password: string;
};

export type VerifyEmailPayload = {
    email: string;
    code: string;
};

export type LoginPayload = {
    email: string;
    password: string;
};

export async function register(payload: RegisterPayload) {
    return http<{ ok: boolean; message: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function verifyEmail(payload: VerifyEmailPayload) {
    return http<{ ok: boolean; message: string }>('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function login(payload: LoginPayload) {
    return http<{
        ok: boolean;
        message: string;
        accessToken: string;
        user: {
            id: string;
            email: string;
            role: string;
            patientId: string | null;
        };
    }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function getMe(token: string) {
    return http<{
        ok: boolean;
        user: {
            id: string;
            email: string;
            role: string;
            authProvider: string;
            patientId: string | null;
        };
    }>('/auth/me', {
        method: 'GET',
        token,
    });
}