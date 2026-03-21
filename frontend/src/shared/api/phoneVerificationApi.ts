import { http } from './http';

export async function startPhoneVerification(phone: string) {
    return http<{
        ok: boolean;
        sessionId: string;
        phone: string;
        status: string;
        telegramBotUrl: string;
    }>('/phone-verification/start', {
        method: 'POST',
        body: JSON.stringify({ phone }),
    });
}

export async function getPhoneVerificationStatus(sessionId: string) {
    return http<{
        ok: boolean;
        sessionId: string;
        status: string;
        phone: string;
        verifiedAt: string | null;
    }>(`/phone-verification/${sessionId}/status`, {
    method: 'GET',
});
}