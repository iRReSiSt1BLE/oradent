import { http } from './http';

export type AdminPatientListItem = {
    id: string;
    lastName: string;
    firstName: string;
    middleName: string | null;
    phone: string | null;
    email: string | null;
    phoneVerified: boolean;
    hasAccount: boolean;
    appointmentsCount: number;
    lastAppointmentDate: string | null;
};

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

export async function verifyAndLinkPhone(
    token: string,
    phone: string,
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
    }>('/patient/phone/verify-and-link', {
        method: 'POST',
        token,
        body: JSON.stringify({ phone, phoneVerificationSessionId }),
    });
}

export async function getAdminPatients(token: string, search = '') {
    const query = search.trim()
        ? `?search=${encodeURIComponent(search.trim())}`
        : '';

    return http<{
        ok: boolean;
        patients: AdminPatientListItem[];
    }>(`/patient/admin/all${query}`, {
        method: 'GET',
        token,
    });
}