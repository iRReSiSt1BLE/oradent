import { http } from './http';

export type GuestAppointmentPayload = {
    lastName: string;
    firstName: string;
    middleName?: string;
    phone: string;
    phoneVerificationSessionId: string;
    doctorId?: string;
    serviceId?: string;
    appointmentDate?: string;
    reason?: string;
};

export type AuthenticatedAppointmentPayload = {
    phoneVerificationSessionId?: string;
    doctorId?: string;
    serviceId?: string;
    appointmentDate?: string;
    reason?: string;
};

export async function createGuestAppointment(payload: GuestAppointmentPayload) {
    return http('/appointment/guest', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function createAuthenticatedAppointment(
    token: string,
    payload: AuthenticatedAppointmentPayload,
) {
    return http('/appointment/authenticated', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });
}