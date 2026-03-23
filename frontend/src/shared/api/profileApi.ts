import { http } from './http';

export async function getMyProfile(token: string) {
    return http<{
        ok: boolean;
        profile: {
            userId: string;
            email: string;
            authProvider: string;
            role: string;
            patientId: string;
            lastName: string;
            firstName: string;
            middleName: string | null;
            phone: string | null;
            phoneVerified: boolean;
        };
    }>('/profile/me', {
        method: 'GET',
        token,
    });
}

export async function updateProfile(
    token: string,
    payload: {
        lastName: string;
        firstName: string;
        middleName?: string;
        password: string;
    },
) {
    return http<{
        ok: boolean;
        message: string;
        profile: {
            lastName: string;
            firstName: string;
            middleName: string | null;
        };
    }>('/profile', {
        method: 'PATCH',
        token,
        body: JSON.stringify(payload),
    });
}

export async function requestEmailChange(
    token: string,
    payload: {
        newEmail: string;
        password: string;
    },
) {
    return http<{ ok: boolean; message: string }>('/profile/change-email/request', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });
}

export async function confirmEmailChange(
    token: string,
    payload: {
        newEmail: string;
        code: string;
    },
) {
    return http<{ ok: boolean; message: string; email: string }>(
        '/profile/change-email/confirm',
        {
            method: 'POST',
            token,
            body: JSON.stringify(payload),
        },
    );
}

export async function startPhoneChange(
    token: string,
    payload: {
        phone: string;
        password: string;
    },
) {
    return http<{
        ok: boolean;
        sessionId: string;
        phone: string;
        status: string;
        telegramBotUrl: string;
    }>('/profile/change-phone/start', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });
}

export async function confirmPhoneChange(
    token: string,
    payload: {
        phoneVerificationSessionId: string;
        phone: string;
    },
) {
    return http<{
        ok: boolean;
        message: string;
        phone: string;
        phoneVerified: boolean;
    }>('/profile/change-phone/confirm', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });
}