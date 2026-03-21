import { http } from './http';

export async function getMyPatient(token: string) {
    return http<{
        ok: boolean;
        patient: {
            id: string;
            lastName: string;
            firstName: string;
            middleName: string | null;
            phone: string | null;
            email: string | null;
            phoneVerified: boolean;
        };
    }>('/patient/me', {
        method: 'GET',
        token,
    });
}

export async function setPatientPhone(token: string, phone: string) {
    return http<{
        ok: boolean;
        message: string;
        patient: {
            id: string;
            phone: string | null;
            phoneVerified: boolean;
        };
    }>('/patient/phone', {
        method: 'POST',
        token,
        body: JSON.stringify({ phone }),
    });
}

export async function confirmPatientPhone(
    token: string,
    phoneVerificationSessionId: string,
) {
    return http<{
        ok: boolean;
        message: string;
        patient: {
            id: string;
            phone: string | null;
            phoneVerified: boolean;
        };
    }>('/patient/phone/confirm', {
        method: 'POST',
        token,
        body: JSON.stringify({ phoneVerificationSessionId }),
    });
}