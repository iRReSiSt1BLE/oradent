import { http } from './http';

export type MonthDayCell = {
    date: string;
    isWorking: boolean;
    freeSlots: number;
    totalSlots: number;
    hasConflicts?: boolean;
};

export type DayScheduleResponse = {
    ok: boolean;
    date: string;
    timezone?: string;
    slotMinutes?: number;
    bookingWindowDays?: number;
    isWorking: boolean;
    reason: string;
    slots: Array<{
        time: string;
        state: 'FREE' | 'BOOKED' | 'BLOCKED' | string;
    }>;
    blockedSlots?: Array<{
        date: string;
        start: string;
        end: string;
        reason?: string;
    }>;
    blockedDay?: boolean;
};

export type DayConflictsResponse = {
    ok: boolean;
    date: string;
    hasAppointments: boolean;
    appointmentsCount: number;
    appointments: Array<{
        id: string;
        appointmentDate: string | null;
        status: string;
        patient: {
            id: string;
            lastName: string;
            firstName: string;
            middleName: string | null;
            phone: string | null;
        } | null;
        serviceId: string | null;
    }>;
};

export type RawDoctorScheduleResponse = {
    ok: boolean;
    schedule: {
        doctorId: string;
        timezone: string;
        slotMinutes: number;
        templateType: 'WEEKLY' | 'CYCLE';
        weeklyTemplate: Array<{
            weekday: number;
            enabled: boolean;
            start: string;
            end: string;
            breaks: Array<{ start: string; end: string }>;
        }>;
        cycleTemplate: {
            workDays: number;
            offDays: number;
            anchorDate: string;
            start: string;
            end: string;
            breaks: Array<{ start: string; end: string }>;
        } | null;
        dayOverrides: Array<{
            date: string;
            enabled: boolean;
            start: string;
            end: string;
            breaks: Array<{ start: string; end: string }>;
        }>;
        blockedDays: string[];
        blockedSlots: Array<{
            date: string;
            start: string;
            end: string;
            reason?: string;
        }>;
        updatedAt?: string;
    };
};

export async function getDoctorScheduleMonth(doctorId: string, month: string) {
    return http<{
        ok: boolean;
        month: string;
        timezone?: string;
        slotMinutes?: number;
        bookingWindowDays?: number;
        days: MonthDayCell[];
    }>(`/doctor-schedule/${doctorId}/month?month=${encodeURIComponent(month)}`, {
        method: 'GET',
    });
}

export async function getDoctorScheduleDay(doctorId: string, date: string) {
    return http<DayScheduleResponse>(
        `/doctor-schedule/${doctorId}/day?date=${encodeURIComponent(date)}`,
        {
            method: 'GET',
        },
    );
}

export async function getDoctorDayConflicts(
    token: string,
    doctorId: string,
    date: string,
) {
    return http<DayConflictsResponse>(
        `/doctor-schedule/${doctorId}/day-conflicts?date=${encodeURIComponent(date)}`,
        {
            method: 'GET',
            token,
        },
    );
}

export async function getDoctorRawSchedule(
    token: string,
    doctorId: string,
) {
    return http<RawDoctorScheduleResponse>(`/doctor-schedule/${doctorId}`, {
        method: 'GET',
        token,
    });
}

export async function updateDoctorScheduleSettings(
    token: string,
    doctorId: string,
    body: {
        timezone?: string;
        slotMinutes?: number;
        templateType?: 'WEEKLY' | 'CYCLE';
        weeklyTemplate?: Array<{
            weekday: number;
            enabled: boolean;
            start: string;
            end: string;
            breaks: Array<{ start: string; end: string }>;
        }>;
        cycleTemplate?: {
            workDays: number;
            offDays: number;
            anchorDate: string;
            start: string;
            end: string;
            breaks: Array<{ start: string; end: string }>;
        };
        dayOverrides?: Array<{
            date: string;
            enabled: boolean;
            start: string;
            end: string;
            breaks: Array<{ start: string; end: string }>;
        }>;
    },
) {
    return http<{
        ok: boolean;
        message: string;
        updatedAt?: string;
    }>(`/doctor-schedule/${doctorId}/settings`, {
        method: 'PUT',
        token,
        body: JSON.stringify(body),
    });
}

export async function blockDoctorDay(
    token: string,
    doctorId: string,
    body: {
        date: string;
    },
) {
    return http<{
        ok: boolean;
        message: string;
        blockedDays: string[];
    }>(`/doctor-schedule/${doctorId}/block-day`, {
        method: 'POST',
        token,
        body: JSON.stringify(body),
    });
}

export async function unblockDoctorDay(
    token: string,
    doctorId: string,
    date: string,
) {
    return http<{
        ok: boolean;
        message: string;
        blockedDays: string[];
    }>(`/doctor-schedule/${doctorId}/block-day/${encodeURIComponent(date)}`, {
        method: 'DELETE',
        token,
    });
}

export async function blockDoctorSlot(
    token: string,
    doctorId: string,
    body: {
        date: string;
        start: string;
        end: string;
        reason?: string;
    },
) {
    return http<{
        ok: boolean;
        message: string;
        blockedSlots: Array<{
            date: string;
            start: string;
            end: string;
            reason?: string;
        }>;
    }>(`/doctor-schedule/${doctorId}/block-slot`, {
        method: 'POST',
        token,
        body: JSON.stringify(body),
    });
}

export async function unblockDoctorSlot(
    token: string,
    doctorId: string,
    date: string,
    start: string,
    end: string,
) {
    return http<{
        ok: boolean;
        message: string;
        blockedSlots: Array<{
            date: string;
            start: string;
            end: string;
            reason?: string;
        }>;
    }>(
        `/doctor-schedule/${doctorId}/unblock-slot?date=${encodeURIComponent(date)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
        {
            method: 'PATCH',
            token,
        },
    );
}