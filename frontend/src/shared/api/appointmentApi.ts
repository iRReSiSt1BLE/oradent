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

export type AppointmentPatient = {
    id: string;
    lastName: string;
    firstName: string;
    middleName: string | null;
    phone: string | null;
    email?: string | null;
};

export type AppointmentItem = {
    id: string;
    patientId?: string;
    patient?: AppointmentPatient;
    doctorId: string | null;
    serviceId: string | null;
    appointmentDate: string | null;
    status: string;
    source: string;
    recordingCompleted?: boolean;
    recordingCompletedAt?: string | null;
    createdAt: string;
    updatedAt: string;
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

export async function completeAppointmentRecording(token: string, id: string) {
    return http<{ ok: boolean; message: string; appointment: AppointmentItem }>(
        `/appointment/${id}/complete-recording`,
        {
            method: 'POST',
            token,
        },
    );
}

export async function getAllAppointments() {
    return http<AppointmentItem[]>('/appointment', {
        method: 'GET',
    });
}

export async function getAppointmentById(id: string) {
    return http<AppointmentItem>(`/appointment/${id}`, {
        method: 'GET',
    });
}
