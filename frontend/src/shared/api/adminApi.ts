// C:\Users\hmax0\Desktop\oradent\frontend\src\shared\api\adminApi.ts
import { http } from './http';

export async function getAllAdmins(token: string) {
    return http<{
        ok: boolean;
        admins: Array<{
            id: string;
            userId: string;
            email: string;
            lastName: string;
            firstName: string;
            middleName: string | null;
            phone: string;
            isActive: boolean;
            role: string;
        }>;
    }>('/admins', {
        method: 'GET',
        token,
    });
}

export async function requestAdminEmailVerification(token: string, email: string) {
    return http<{ ok: boolean; message: string }>('/admins/request-email-verification', {
        method: 'POST',
        token,
        body: JSON.stringify({ email }),
    });
}

export async function createAdmin(
    token: string,
    payload: {
        lastName: string;
        firstName: string;
        middleName?: string;
        phone: string;
        email: string;
        password: string;
        emailCode?: string;
        phoneVerificationSessionId?: string;
    },
) {
    return http<{
        ok: boolean;
        message: string;
        admin: {
            id: string;
            userId: string;
            email: string;
            lastName: string;
            firstName: string;
            middleName: string | null;
            phone: string;
            isActive: boolean;
            role: string;
        };
    }>('/admins', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });
}

export async function updateAdmin(
    token: string,
    adminId: string,
    payload: {
        lastName?: string;
        firstName?: string;
        middleName?: string;
        email?: string;
        phone?: string;
        emailCode?: string;
        phoneVerificationSessionId?: string;
        superAdminPassword: string;
    },
) {
    return http<{
        ok: boolean;
        message: string;
        admin: {
            id: string;
            userId: string;
            email: string;
            lastName: string;
            firstName: string;
            middleName: string | null;
            phone: string;
            isActive: boolean;
            role: string;
        };
    }>(`/admins/${adminId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(payload),
    });
}

export async function toggleAdminActive(token: string, adminId: string) {
    return http<{ ok: boolean; message: string; isActive: boolean }>(`/admins/${adminId}/toggle-active`, {
        method: 'PATCH',
        token,
    });
}
