import { http } from './http';

export type GuestAppointmentPayload = {
    lastName: string;
    firstName: string;
    middleName?: string;
    phone: string;
    phoneVerificationSessionId?: string;
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

export type AppointmentCabinetDevice = {
    id: string;
    name: string;
    cameraDeviceId?: string | null;
    cameraLabel?: string | null;
    microphoneDeviceId?: string | null;
    microphoneLabel?: string | null;
    startMode?: 'AUTO_ON_VISIT_START' | 'MANUAL' | string;
    isActive?: boolean;
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
    consultationConclusion?: string | null;
    treatmentPlanItems?: string[];
    recommendationItems?: string[];
    medicationItems?: string[];
    consultationEmail?: string | null;
    completedAt?: string | null;
    reviewAnonymous?: boolean;
    reviewRating?: number | null;
    reviewText?: string | null;
    reviewCreatedAt?: string | null;
    createdAt: string;
    updatedAt: string;
    paymentStatus?: 'PENDING' | 'PAID' | 'FAILED' | string | null;
    paymentMethod?: 'CASH' | 'GOOGLE_PAY' | string | null;
    paidAmountUah?: number | null;
    receiptNumber?: string | null;
    cabinetId?: string | null;
    cabinetName?: string | null;
    cabinet?: {
        id: string;
        name: string;
        devices: AppointmentCabinetDevice[];
    } | null;
    durationMinutes?: number | null;
    visitFlowStatus?: 'SCHEDULED' | 'WAITING_CALL' | 'IN_PROGRESS' | 'COMPLETED' | 'NO_SHOW' | string | null;
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
    cabinetId?: string | null;
    cabinetName?: string | null;
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
    cabinetId?: string | null;
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
    cabinetId?: string | null;
};

export async function getDoctorAppointmentById(token: string, id: string) {
    return http<AppointmentItem>(`/appointment/doctor/${id}`, {
        method: 'GET',
        token,
    });
}

export type CompleteDoctorAppointmentPayload = {
    consultationConclusion: string;
    treatmentPlanItems: string[];
    recommendationItems: string[];
    medicationItems: string[];
    email?: string;
    nextVisitDate?: string | null;
};

export type DoctorFollowUpBookingPayload = {
    doctorId: string;
    serviceId: string;
    appointmentDate: string;
    cabinetId?: string | null;
    email?: string;
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
    phoneVerificationSessionId?: string;
    steps: Array<{
        serviceId: string;
        doctorId: string;
        appointmentDate: string;
        cabinetId?: string | null;
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
    phoneVerificationSessionId?: string;
    steps: Array<{
        serviceId: string;
        doctorId: string;
        appointmentDate: string;
        cabinetId?: string | null;
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


export type ManualAvailabilitySlot = {
    time: string;
    state: 'FREE' | 'BOOKED' | 'BLOCKED' | string;
    cabinetId?: string | null;
    cabinetName?: string | null;
};

export type ManualAvailabilityMonthDay = {
    date: string;
    isWorking: boolean;
    freeSlots: number;
    totalSlots: number;
    hasConflicts?: boolean;
};

export type ManualAvailabilityMonthResponse = {
    ok: boolean;
    doctorId: string;
    serviceId: string;
    month: string;
    timezone?: string;
    slotMinutes?: number;
    bookingWindowDays?: number;
    days: ManualAvailabilityMonthDay[];
};

export type ManualAvailabilityDayResponse = {
    ok: boolean;
    date: string;
    serviceId: string;
    timezone?: string;
    slotMinutes?: number;
    bookingWindowDays?: number;
    isWorking: boolean;
    reason: string;
    slots: ManualAvailabilitySlot[];
    blockedSlots?: Array<{
        date: string;
        start: string;
        end: string;
        reason?: string;
    }>;
    blockedDay?: boolean;
};


export type DoctorArchiveAppointmentItem = {
    id: string;
    patient: {
        id: string;
        fullName: string;
        phone: string | null;
        email: string | null;
    } | null;
    doctorId: string | null;
    doctorName: string | null;
    serviceId: string | null;
    serviceName: string | null;
    cabinetId: string | null;
    cabinetName: string | null;
    appointmentDate: string | null;
    durationMinutes: number | null;
    status: string;
    visitFlowStatus: string;
    paymentStatus: string | null;
    paymentMethod?: string | null;
    paidAmountUah?: number | null;
    source?: string;
    recordingCompleted?: boolean;
    consultationConclusion?: string | null;
    treatmentPlanItems?: string[];
    recommendationItems?: string[];
    medicationItems?: string[];
    consultationEmail?: string | null;
    completedAt?: string | null;
    consultationPdfReady?: boolean;
    videosCount?: number;
    accessType?: 'OWN' | 'SHARED';
    sharedByDoctorName?: string | null;
    accessExpiresAt?: string | null;
};

export type DoctorArchiveAppointmentsResponse = {
    ok: boolean;
    appointments: DoctorArchiveAppointmentItem[];
};

export type WeeklyAppointmentItem = {
    id: string;
    patient: {
        id: string;
        fullName: string;
        phone: string | null;
        email: string | null;
    } | null;
    doctorId: string | null;
    doctorName: string | null;
    serviceId: string | null;
    serviceName: string | null;
    cabinetId: string | null;
    cabinetName: string | null;
    availableCabinets: Array<{ id: string; name: string }>;
    appointmentDate: string | null;
    durationMinutes: number | null;
    status: string;
    visitFlowStatus: string;
    paymentStatus: string | null;
    paymentMethod?: string | null;
    paidAmountUah?: number | null;
    source?: string;
    recordingCompleted?: boolean;
};

export type WeeklyAppointmentsResponse = {
    ok: boolean;
    weekStart: string;
    weekEnd: string;
    appointments: WeeklyAppointmentItem[];
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


export async function getManualAvailabilityMonth(payload: {
    doctorId: string;
    serviceId: string;
    month: string;
}) {
    return http<ManualAvailabilityMonthResponse>('/appointment/manual-availability/month', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function getManualAvailabilityDay(payload: {
    doctorId: string;
    serviceId: string;
    date: string;
}) {
    return http<ManualAvailabilityDayResponse>('/appointment/manual-availability/day', {
        method: 'POST',
        body: JSON.stringify(payload),
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


export async function submitAppointmentReview(
    token: string,
    appointmentId: string,
    payload: {
        rating: number;
        text?: string;
        anonymous?: boolean;
    },
) {
    return http<{ ok: boolean; message: string; appointment: AppointmentItem }>(`/appointment/${appointmentId}/review`, {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });
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

export async function startAppointmentAgentRecording(
    token: string,
    appointmentId: string,
    payload?: { cabinetDeviceId?: string },
) {
    return http<{ ok: boolean; message: string; sentCount: number }>(`/appointment/${appointmentId}/agent-recording/start`, {
        method: 'POST',
        token,
        body: JSON.stringify(payload || {}),
    });
}

export async function stopAppointmentAgentRecording(
    token: string,
    appointmentId: string,
    payload?: { cabinetDeviceId?: string },
) {
    return http<{ ok: boolean; message: string; sentCount: number }>(`/appointment/${appointmentId}/agent-recording/stop`, {
        method: 'POST',
        token,
        body: JSON.stringify(payload || {}),
    });
}

export async function completeDoctorAppointment(
    token: string,
    id: string,
    payload: CompleteDoctorAppointmentPayload,
) {
    return http<{ ok: boolean; message: string; appointment: AppointmentItem }>(
        `/appointment/${id}/doctor-complete`,
        {
            method: 'POST',
            token,
            body: JSON.stringify(payload),
        },
    );
}

export async function createDoctorFollowUpAppointment(
    token: string,
    id: string,
    payload: DoctorFollowUpBookingPayload,
) {
    return http<{ ok: boolean; message: string; appointment: AppointmentItem }>(
        `/appointment/${id}/doctor-follow-up`,
        {
            method: 'POST',
            token,
            body: JSON.stringify(payload),
        },
    );
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


export async function getAdminWeekAppointments(token: string, date?: string) {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    return http<WeeklyAppointmentsResponse>(`/appointment/admin/week${query}`, {
        method: 'GET',
        token,
    });
}

export async function getDoctorWeekAppointments(token: string, date?: string) {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    return http<WeeklyAppointmentsResponse>(`/appointment/doctor/week${query}`, {
        method: 'GET',
        token,
    });
}

export async function updateAppointmentVisitFlowStatus(
    token: string,
    appointmentId: string,
    visitFlowStatus: string,
) {
    return http<{ ok: boolean; appointment: WeeklyAppointmentItem }>(`/appointment/${appointmentId}/visit-flow-status`, {
        method: 'POST',
        token,
        body: JSON.stringify({ visitFlowStatus }),
    });
}

export async function markAppointmentPaid(token: string, appointmentId: string) {
    return http<{ ok: boolean; appointment: WeeklyAppointmentItem }>(`/appointment/${appointmentId}/mark-paid`, {
        method: 'POST',
        token,
    });
}

export async function changeAppointmentCabinet(
    token: string,
    appointmentId: string,
    cabinetId: string,
) {
    return http<{ ok: boolean; appointment: WeeklyAppointmentItem }>(`/appointment/${appointmentId}/change-cabinet`, {
        method: 'POST',
        token,
        body: JSON.stringify({ cabinetId }),
    });
}


export async function getDoctorArchiveAppointments(token: string) {
    return http<DoctorArchiveAppointmentsResponse>('/appointment/doctor/archive/my', {
        method: 'GET',
        token,
    });
}

export async function getDoctorSharedArchiveAppointments(token: string) {
    return http<DoctorArchiveAppointmentsResponse>('/appointment/doctor/archive/shared', {
        method: 'GET',
        token,
    });
}

export async function getConsultationPdfWithPassword(
    token: string,
    appointmentId: string,
    password: string,
): Promise<Blob> {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}/appointment/${appointmentId}/consultation-pdf-auth`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password }),
    });

    if (!response.ok) {
        let message = 'Не вдалося отримати консультативний файл';
        try {
            const data = await response.json();
            if (data?.message) {
                message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
            }
        } catch {}
        throw new Error(message);
    }

    return response.blob();
}

export type AppointmentAgentPreviewFrame = {
    ok: boolean;
    preview: {
        pairKey: string;
        imageDataUrl: string;
        mimeType: string;
        capturedAt: string;
    } | null;
};

export async function startAppointmentAgentPreview(token: string, appointmentId: string, payload: { cabinetDeviceId: string }) {
    return http<{ ok: boolean; pairKey: string; message?: string }>(`/capture-agent/appointment-preview/start`, {
        method: 'POST',
        token,
        body: { appointmentId, cabinetDeviceId: payload.cabinetDeviceId },
    });
}

export async function stopAppointmentAgentPreview(token: string, appointmentId: string, payload: { cabinetDeviceId: string }) {
    return http<{ ok: boolean; message?: string }>(`/capture-agent/appointment-preview/stop`, {
        method: 'POST',
        token,
        body: { appointmentId, cabinetDeviceId: payload.cabinetDeviceId },
    });
}

export async function getAppointmentAgentPreviewFrame(token: string, appointmentId: string, cabinetDeviceId: string) {
    const query = new URLSearchParams({ appointmentId, cabinetDeviceId }).toString();
    return http<AppointmentAgentPreviewFrame>(`/capture-agent/appointment-preview/frame?${query}`, {
        method: 'GET',
        token,
    });
}
