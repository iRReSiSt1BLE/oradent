import { http } from './http';

export type ScheduleBreak = {
    start: string;
    end: string;
};

export type WeeklyDayRule = {
    weekday: number;
    enabled: boolean;
    start: string;
    end: string;
    breaks: ScheduleBreak[];
};

export type CycleRule = {
    workDays: number;
    offDays: number;
    anchorDate: string;
    start: string;
    end: string;
    breaks: ScheduleBreak[];
};

export type DayOverrideRule = {
    date: string;
    enabled: boolean;
    start: string;
    end: string;
    breaks: ScheduleBreak[];
};

export type BlockedSlot = {
    date: string;
    start: string;
    end: string;
    reason?: string;
};

export type RawDoctorSchedule = {
    doctorId: string;
    timezone: string;
    slotMinutes: number;
    templateType: 'WEEKLY' | 'CYCLE';
    weeklyTemplate: WeeklyDayRule[];
    cycleTemplate: CycleRule;
    dayOverrides: DayOverrideRule[];
    blockedDays: string[];
    blockedSlots: BlockedSlot[];
    updatedAt: string;
};

export type MonthDayCell = {
    date: string;
    isWorking: boolean;
    freeSlots: number;
    totalSlots: number;
};

export type MonthScheduleResponse = {
    ok: boolean;
    month: string;
    timezone: string;
    slotMinutes: number;
    days: MonthDayCell[];
};

export type DaySlot = {
    time: string;
    state: 'FREE' | 'BOOKED' | 'BLOCKED';
};

export type DayScheduleResponse = {
    ok: boolean;
    date: string;
    timezone: string;
    slotMinutes: number;
    isWorking: boolean;
    reason: string;
    slots: DaySlot[];
    blockedSlots: BlockedSlot[];
    blockedDay: boolean;
};

export async function getDoctorRawSchedule(token: string, doctorId: string) {
    return http<{ ok: boolean; schedule: RawDoctorSchedule }>(`/doctor-schedule/${doctorId}`, {
        method: 'GET',
        token,
    });
}

export async function updateDoctorScheduleSettings(
    token: string,
    doctorId: string,
    payload: {
        timezone?: string;
        slotMinutes?: number;
        templateType: 'WEEKLY' | 'CYCLE';
        weeklyTemplate?: WeeklyDayRule[];
        cycleTemplate?: CycleRule;
        dayOverrides?: DayOverrideRule[];
    },
) {
    return http<{ ok: boolean; message: string; updatedAt: string }>(`/doctor-schedule/${doctorId}/settings`, {
        method: 'PUT',
        token,
        body: JSON.stringify(payload),
    });
}

export async function blockDoctorDay(token: string, doctorId: string, date: string) {
    return http<{ ok: boolean; message: string; blockedDays: string[] }>(`/doctor-schedule/${doctorId}/block-day`, {
        method: 'POST',
        token,
        body: JSON.stringify({ date }),
    });
}

export async function unblockDoctorDay(token: string, doctorId: string, date: string) {
    return http<{ ok: boolean; message: string; blockedDays: string[] }>(
        `/doctor-schedule/${doctorId}/block-day/${date}`,
        {
            method: 'DELETE',
            token,
        },
    );
}

export async function blockDoctorSlot(
    token: string,
    doctorId: string,
    payload: { date: string; start: string; end: string; reason?: string },
) {
    return http<{ ok: boolean; message: string; blockedSlots: BlockedSlot[] }>(
        `/doctor-schedule/${doctorId}/block-slot`,
        {
            method: 'POST',
            token,
            body: JSON.stringify(payload),
        },
    );
}

export async function unblockDoctorSlot(
    token: string,
    doctorId: string,
    payload: { date: string; start: string; end: string },
) {
    const q = new URLSearchParams(payload).toString();
    return http<{ ok: boolean; message: string; blockedSlots: BlockedSlot[] }>(
        `/doctor-schedule/${doctorId}/unblock-slot?${q}`,
        {
            method: 'PATCH',
            token,
        },
    );
}

export async function getDoctorScheduleMonth(doctorId: string, month: string) {
    return http<MonthScheduleResponse>(`/doctor-schedule/${doctorId}/month?month=${month}`, {
        method: 'GET',
    });
}

export async function getDoctorScheduleDay(doctorId: string, date: string) {
    return http<DayScheduleResponse>(`/doctor-schedule/${doctorId}/day?date=${date}`, {
        method: 'GET',
    });
}
