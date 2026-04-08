import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider';
import { getToken } from '../../shared/utils/authStorage';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import { getAllDoctors } from '../../shared/api/doctorApi';
import {
    getDoctorRawSchedule,
    getDoctorScheduleDay,
    getDoctorScheduleMonth,
    getDoctorDayConflicts,
    updateDoctorScheduleSettings,
    blockDoctorDay,
    unblockDoctorDay,
    type DayConflictsResponse,
    type DayScheduleResponse,
    type MonthDayCell,
    type RawDoctorScheduleResponse,
} from '../../shared/api/doctorScheduleApi';
import {
    adminCancelAppointment,
    adminRescheduleAppointment,
} from '../../shared/api/appointmentApi';
import './DoctorScheduleAdminPage.scss';

type AlertState = {
    variant: 'success' | 'error' | 'info';
    message: string;
} | null;

type DoctorItem = {
    id: string;
    firstName: string;
    lastName: string;
    middleName?: string | null;
};

type CalendarCell =
    | { kind: 'empty'; key: string }
    | { kind: 'day'; key: string; day: MonthDayCell };

function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function currentDateKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
        now.getDate(),
    ).padStart(2, '0')}`;
}

function formatDoctorName(doctor?: DoctorItem | null) {
    if (!doctor) return '';
    return `${doctor.lastName || ''} ${doctor.firstName || ''} ${doctor.middleName || ''}`
        .replace(/\s+/g, ' ')
        .trim();
}

function formatDateTime(value: string | Date | null | undefined, fallback = '—') {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');

    return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}

function monthLabel(monthKey: string, language: string) {
    const [year, month] = monthKey.split('-').map(Number);

    const locale =
        language === 'ua'
            ? 'uk-UA'
            : language === 'de'
                ? 'de-DE'
                : language === 'fr'
                    ? 'fr-FR'
                    : 'en-US';

    const date = new Date(year, month - 1, 1);
    const result = new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
    }).format(date);

    return result.charAt(0).toUpperCase() + result.slice(1);
}

function getWeekdayLabels(language: string) {
    const locale =
        language === 'ua'
            ? 'uk-UA'
            : language === 'de'
                ? 'de-DE'
                : language === 'fr'
                    ? 'fr-FR'
                    : 'en-US';

    const monday = new Date('2026-04-06T00:00:00');
    const labels: string[] = [];

    for (let i = 0; i < 7; i += 1) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        labels.push(
            new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d),
        );
    }

    return labels;
}

function buildCalendarCells(days: MonthDayCell[]): CalendarCell[] {
    if (!days.length) return [];

    const firstDate = new Date(`${days[0].date}T00:00:00`);
    const jsDay = firstDate.getDay();
    const mondayBasedIndex = (jsDay + 6) % 7;

    const leading: CalendarCell[] = Array.from({ length: mondayBasedIndex }, (_, i) => ({
        kind: 'empty',
        key: `empty-start-${i}`,
    }));

    const middle: CalendarCell[] = days.map((day) => ({
        kind: 'day',
        key: day.date,
        day,
    }));

    const total = leading.length + middle.length;
    const trailingCount = (7 - (total % 7)) % 7;

    const trailing: CalendarCell[] = Array.from({ length: trailingCount }, (_, i) => ({
        kind: 'empty',
        key: `empty-end-${i}`,
    }));

    return [...leading, ...middle, ...trailing];
}

function dayNumber(dateKey: string) {
    return dateKey.slice(-2);
}

function buildIsoFromDateAndTime(dateKey: string, time: string) {
    return new Date(`${dateKey}T${time}:00`).toISOString();
}

function defaultDayRule(date: string) {
    return {
        date,
        enabled: true,
        start: '09:00',
        end: '18:00',
        breaks: [{ start: '13:00', end: '14:00' }],
    };
}

function buildDateRange(from: string, to: string) {
    const result: string[] = [];
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
        return result;
    }

    for (
        let d = new Date(start);
        d <= end;
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    ) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        result.push(`${y}-${m}-${day}`);
    }

    return result;
}

function normalizeTimeInput(value: string) {
    const digits = value.replace(/[^\d]/g, '').slice(0, 4);
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function sanitizeTime(value: string, fallback = '09:00') {
    const prepared = value.trim();
    if (!/^\d{2}:\d{2}$/.test(prepared)) return fallback;

    const [h, m] = prepared.split(':').map(Number);
    if (h < 0 || h > 23 || m < 0 || m > 59) return fallback;

    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function DoctorScheduleAdminPage() {
    const token = getToken();
    const { t, language } = useI18n();

    const [alert, setAlert] = useState<AlertState>(null);

    const [doctors, setDoctors] = useState<DoctorItem[]>([]);
    const [loadingDoctors, setLoadingDoctors] = useState(true);
    const [selectedDoctorId, setSelectedDoctorId] = useState('');

    const [rawSchedule, setRawSchedule] =
        useState<RawDoctorScheduleResponse['schedule'] | null>(null);


    const [cycleWorkDays, setCycleWorkDays] = useState(2);
    const [cycleOffDays, setCycleOffDays] = useState(2);
    const [cycleAnchorDate, setCycleAnchorDate] = useState('');

    const [monthKey, setMonthKey] = useState(currentMonthKey());
    const [monthDays, setMonthDays] = useState<MonthDayCell[]>([]);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);

    const [dayData, setDayData] = useState<DayScheduleResponse | null>(null);
    const [dayConflicts, setDayConflicts] = useState<DayConflictsResponse | null>(null);

    const [loadingCalendar, setLoadingCalendar] = useState(false);
    const [loadingDay, setLoadingDay] = useState(false);
    const [savingRules, setSavingRules] = useState(false);
    const [processingAppointmentId, setProcessingAppointmentId] = useState<string | null>(null);

    const [ruleEnabled, setRuleEnabled] = useState(true);
    const [ruleStart, setRuleStart] = useState('09:00');
    const [ruleEnd, setRuleEnd] = useState('18:00');
    const [breakStart, setBreakStart] = useState('13:00');
    const [breakEnd, setBreakEnd] = useState('14:00');

    const [applyRange, setApplyRange] = useState(false);
    const [rangeFrom, setRangeFrom] = useState('');
    const [rangeTo, setRangeTo] = useState('');

    const [rescheduleOpen, setRescheduleOpen] = useState(false);
    const [rescheduleAppointment, setRescheduleAppointment] =
        useState<DayConflictsResponse['appointments'][number] | null>(null);
    const [rescheduleMonth, setRescheduleMonth] = useState(currentMonthKey());
    const [rescheduleMonthDays, setRescheduleMonthDays] = useState<MonthDayCell[]>([]);
    const [rescheduleDate, setRescheduleDate] = useState<string | null>(null);
    const [rescheduleDayData, setRescheduleDayData] = useState<DayScheduleResponse | null>(null);
    const [rescheduleTime, setRescheduleTime] = useState('');
    const [loadingRescheduleMonth, setLoadingRescheduleMonth] = useState(false);
    const [loadingRescheduleDay, setLoadingRescheduleDay] = useState(false);

    const selectedDoctor = useMemo(
        () => doctors.find((item) => item.id === selectedDoctorId) || null,
        [doctors, selectedDoctorId],
    );

    const weekdayLabels = useMemo(() => getWeekdayLabels(language), [language]);
    const calendarCells = useMemo(() => buildCalendarCells(monthDays), [monthDays]);
    const rescheduleCalendarCells = useMemo(
        () => buildCalendarCells(rescheduleMonthDays),
        [rescheduleMonthDays],
    );

    async function loadDoctors() {
        if (!token) return;

        try {
            setLoadingDoctors(true);
            const response = await getAllDoctors(token);
            const list = Array.isArray(response.doctors) ? response.doctors : [];
            setDoctors(list);

            if (!selectedDoctorId && list.length > 0) {
                setSelectedDoctorId(list[0].id);
            }
        } catch (err: any) {
            setAlert({
                variant: 'error',
                message: err?.message || t('doctorScheduleAdmin.loadDoctorsError'),
            });
        } finally {
            setLoadingDoctors(false);
        }
    }

    async function loadRawSchedule() {
        if (!token || !selectedDoctorId) return;

        try {
            const response = await getDoctorRawSchedule(token, selectedDoctorId);
            const schedule = response.schedule;

            setRawSchedule(schedule);
            setCycleWorkDays(schedule.cycleTemplate?.workDays || 2);
            setCycleOffDays(schedule.cycleTemplate?.offDays || 2);
            setCycleAnchorDate(schedule.cycleTemplate?.anchorDate || currentDateKey());
        } catch (err: any) {
            setAlert({
                variant: 'error',
                message: err?.message || t('doctorScheduleAdmin.loadScheduleError'),
            });
        }
    }

    async function loadMonth(nextSelectedDate?: string | null) {
        if (!selectedDoctorId) return;

        try {
            setLoadingCalendar(true);
            const response = await getDoctorScheduleMonth(selectedDoctorId, monthKey);
            const days = Array.isArray(response.days) ? response.days : [];
            setMonthDays(days);

            const targetDate =
                nextSelectedDate ??
                selectedDate ??
                days[0]?.date ??
                null;

            setSelectedDate(targetDate);
        } catch (err: any) {
            setAlert({
                variant: 'error',
                message: err?.message || t('doctorScheduleAdmin.loadCalendarError'),
            });
        } finally {
            setLoadingCalendar(false);
        }
    }

    async function loadDay(dateKey: string | null) {
        if (!selectedDoctorId || !dateKey) {
            setDayData(null);
            setDayConflicts(null);
            return;
        }

        try {
            setLoadingDay(true);

            const [dayResponse, conflictsResponse] = await Promise.all([
                getDoctorScheduleDay(selectedDoctorId, dateKey),
                token
                    ? getDoctorDayConflicts(token, selectedDoctorId, dateKey)
                    : Promise.resolve(null),
            ]);

            setDayData(dayResponse);
            setDayConflicts(conflictsResponse);

            const override = rawSchedule?.dayOverrides?.find((item) => item.date === dateKey);
            const baseRule = override || defaultDayRule(dateKey);

            setRuleEnabled(baseRule.enabled);
            setRuleStart(baseRule.start || '09:00');
            setRuleEnd(baseRule.end || '18:00');
            setBreakStart(baseRule.breaks?.[0]?.start || '13:00');
            setBreakEnd(baseRule.breaks?.[0]?.end || '14:00');

            setRangeFrom(dateKey);
            setRangeTo(dateKey);
        } catch (err: any) {
            setAlert({
                variant: 'error',
                message: err?.message || t('doctorScheduleAdmin.loadDayError'),
            });
        } finally {
            setLoadingDay(false);
        }
    }

    async function reloadAll(preferredDate?: string | null) {
        await loadRawSchedule();
        await loadMonth(preferredDate ?? selectedDate);
        await loadDay(preferredDate ?? selectedDate);
    }

    function openRescheduleModal(
        appointment: DayConflictsResponse['appointments'][number],
    ) {
        setRescheduleAppointment(appointment);
        setRescheduleOpen(true);
        setRescheduleMonth(currentMonthKey());
        setRescheduleMonthDays([]);
        setRescheduleDate(null);
        setRescheduleDayData(null);
        setRescheduleTime('');
    }

    function closeRescheduleModal() {
        setRescheduleOpen(false);
        setRescheduleAppointment(null);
        setRescheduleMonthDays([]);
        setRescheduleDate(null);
        setRescheduleDayData(null);
        setRescheduleTime('');
    }

    async function loadRescheduleMonth(nextDate?: string | null) {
        if (!selectedDoctorId) return;

        try {
            setLoadingRescheduleMonth(true);
            const response = await getDoctorScheduleMonth(selectedDoctorId, rescheduleMonth);
            const days = Array.isArray(response.days) ? response.days : [];
            setRescheduleMonthDays(days);

            if (nextDate) {
                setRescheduleDate(nextDate);
            }
        } catch (err: any) {
            setAlert({
                variant: 'error',
                message: err?.message || t('doctorScheduleAdmin.loadCalendarError'),
            });
        } finally {
            setLoadingRescheduleMonth(false);
        }
    }

    async function loadRescheduleDay(dateKey: string | null) {
        if (!selectedDoctorId || !dateKey) {
            setRescheduleDayData(null);
            return;
        }

        try {
            setLoadingRescheduleDay(true);
            const response = await getDoctorScheduleDay(selectedDoctorId, dateKey);
            setRescheduleDayData(response);
        } catch (err: any) {
            setAlert({
                variant: 'error',
                message: err?.message || t('doctorScheduleAdmin.loadDayError'),
            });
        } finally {
            setLoadingRescheduleDay(false);
        }
    }

    useEffect(() => {
        void loadDoctors();
    }, []);

    useEffect(() => {
        if (!selectedDoctorId) return;
        void loadRawSchedule();
        void loadMonth(null);
    }, [selectedDoctorId, monthKey]);

    useEffect(() => {
        if (!selectedDoctorId || !selectedDate) return;
        void loadDay(selectedDate);
    }, [selectedDoctorId, selectedDate]);

    useEffect(() => {
        if (!rescheduleOpen || !selectedDoctorId) return;
        void loadRescheduleMonth(null);
    }, [rescheduleOpen, selectedDoctorId, rescheduleMonth]);

    useEffect(() => {
        if (!rescheduleOpen || !rescheduleDate) return;
        void loadRescheduleDay(rescheduleDate);
    }, [rescheduleOpen, rescheduleDate]);

    async function handleApplyLocalRules() {
        if (!token || !selectedDoctorId || !selectedDate) return;

        try {
            setSavingRules(true);

            const dates = applyRange && rangeFrom && rangeTo
                ? buildDateRange(rangeFrom, rangeTo)
                : [selectedDate];

            if (!dates.length) {
                setAlert({
                    variant: 'error',
                    message: t('doctorScheduleAdmin.invalidDateRange'),
                });
                return;
            }

            const preparedDayOverrides = dates.map((date) => {
                if (!ruleEnabled) {
                    return {
                        date,
                        enabled: false,
                        start: '00:00',
                        end: '00:01',
                        breaks: [],
                    };
                }

                return {
                    date,
                    enabled: true,
                    start: sanitizeTime(ruleStart, '09:00'),
                    end: sanitizeTime(ruleEnd, '18:00'),
                    breaks:
                        breakStart && breakEnd
                            ? [{
                                start: sanitizeTime(breakStart, '13:00'),
                                end: sanitizeTime(breakEnd, '14:00'),
                            }]
                            : [],
                };
            });

            await updateDoctorScheduleSettings(token, selectedDoctorId, {
                templateType: 'CYCLE',
                cycleTemplate: {
                    workDays: cycleWorkDays,
                    offDays: cycleOffDays,
                    anchorDate: cycleAnchorDate || dates[0],
                    start: sanitizeTime(ruleStart, '09:00'),
                    end: sanitizeTime(ruleEnd, '18:00'),
                    breaks:
                        breakStart && breakEnd
                            ? [{
                                start: sanitizeTime(breakStart, '13:00'),
                                end: sanitizeTime(breakEnd, '14:00'),
                            }]
                            : [],
                },
                dayOverrides: preparedDayOverrides,
            });

            if (!ruleEnabled) {
                for (const date of dates) {
                    try {
                        await blockDoctorDay(token, selectedDoctorId, { date });
                    } catch {}
                }
            } else {
                for (const date of dates) {
                    try {
                        await unblockDoctorDay(token, selectedDoctorId, date);
                    } catch {}
                }
            }

            setAlert({
                variant: 'success',
                message: t('doctorScheduleAdmin.localRulesSaved'),
            });

            await reloadAll(selectedDate);
        } catch (err: any) {
            let message = err?.message || t('doctorScheduleAdmin.saveRulesError');

            try {
                const parsed =
                    typeof err?.message === 'string' ? JSON.parse(err.message) : null;

                if (parsed?.code === 'DAY_HAS_APPOINTMENTS') {
                    message = t('doctorScheduleAdmin.dayHasAppointmentsError');
                } else if (parsed?.code === 'GLOBAL_SLOT_STEP_CHANGE_FORBIDDEN') {
                    message = t('doctorScheduleAdmin.slotStepChangeForbidden');
                }
            } catch {
                if (typeof err?.message === 'string' && err.message.includes('GLOBAL_SLOT_STEP_CHANGE_FORBIDDEN')) {
                    message = t('doctorScheduleAdmin.slotStepChangeForbidden');
                }
            }

            setAlert({ variant: 'error', message });
        } finally {
            setSavingRules(false);
        }
    }

    return (
        <section className="doctor-schedule-admin-page">
            {alert && (
                <AlertToast
                    variant={alert.variant}
                    message={alert.message}
                    onClose={() => setAlert(null)}
                />
            )}

            {rescheduleOpen && rescheduleAppointment && (
                <div
                    className="doctor-schedule-admin-page__modal-backdrop"
                    onClick={closeRescheduleModal}
                >
                    <div
                        className="doctor-schedule-admin-page__modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="doctor-schedule-admin-page__modal-head">
                            <div>
                                <h3>{t('doctorScheduleAdmin.rescheduleTitle')}</h3>
                                <p>{formatDoctorName(selectedDoctor)}</p>
                            </div>

                            <button
                                type="button"
                                className="doctor-schedule-admin-page__modal-close"
                                onClick={closeRescheduleModal}
                            >
                                ×
                            </button>
                        </div>

                        <div className="doctor-schedule-admin-page__modal-body">
                            <div className="doctor-schedule-admin-page__conflict-item doctor-schedule-admin-page__conflict-item--static">
                                <div>
                                    <strong>
                                        {rescheduleAppointment.patient
                                            ? `${rescheduleAppointment.patient.lastName} ${rescheduleAppointment.patient.firstName} ${rescheduleAppointment.patient.middleName || ''}`.replace(/\s+/g, ' ').trim()
                                            : t('doctorScheduleAdmin.unknownPatient')}
                                    </strong>
                                    <p>{formatDateTime(rescheduleAppointment.appointmentDate)}</p>
                                </div>
                            </div>

                            <div className="doctor-schedule-admin-page__calendar-head">
                                <div>
                                    <h3>{t('doctorScheduleAdmin.calendar')}</h3>
                                    <p>{monthLabel(rescheduleMonth, language)}</p>
                                </div>

                                <input
                                    type="month"
                                    value={rescheduleMonth}
                                    onChange={(e) => setRescheduleMonth(e.target.value)}
                                />
                            </div>

                            <div className="doctor-schedule-admin-page__calendar-scroll">
                                <div className="doctor-schedule-admin-page__weekday-row">
                                    {weekdayLabels.map((label) => (
                                        <div key={label} className="doctor-schedule-admin-page__weekday-cell">
                                            {label}
                                        </div>
                                    ))}
                                </div>

                                {loadingRescheduleMonth ? (
                                    <div className="doctor-schedule-admin-page__state">
                                        {t('doctorScheduleAdmin.loadingCalendar')}
                                    </div>
                                ) : (
                                    <div className="doctor-schedule-admin-page__month-grid">
                                        {rescheduleCalendarCells.map((cell) =>
                                            cell.kind === 'empty' ? (
                                                <div
                                                    key={cell.key}
                                                    className="doctor-schedule-admin-page__day doctor-schedule-admin-page__day--empty"
                                                />
                                            ) : (
                                                <button
                                                    key={cell.key}
                                                    type="button"
                                                    className={[
                                                        'doctor-schedule-admin-page__day',
                                                        cell.day.date === rescheduleDate ? 'is-selected' : '',
                                                        cell.day.hasConflicts ? 'is-conflict' : '',
                                                        !cell.day.isWorking ? 'is-off' : cell.day.freeSlots > 0 ? 'is-free' : 'is-busy',
                                                    ].join(' ')}
                                                    onClick={() => {
                                                        setRescheduleDate(cell.day.date);
                                                        setRescheduleTime('');
                                                    }}
                                                >
                                                    <span>{dayNumber(cell.day.date)}</span>
                                                    <small>{cell.day.freeSlots}/{cell.day.totalSlots}</small>
                                                </button>
                                            ),
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="doctor-schedule-admin-page__slots-wrap">
                                <h3>
                                    {rescheduleDate
                                        ? `${t('doctorScheduleAdmin.freeTimeOn')} ${rescheduleDate}`
                                        : t('doctorScheduleAdmin.selectDateFirst')}
                                </h3>

                                {loadingRescheduleDay ? (
                                    <div className="doctor-schedule-admin-page__state">
                                        {t('doctorScheduleAdmin.loadingDay')}
                                    </div>
                                ) : !rescheduleDate ? (
                                    <div className="doctor-schedule-admin-page__state">
                                        {t('doctorScheduleAdmin.selectDateFirst')}
                                    </div>
                                ) : !rescheduleDayData?.isWorking ? (
                                    <div className="doctor-schedule-admin-page__state">
                                        {t('doctorScheduleAdmin.dayUnavailable')}
                                    </div>
                                ) : (
                                    <div className="doctor-schedule-admin-page__slots-grid">
                                        {rescheduleDayData.slots
                                            .filter((slot) => slot.state === 'FREE')
                                            .map((slot) => (
                                                <button
                                                    key={slot.time}
                                                    type="button"
                                                    className={`doctor-schedule-admin-page__slot doctor-schedule-admin-page__slot--free ${
                                                        rescheduleTime === slot.time ? 'is-selected' : ''
                                                    }`}
                                                    onClick={() => setRescheduleTime(slot.time)}
                                                >
                                                    {slot.time}
                                                </button>
                                            ))}
                                    </div>
                                )}
                            </div>

                            <div className="doctor-schedule-admin-page__modal-actions doctor-schedule-admin-page__actions--center">
                                <button
                                    type="button"
                                    className="doctor-schedule-admin-page__secondary"
                                    onClick={closeRescheduleModal}
                                >
                                    {t('common.cancel')}
                                </button>

                                <button
                                    type="button"
                                    className="doctor-schedule-admin-page__primary"
                                    disabled={
                                        !rescheduleDate ||
                                        !rescheduleTime ||
                                        processingAppointmentId === rescheduleAppointment.id
                                    }
                                    onClick={async () => {
                                        if (!token || !rescheduleDate || !rescheduleTime) return;

                                        try {
                                            setProcessingAppointmentId(rescheduleAppointment.id);

                                            await adminRescheduleAppointment(
                                                token,
                                                rescheduleAppointment.id,
                                                {
                                                    doctorId: selectedDoctorId,
                                                    appointmentDate: buildIsoFromDateAndTime(
                                                        rescheduleDate,
                                                        rescheduleTime,
                                                    ),
                                                },
                                            );

                                            setAlert({
                                                variant: 'success',
                                                message: t('doctorScheduleAdmin.rescheduleDone'),
                                            });

                                            closeRescheduleModal();
                                            await reloadAll(selectedDate);
                                        } catch (err: any) {
                                            setAlert({
                                                variant: 'error',
                                                message:
                                                    err?.message ||
                                                    t('doctorScheduleAdmin.rescheduleFailed'),
                                            });
                                        } finally {
                                            setProcessingAppointmentId(null);
                                        }
                                    }}
                                >
                                    {t('doctorScheduleAdmin.confirmReschedule')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}



            <div className="doctor-schedule-admin-page__rules"></div>


            <div className="doctor-schedule-admin-page__container container">
                <h1 className="doctor-schedule-admin-page__title">
                    {t('doctorScheduleAdmin.title')}
                </h1>
                <p className="doctor-schedule-admin-page__subtitle">
                    {t('doctorScheduleAdmin.subtitle')}
                </p>



                <div className="doctor-schedule-admin-page__rules">

                    <div className="doctor-schedule-admin-page__card">
                        <div className="doctor-schedule-admin-page__card-head">
                            <h2>{t('doctorScheduleAdmin.localRulesTitle')}</h2>
                            <p>
                                {selectedDate
                                    ? `${t('doctorScheduleAdmin.selectedDate')}: ${selectedDate}`
                                    : t('doctorScheduleAdmin.selectDate')}
                            </p>
                        </div>

                        <label className="doctor-schedule-admin-page__field">
                            <span>{t('doctorScheduleAdmin.doctor')}</span>
                            <select
                                value={selectedDoctorId}
                                onChange={(e) => setSelectedDoctorId(e.target.value)}
                                disabled={loadingDoctors || !doctors.length}
                            >
                                {doctors.map((doctor) => (
                                    <option key={doctor.id} value={doctor.id}>
                                        {formatDoctorName(doctor)}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <div className="doctor-schedule-admin-page__rules-grid">
                            <label className="doctor-schedule-admin-page__checkbox-card doctor-schedule-admin-page__checkbox-card--full">
                                <span>{t('doctorScheduleAdmin.applyRange')}</span>
                                <button
                                    type="button"
                                    className={`doctor-schedule-admin-page__checkbox-toggle ${applyRange ? 'is-active' : ''}`}
                                    onClick={() => setApplyRange((prev) => !prev)}
                                >
                                    <span className="doctor-schedule-admin-page__checkbox-knob" />
                                </button>
                            </label>

                            {applyRange && (
                                <>
                                    <label className="doctor-schedule-admin-page__field">
                                        <span>{t('doctorScheduleAdmin.rangeFrom')}</span>
                                        <input
                                            type="date"
                                            lang="uk"
                                            value={rangeFrom}
                                            onChange={(e) => setRangeFrom(e.target.value)}
                                        />
                                    </label>

                                    <label className="doctor-schedule-admin-page__field">
                                        <span>{t('doctorScheduleAdmin.rangeTo')}</span>
                                        <input
                                            type="date"
                                            lang="uk"
                                            value={rangeTo}
                                            onChange={(e) => setRangeTo(e.target.value)}
                                        />
                                    </label>
                                </>
                            )}

                            <label className="doctor-schedule-admin-page__field">
                                <span>{t('doctorScheduleAdmin.workDays')}</span>
                                <input
                                    type="number"
                                    min={1}
                                    value={cycleWorkDays}
                                    onChange={(e) => setCycleWorkDays(Math.max(1, Number(e.target.value) || 1))}
                                />
                            </label>

                            <label className="doctor-schedule-admin-page__field">
                                <span>{t('doctorScheduleAdmin.offDays')}</span>
                                <input
                                    type="number"
                                    min={1}
                                    value={cycleOffDays}
                                    onChange={(e) => setCycleOffDays(Math.max(1, Number(e.target.value) || 1))}
                                />
                            </label>

                            <label className="doctor-schedule-admin-page__field">
                                <span>{t('doctorScheduleAdmin.anchorDate')}</span>
                                <input
                                    type="date"
                                    lang="uk"
                                    value={cycleAnchorDate}
                                    onChange={(e) => setCycleAnchorDate(e.target.value)}
                                />
                            </label>

                            <label className="doctor-schedule-admin-page__field">
                                <span>{t('doctorScheduleAdmin.dayStatus')}</span>
                                <select
                                    value={ruleEnabled ? 'working' : 'off'}
                                    onChange={(e) => setRuleEnabled(e.target.value === 'working')}
                                    disabled={!selectedDate}
                                >
                                    <option value="working">{t('doctorScheduleAdmin.workingDay')}</option>
                                    <option value="off">{t('doctorScheduleAdmin.dayOff')}</option>
                                </select>
                            </label>

                            {ruleEnabled && (
                                <>
                                    <label className="doctor-schedule-admin-page__field">
                                        <span>{t('doctorScheduleAdmin.dayStart')}</span>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            maxLength={5}
                                            placeholder="09:00"
                                            value={ruleStart}
                                            onChange={(e) => setRuleStart(normalizeTimeInput(e.target.value))}
                                            disabled={!selectedDate}
                                        />
                                    </label>

                                    <label className="doctor-schedule-admin-page__field">
                                        <span>{t('doctorScheduleAdmin.dayEnd')}</span>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            maxLength={5}
                                            placeholder="18:00"
                                            value={ruleEnd}
                                            onChange={(e) => setRuleEnd(normalizeTimeInput(e.target.value))}
                                            disabled={!selectedDate}
                                        />
                                    </label>

                                    <label className="doctor-schedule-admin-page__field">
                                        <span>{t('doctorScheduleAdmin.breakStart')}</span>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            maxLength={5}
                                            placeholder="13:00"
                                            value={breakStart}
                                            onChange={(e) => setBreakStart(normalizeTimeInput(e.target.value))}
                                            disabled={!selectedDate}
                                        />
                                    </label>

                                    <label className="doctor-schedule-admin-page__field">
                                        <span>{t('doctorScheduleAdmin.breakEnd')}</span>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            maxLength={5}
                                            placeholder="14:00"
                                            value={breakEnd}
                                            onChange={(e) => setBreakEnd(normalizeTimeInput(e.target.value))}
                                            disabled={!selectedDate}
                                        />
                                    </label>
                                </>
                            )}
                        </div>

                        <div className="doctor-schedule-admin-page__actions doctor-schedule-admin-page__actions--center">
                            <button
                                type="button"
                                className="doctor-schedule-admin-page__secondary"
                                disabled={savingRules || !selectedDate}
                                onClick={() => void handleApplyLocalRules()}
                            >
                                {ruleEnabled
                                    ? t('doctorScheduleAdmin.applyLocalRules')
                                    : t('doctorScheduleAdmin.dayOff')}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="doctor-schedule-admin-page__layout">
                    <div className="doctor-schedule-admin-page__calendar-card">
                        <div className="doctor-schedule-admin-page__calendar-head">
                            <div>
                                <h2>{t('doctorScheduleAdmin.calendar')}</h2>
                                <p>{monthLabel(monthKey, language)}</p>
                            </div>

                            <input
                                type="month"
                                value={monthKey}
                                onChange={(e) => setMonthKey(e.target.value)}
                            />
                        </div>

                        <div className="doctor-schedule-admin-page__calendar-scroll">
                            <div className="doctor-schedule-admin-page__weekday-row">
                                {weekdayLabels.map((label) => (
                                    <div key={label} className="doctor-schedule-admin-page__weekday-cell">
                                        {label}
                                    </div>
                                ))}
                            </div>

                            {loadingCalendar ? (
                                <div className="doctor-schedule-admin-page__state">
                                    {t('doctorScheduleAdmin.loadingCalendar')}
                                </div>
                            ) : (
                                <div className="doctor-schedule-admin-page__month-grid">
                                    {calendarCells.map((cell) =>
                                        cell.kind === 'empty' ? (
                                            <div
                                                key={cell.key}
                                                className="doctor-schedule-admin-page__day doctor-schedule-admin-page__day--empty"
                                            />
                                        ) : (
                                            <button
                                                key={cell.key}
                                                type="button"
                                                className={[
                                                    'doctor-schedule-admin-page__day',
                                                    cell.day.date === selectedDate ? 'is-selected' : '',
                                                    cell.day.hasConflicts ? 'is-conflict' : '',
                                                    !cell.day.isWorking ? 'is-off' : cell.day.freeSlots > 0 ? 'is-free' : 'is-busy',
                                                ].join(' ')}
                                                onClick={() => setSelectedDate(cell.day.date)}
                                            >
                                                <span>{dayNumber(cell.day.date)}</span>
                                                <small>{cell.day.freeSlots}/{cell.day.totalSlots}</small>
                                            </button>
                                        ),
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="doctor-schedule-admin-page__day-card">
                        <div className="doctor-schedule-admin-page__day-head">
                            <div>
                                <h2>{formatDoctorName(selectedDoctor)}</h2>
                                <p>
                                    {selectedDate
                                        ? `${t('doctorScheduleAdmin.selectedDate')}: ${selectedDate}`
                                        : t('doctorScheduleAdmin.selectDate')}
                                </p>
                            </div>
                        </div>

                        {dayConflicts?.hasAppointments ? (
                            <div className="doctor-schedule-admin-page__conflict-box">
                                <h3>{t('doctorScheduleAdmin.conflictTitle')}</h3>
                                <p>{t('doctorScheduleAdmin.conflictText')}</p>

                                <div className="doctor-schedule-admin-page__conflict-list">
                                    {dayConflicts.appointments.map((item) => (
                                        <article
                                            key={item.id}
                                            className="doctor-schedule-admin-page__conflict-item"
                                        >
                                            <div>
                                                <strong>
                                                    {item.patient
                                                        ? `${item.patient.lastName} ${item.patient.firstName} ${item.patient.middleName || ''}`.replace(/\s+/g, ' ').trim()
                                                        : t('doctorScheduleAdmin.unknownPatient')}
                                                </strong>
                                                <p>{item.patient?.phone}</p>
                                                <p>{formatDateTime(item.appointmentDate)}</p>
                                            </div>

                                            <div className="doctor-schedule-admin-page__conflict-actions doctor-schedule-admin-page__conflict-actions--inline">
                                                <button
                                                    type="button"
                                                    className="doctor-schedule-admin-page__secondary"
                                                    disabled={processingAppointmentId === item.id}
                                                    onClick={() => openRescheduleModal(item)}
                                                >
                                                    {t('doctorScheduleAdmin.rescheduleAppointment')}
                                                </button>

                                                <button
                                                    type="button"
                                                    className="doctor-schedule-admin-page__secondary"
                                                    disabled={processingAppointmentId === item.id}
                                                    onClick={async () => {
                                                        if (!token) return;

                                                        try {
                                                            setProcessingAppointmentId(item.id);
                                                            await adminCancelAppointment(token, item.id, {});

                                                            setAlert({
                                                                variant: 'success',
                                                                message: t('doctorScheduleAdmin.cancelAppointmentDone'),
                                                            });

                                                            await reloadAll(selectedDate);
                                                        } catch (err: any) {
                                                            setAlert({
                                                                variant: 'error',
                                                                message:
                                                                    err?.message ||
                                                                    t('doctorScheduleAdmin.cancelAppointmentFailed'),
                                                            });
                                                        } finally {
                                                            setProcessingAppointmentId(null);
                                                        }
                                                    }}
                                                >
                                                    {t('doctorScheduleAdmin.cancelAppointment')}
                                                </button>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        <div className="doctor-schedule-admin-page__slots-wrap">
                            <h3>{t('doctorScheduleAdmin.daySlots')}</h3>

                            {loadingDay ? (
                                <div className="doctor-schedule-admin-page__state">
                                    {t('doctorScheduleAdmin.loadingDay')}
                                </div>
                            ) : dayData?.slots?.length ? (
                                <div className="doctor-schedule-admin-page__slots-grid">
                                    {dayData.slots.map((slot) => (
                                        <div
                                            key={slot.time}
                                            className={`doctor-schedule-admin-page__slot doctor-schedule-admin-page__slot--${String(slot.state).toLowerCase()}`}
                                        >
                                            {slot.time}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="doctor-schedule-admin-page__state">
                                    {t('doctorScheduleAdmin.noSlots')}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}