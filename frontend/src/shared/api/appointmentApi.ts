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
    doctorName?: string | null;
    serviceId: string | null;
    serviceName?: string | null;
    appointmentDate: string | null;
    status: string;
    source: string;
    recordingCompleted?: boolean;
    recordingCompletedAt?: string | null;
    createdAt: string;
    updatedAt: string;
    paymentStatus?: 'PENDING' | 'PAID' | 'FAILED' | string | null;
    paymentMethod?: 'CASH' | 'GOOGLE_PAY' | string | null;
    paidAmountUah?: number | null;
    receiptNumber?: string | null;
    canPayNow?: boolean;
    refundStatus?: 'NONE' | 'PENDING' | 'REFUNDED' | 'FAILED' | string | null;
    refundRequestedAt?: string | null;
    refundedAt?: string | null;
    refundAmountUah?: number | null;
};

export type SmartAppointmentPlanRequest = {
    serviceIds: string[];
    preferredDate?: string;
    doctorId?: string;
    mode?: 'earliest' | 'same-doctor-first';
};

export type SmartAppointmentPlanStep = {
    serviceId: string;
    serviceName: string;
    doctorId: string;
    doctorName?: string;
    startAt: string;
    endAt: string;
    durationMinutes: number;
};

export type SmartAppointmentPlan = {
    strategy: 'same-doctor' | 'mixed-doctors';
    sameDoctor: boolean;
    doctorIds: string[];
    totalDurationMinutes: number;
    startAt: string;
    endAt: string;
    steps: SmartAppointmentPlanStep[];
};

export type SmartAppointmentPlanResponse = {
    ok: boolean;
    preferredDate: string;
    requestedServiceIds: string[];
    rejectionReason?: string;
    plans: SmartAppointmentPlan[];
};

export type CreatePaidGooglePayTestBookingStep = {
    serviceId: string;
    doctorId: string;
    appointmentDate: string;
};



export type CreatePaidGooglePayTestBookingResponse = {
    ok: boolean;
    message: string;
    receiptNumber?: string;
    appointments: AppointmentItem[];
};

export type CreateOfflineBookingStep = {
    serviceId: string;
    doctorId: string;
    appointmentDate: string;
};
export type CreatePaidGooglePayTestBookingPayload = {
    steps: CreatePaidGooglePayTestBookingStep[];
    googleTransactionId?: string;
    googlePaymentToken?: string;
    paymentMethod?: 'GOOGLE_PAY';
    phoneVerificationSessionId?: string;

    lastName?: string;
    firstName?: string;
    middleName?: string;
    phone?: string;
};

export type CreateOfflineBookingPayload = {
    steps: CreateOfflineBookingStep[];
    paymentMethod?: 'CASH';
    phoneVerificationSessionId?: string;

    lastName?: string;
    firstName?: string;
    middleName?: string;
    phone?: string;
};
export type CreateOfflineBookingResponse = {
    ok: boolean;
    message: string;
    appointments: AppointmentItem[];
};

export type CreateGuestSmartBookingPayload = {
    lastName: string;
    firstName: string;
    middleName?: string;
    phone: string;
    phoneVerificationSessionId: string;
    steps: Array<{
        serviceId: string;
        doctorId: string;
        appointmentDate: string;
    }>;
    paymentMethod?: 'CASH';
};

export type CreateGuestSmartBookingResponse = {
    ok: boolean;
    message: string;
    appointments: AppointmentItem[];
};

export type CreateGuestPaidGooglePayTestBookingPayload = {
    lastName: string;
    firstName: string;
    middleName?: string;
    phone: string;
    phoneVerificationSessionId: string;
    steps: Array<{
        serviceId: string;
        doctorId: string;
        appointmentDate: string;
    }>;
    googleTransactionId?: string;
    googlePaymentToken?: string;
    paymentMethod?: 'GOOGLE_PAY';
};

export type CreateGuestPaidGooglePayTestBookingResponse = {
    ok: boolean;
    message: string;
    receiptNumber?: string;
    appointments: AppointmentItem[];
};

export type MyAppointmentsResponse = {
    ok: boolean;
    active: AppointmentItem[];
    completed: AppointmentItem[];
};

export async function createGuestAppointment(payload: GuestAppointmentPayload) {
    return http<{ ok: boolean; message?: string; appointment?: AppointmentItem }>('/appointment/guest', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function createAuthenticatedAppointment(
    token: string,
    payload: AuthenticatedAppointmentPayload,
) {
    return http<{ ok: boolean; message?: string; appointment?: AppointmentItem }>('/appointment/authenticated', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });
}

export async function getSmartAppointmentPlan(
    token: string | null,
    payload: SmartAppointmentPlanRequest,
) {
    return http<SmartAppointmentPlanResponse>('/appointment/smart-plan', {
        method: 'POST',
        ...(token ? { token } : {}),
        body: JSON.stringify({
            serviceIds: payload.serviceIds,
            preferredDate: payload.preferredDate,
            doctorId: payload.doctorId,
            mode: payload.mode ?? 'same-doctor-first',
        }),
    });
}

export async function createPaidGooglePayTestBooking(
    token: string,
    payload: CreatePaidGooglePayTestBookingPayload,
) {
    return http<CreatePaidGooglePayTestBookingResponse>('/appointment/create-paid-google-pay-test', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });
}

export async function createOfflineBooking(
    token: string,
    payload: CreateOfflineBookingPayload,
) {
    return http<CreateOfflineBookingResponse>('/appointment/create-offline-booking', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });
}

export async function createGuestSmartBooking(payload: CreateGuestSmartBookingPayload) {
    return http<CreateGuestSmartBookingResponse>('/appointment/create-guest-smart-booking', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function createGuestPaidGooglePayTestBooking(
    payload: CreateGuestPaidGooglePayTestBookingPayload,
) {
    return http<CreateGuestPaidGooglePayTestBookingResponse>(
        '/appointment/create-paid-google-pay-test-guest-booking',
        {
            method: 'POST',
            body: JSON.stringify(payload),
        },
    );
}

export async function getMyAppointments(token: string) {
    return http<MyAppointmentsResponse>('/appointment/my', {
        method: 'GET',
        token,
    });
}

export async function payMyAppointmentGooglePayTest(
    token: string,
    appointmentId: string,
    payload: {
        googleTransactionId?: string;
        googlePaymentToken?: string;
    },
) {
    return http(`/appointment/${appointmentId}/pay-google-pay-test`, {
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

export async function getAdminPatientAppointments(
    token: string,
    patientId: string,
) {
    return http<{
        ok: boolean;
        appointments: AppointmentItem[];
    }>(`/appointment/admin/patient/${patientId}`, {
        method: 'GET',
        token,
    });
}

export async function adminCancelAppointment(
    token: string,
    appointmentId: string,
    payload?: { reason?: string },
) {
    return http(`/appointment/admin/${appointmentId}/cancel`, {
        method: 'POST',
        token,
        body: JSON.stringify(payload || {}),
    });
}

export async function adminRescheduleAppointment(
    token: string,
    appointmentId: string,
    payload: { doctorId?: string; appointmentDate: string; reason?: string },
) {
    return http(`/appointment/admin/${appointmentId}/reschedule`, {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });
}

export async function adminRefundAppointment(
    token: string,
    appointmentId: string,
    payload?: {
        refundStatus?: 'PENDING' | 'REFUNDED' | 'FAILED';
        refundReference?: string;
        reason?: string;
    },
) {
    return http(`/appointment/admin/${appointmentId}/refund`, {
        method: 'POST',
        token,
        body: JSON.stringify(payload || {}),
    });
}
