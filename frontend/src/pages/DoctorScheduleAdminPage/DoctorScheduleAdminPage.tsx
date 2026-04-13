import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
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

function parseMonthKey(monthKey: string) {
    const [year, month] = monthKey.split('-').map(Number);
    return new Date(year, month - 1, 1);
}

function shiftMonth(monthKey: string, diff: number) {
    const date = parseMonthKey(monthKey);
    date.setMonth(date.getMonth() + diff);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function isBeforeCurrentMonth(monthKey: string) {
    return parseMonthKey(monthKey).getTime() < parseMonthKey(currentMonthKey()).getTime();
}

function patientShortName(
    patient:
        | {
        lastName: string;
        firstName: string;
        middleName: string | null;
    }
        | null
        | undefined,
    fallback: string,
) {
    if (!patient) return fallback;

    const firstInitial = patient.firstName ? `${patient.firstName.charAt(0)}.` : '';
    const middleInitial = patient.middleName ? `${patient.middleName.charAt(0)}.` : '';

    return `${patient.lastName} ${firstInitial} ${middleInitial}`.replace(/\s+/g, ' ').trim();
}

function compareDateKeys(a: string, b: string) {
    return a.localeCompare(b);
}

function buildDatesBetween(a: string, b: string) {
    const start = a <= b ? a : b;
    const end = a <= b ? b : a;

    const result: string[] = [];
    const startDate = new Date(`${start}T00:00:00`);
    const endDate = new Date(`${end}T00:00:00`);

    if (
        Number.isNaN(startDate.getTime()) ||
        Number.isNaN(endDate.getTime())
    ) {
        return result;
    }

    for (
        let d = new Date(startDate);
        d <= endDate;
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    ) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        result.push(`${y}-${m}-${day}`);
    }

    return result;
}

function uniqueSortedDates(items: string[]) {
    return [...new Set(items)].sort(compareDateKeys);
}

function minDateKey(items: string[]) {
    if (!items.length) return '';
    return [...items].sort(compareDateKeys)[0];
}

function maxDateKey(items: string[]) {
    if (!items.length) return '';
    return [...items].sort(compareDateKeys)[items.length - 1];
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

    const [monthKey, setMonthKey] = useState(currentMonthKey());
    const [monthDays, setMonthDays] = useState<MonthDayCell[]>([]);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);

    const [workDaysConfigEnabled, setWorkDaysConfigEnabled] = useState(false);
    const [workDaysMode, setWorkDaysMode] = useState<'cycle' | 'manual'>('cycle');
    const [manualWeekdays, setManualWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);

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

    const calendarAreaRef = useRef<HTMLDivElement | null>(null);
    const rescheduleAreaRef = useRef<HTMLDivElement | null>(null);
    const layoutAreaRef = useRef<HTMLDivElement | null>(null);

    const [selectedDaySlot, setSelectedDaySlot] = useState('');
    const [conflictsExpanded, setConflictsExpanded] = useState(false);
    const [expandedConflictIds, setExpandedConflictIds] = useState<string[]>([]);

    const [selectedDates, setSelectedDates] = useState<string[]>([]);
    const [rangeAnchorDate, setRangeAnchorDate] = useState<string | null>(null);
    const [isRangePicking, setIsRangePicking] = useState(false);
    const [scheduleStartDate, setScheduleStartDate] = useState<string | null>(null);
    const [calendarViewMode, setCalendarViewMode] = useState<'month' | 'slots'>('month');
    const [pressTimerId, setPressTimerId] = useState<number | null>(null);

    const [showRulesHelp, setShowRulesHelp] = useState(false);

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
            setWorkDaysConfigEnabled(false);
            setWorkDaysMode(schedule.workDaysMode || 'cycle');
            setManualWeekdays(schedule.manualWeekTemplate?.weekdays || [1, 2, 3, 4, 5]);
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
            const rawDays = Array.isArray(response.days) ? response.days : [];
            const todayKey = currentDateKey();

            const days = rawDays.filter((day) => {
                if (day.date < todayKey) return false;
                if (day.date === todayKey && day.freeSlots <= 0) return false;
                return true;
            });

            setMonthDays(days);

            const targetDate =
                nextSelectedDate !== undefined
                    ? nextSelectedDate
                    : selectedDate;

            setSelectedDate(targetDate ?? null);

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

            if (baseRule.enabled) {
                setRuleStart(baseRule.start || '09:00');
                setRuleEnd(baseRule.end || '18:00');
                setBreakStart(baseRule.breaks?.[0]?.start || '13:00');
                setBreakEnd(baseRule.breaks?.[0]?.end || '14:00');
            } else {
                setRuleStart('09:00');
                setRuleEnd('18:00');
                setBreakStart('13:00');
                setBreakEnd('14:00');
            }

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
        setRescheduleDate(null);
        setRescheduleTime('');
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
            const rawDays = Array.isArray(response.days) ? response.days : [];
            const todayKey = currentDateKey();

            const days = rawDays.filter((day) => {
                if (day.date < todayKey) return false;
                if (day.date === todayKey && day.freeSlots <= 0) return false;
                return true;
            });

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

        setSelectedDate(null);
        setSelectedDaySlot('');
        setSelectedDates([]);
        setRangeAnchorDate(null);
        setIsRangePicking(false);
        setScheduleStartDate(null);
        setCalendarViewMode('month');
        setRescheduleDate(null);
        setRescheduleTime('');
        setWorkDaysConfigEnabled(false);
        void loadRawSchedule();
        void loadMonth(null);
    }, [selectedDoctorId]);

    useEffect(() => {
        if (!selectedDoctorId) return;
        void loadMonth(selectedDate);
    }, [monthKey, selectedDoctorId]);

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

    useEffect(() => {
        function handleDocumentMouseDown(event: MouseEvent) {
            const target = event.target as Node;

            if (
                layoutAreaRef.current &&
                !layoutAreaRef.current.contains(target)
            ) {
                if (calendarViewMode === 'month') {
                    setSelectedDate(null);
                    setSelectedDaySlot('');
                    setSelectedDates([]);
                    setRangeAnchorDate(null);
                    setIsRangePicking(false);
                } else {
                    setSelectedDaySlot('');
                }
            }

            if (
                rescheduleOpen &&
                rescheduleAreaRef.current &&
                !rescheduleAreaRef.current.contains(target)
            ) {
                return;
            }
        }

        document.addEventListener('mousedown', handleDocumentMouseDown);
        return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
    }, [calendarViewMode]);


    useEffect(() => {
        if (!selectedDates.length) {
            setApplyRange(false);
            return;
        }

        if (selectedDates.length === 1) {
            setApplyRange(false);
            setRangeFrom(selectedDates[0]);
            setRangeTo(selectedDates[0]);
            return;
        }

        setApplyRange(true);
        setRangeFrom(minDateKey(selectedDates));
        setRangeTo(maxDateKey(selectedDates));
    }, [selectedDates]);

    useEffect(() => {
        if (calendarViewMode === 'month') {
            setConflictsExpanded(false);
            setExpandedConflictIds([]);
        }
    }, [calendarViewMode]);


    useEffect(() => {
        function handleOutsideHelpClick() {
            setShowRulesHelp(false);
        }

        if (!showRulesHelp) return;

        document.addEventListener('click', handleOutsideHelpClick);
        return () => document.removeEventListener('click', handleOutsideHelpClick);
    }, [showRulesHelp]);


    function toggleManualWeekday(day: number) {
        setManualWeekdays((prev) =>
            prev.includes(day)
                ? prev.filter((item) => item !== day)
                : [...prev, day].sort((a, b) => a - b),
        );
    }

    function toggleConflictAppointment(id: string) {
        setExpandedConflictIds((prev) =>
            prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
        );
    }



    function startDayLongPress(date: string) {
        if (pressTimerId) {
            window.clearTimeout(pressTimerId);
        }

        const timer = window.setTimeout(() => {
            setScheduleStartDate((prev) => (prev === date ? null : date));
        }, 450);

        setPressTimerId(timer);
    }

    function stopDayLongPress() {
        if (pressTimerId) {
            window.clearTimeout(pressTimerId);
            setPressTimerId(null);
        }
    }

    function handleCalendarDayClick(
        event: ReactMouseEvent<HTMLButtonElement>,
        date: string,
    ) {
        const withCtrl = event.ctrlKey || event.metaKey;
        const withShift = event.shiftKey;

        setSelectedDaySlot('');

        if (withCtrl) {
            setSelectedDate(null);
            setSelectedDates((prev) =>
                prev.includes(date)
                    ? prev.filter((item) => item !== date)
                    : uniqueSortedDates([...prev, date]),
            );
            return;
        }

        if (withShift) {
            const anchor = rangeAnchorDate || selectedDate || selectedDates[0] || date;
            const range = buildDatesBetween(anchor, date);

            setRangeAnchorDate(anchor);
            setSelectedDates((prev) => uniqueSortedDates([...prev, ...range]));
            setSelectedDate(null);
            setIsRangePicking(false);
            return;
        }

        if (isRangePicking) {
            const anchor = rangeAnchorDate || selectedDate || selectedDates[0] || date;
            const range = buildDatesBetween(anchor, date);

            setRangeAnchorDate(anchor);
            setSelectedDates((prev) => uniqueSortedDates([...prev, ...range]));
            setSelectedDate(null);
            setIsRangePicking(false);
            return;
        }

        setSelectedDate(date);
        setSelectedDates((prev) => (prev.length > 1 ? prev : [date]));
        setRangeAnchorDate(date);
        setIsRangePicking(false);
    }


    function handleCalendarDayHover(date: string) {
        if (!isRangePicking) return;

        const anchor = rangeAnchorDate || selectedDate;
        if (!anchor) return;

        setSelectedDates(buildDatesBetween(anchor, date));
    }

    async function handleApplyLocalRules() {
        if (!token || !selectedDoctorId || (!selectedDate && !selectedDates.length && !scheduleStartDate)) {
            return;
        }

        try {
            setSavingRules(true);

            const explicitDates =
                selectedDates.length > 0
                    ? uniqueSortedDates(selectedDates)
                    : applyRange && rangeFrom && rangeTo
                        ? buildDateRange(rangeFrom, rangeTo)
                        : selectedDate
                            ? [selectedDate]
                            : [];

            const hasScheduleTemplate = workDaysConfigEnabled && !!scheduleStartDate;

            const manualOverrideDates = hasScheduleTemplate
                ? explicitDates.filter((date) => date !== scheduleStartDate)
                : explicitDates;

            const preparedDayOverrides = manualOverrideDates.map((date) => {
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
                            ? [
                                {
                                    start: sanitizeTime(breakStart, '13:00'),
                                    end: sanitizeTime(breakEnd, '14:00'),
                                },
                            ]
                            : [],
                };
            });

            if (workDaysConfigEnabled && !scheduleStartDate) {
                setAlert({
                    variant: 'info',
                    message: t('doctorScheduleAdmin.selectScheduleStartDate'),
                });
                return;
            }

            if (hasScheduleTemplate) {
                await updateDoctorScheduleSettings(token, selectedDoctorId, {
                    workDaysConfigEnabled: true,
                    workDaysMode,
                    cycleTemplate:
                        workDaysMode === 'cycle'
                            ? {
                                workDays: cycleWorkDays,
                                offDays: cycleOffDays,
                                anchorDate: scheduleStartDate!,
                                start: sanitizeTime(ruleStart, '09:00'),
                                end: sanitizeTime(ruleEnd, '18:00'),
                                breaks:
                                    breakStart && breakEnd
                                        ? [
                                            {
                                                start: sanitizeTime(breakStart, '13:00'),
                                                end: sanitizeTime(breakEnd, '14:00'),
                                            },
                                        ]
                                        : [],
                            }
                            : undefined,
                    manualWeekTemplate:
                        workDaysMode === 'manual'
                            ? {
                                anchorDate: scheduleStartDate!,
                                weekdays: manualWeekdays,
                                start: sanitizeTime(ruleStart, '09:00'),
                                end: sanitizeTime(ruleEnd, '18:00'),
                                breaks:
                                    breakStart && breakEnd
                                        ? [
                                            {
                                                start: sanitizeTime(breakStart, '13:00'),
                                                end: sanitizeTime(breakEnd, '14:00'),
                                            },
                                        ]
                                        : [],
                            }
                            : undefined,
                    replaceDayOverrides: true,
                    dayOverrides: preparedDayOverrides,
                });
            } else if (preparedDayOverrides.length) {
                await updateDoctorScheduleSettings(token, selectedDoctorId, {
                    dayOverrides: preparedDayOverrides,
                    replaceDayOverrides: false,
                });
            } else {
                setAlert({
                    variant: 'info',
                    message: t('doctorScheduleAdmin.invalidDateRange'),
                });
                return;
            }

            const conflictedDates: string[] = [];

            if (!ruleEnabled) {
                for (const date of manualOverrideDates) {
                    try {
                        await blockDoctorDay(token, selectedDoctorId, { date });
                    } catch {
                        conflictedDates.push(date);
                    }
                }
            } else {
                for (const date of manualOverrideDates) {
                    try {
                        await unblockDoctorDay(token, selectedDoctorId, date);
                    } catch {
                        conflictedDates.push(date);
                    }
                }
            }

            setAlert({
                variant: conflictedDates.length ? 'info' : 'success',
                message: conflictedDates.length
                    ? t('doctorScheduleAdmin.localRulesPartialSaved')
                    : t('doctorScheduleAdmin.localRulesSaved'),
            });

            const preferredDate =
                selectedDate ||
                scheduleStartDate ||
                minDateKey(explicitDates) ||
                null;

            await loadRawSchedule();
            await loadMonth(preferredDate);

            if (preferredDate) {
                await loadDay(preferredDate);
            }

            setSelectedDate(null);
            setSelectedDaySlot('');
            setSelectedDates([]);
            setRangeAnchorDate(null);
            setIsRangePicking(false);
            setScheduleStartDate(null);
            setCalendarViewMode('month');
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
                if (
                    typeof err?.message === 'string' &&
                    err.message.includes('GLOBAL_SLOT_STEP_CHANGE_FORBIDDEN')
                ) {
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
                        className="doctor-schedule-admin-page__modal doctor-schedule-admin-page__modal--reschedule"
                        onClick={(e) => e.stopPropagation()}
                        ref={rescheduleAreaRef}
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

                        <div className="doctor-schedule-admin-page__modal-current">
                            <p className="doctor-schedule-admin-page__modal-current-title">
                                {rescheduleAppointment.patient
                                    ? `${rescheduleAppointment.patient.lastName} ${rescheduleAppointment.patient.firstName} ${rescheduleAppointment.patient.middleName || ''}`
                                        .replace(/\s+/g, ' ')
                                        .trim()
                                    : t('doctorScheduleAdmin.unknownPatient')}
                            </p>
                            <p className="doctor-schedule-admin-page__modal-current-meta">
                                {formatDateTime(rescheduleAppointment.appointmentDate)}
                            </p>
                        </div>

                        <div className="doctor-schedule-admin-page__calendar-card doctor-schedule-admin-page__calendar-card--reschedule-single">
                            <h3 className="doctor-schedule-admin-page__calendar-title">
                                {rescheduleDate ? null : t('doctorScheduleAdmin.calendar')}
                            </h3>

                            <div className="doctor-schedule-admin-page__month-nav doctor-schedule-admin-page__month-nav--reschedule">
                                {rescheduleDate ? null : (
                                    <>
                                        <span className="doctor-schedule-admin-page__month-label">
                {monthLabel(rescheduleMonth, language)}
            </span>

                                        <button
                                            type="button"
                                            className="doctor-schedule-admin-page__month-nav-btn"
                                            onClick={() => {
                                                setRescheduleMonth(shiftMonth(rescheduleMonth, 1));
                                                setRescheduleDate(null);
                                                setRescheduleTime('');
                                            }}
                                        >
                                            ›
                                        </button>
                                    </>
                                )}
                            </div>

                            {!rescheduleDate ? (
                                <>
                                    <div className="doctor-schedule-admin-page__calendar-scroll">
                                        <div className="doctor-schedule-admin-page__weekday-row">
                                            {weekdayLabels.map((label) => (
                                                <div
                                                    key={label}
                                                    className="doctor-schedule-admin-page__weekday-cell is-workday"
                                                >
                                                    {label}
                                                </div>
                                            ))}
                                        </div>

                                        {loadingRescheduleMonth ? (
                                            <div className="doctor-schedule-admin-page__skeleton-grid-days">
                                                {Array.from({ length: 35 }).map((_, index) => (
                                                    <div
                                                        key={`reschedule-skeleton-day-${index}`}
                                                        className="doctor-schedule-admin-page__skeleton doctor-schedule-admin-page__skeleton--day"
                                                    />
                                                ))}
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
                                                                !cell.day.isWorking
                                                                    ? 'is-off'
                                                                    : cell.day.date === currentDateKey() &&
                                                                    cell.day.freeSlots <= 0
                                                                        ? 'is-busy'
                                                                        : cell.day.freeSlots > 0
                                                                            ? 'is-free'
                                                                            : 'is-busy',
                                                            ].join(' ')}
                                                            onClick={(e) => {
                                                                e.stopPropagation();

                                                                if (!cell.day.isWorking) {
                                                                    setAlert({
                                                                        variant: 'info',
                                                                        message: t('doctorScheduleAdmin.dayUnavailable'),
                                                                    });
                                                                    return;
                                                                }

                                                                setRescheduleDate(cell.day.date);
                                                                setRescheduleTime('');
                                                            }}
                                                        >
                                                            <span>{dayNumber(cell.day.date)}</span>
                                                            <small>
                                                                {cell.day.freeSlots}/{cell.day.totalSlots}
                                                            </small>
                                                        </button>
                                                    ),
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div className="doctor-schedule-admin-page__slots-wrap doctor-schedule-admin-page__slots-wrap--reschedule">
                                    <div className="doctor-schedule-admin-page__slots-head-row">
                                        <p className="doctor-schedule-admin-page__selection-summary">
                                            {`${t('doctorScheduleAdmin.selectedDate')}: ${rescheduleDate}`}
                                        </p>

                                        <button
                                            type="button"
                                            className="doctor-schedule-admin-page__month-nav-btn doctor-schedule-admin-page__month-nav-btn--back"
                                            onClick={() => {
                                                setRescheduleDate(null);
                                                setRescheduleTime('');
                                            }}
                                        >
                                            ‹
                                        </button>
                                    </div>

                                    {loadingRescheduleDay ? (
                                        <div className="doctor-schedule-admin-page__skeleton-grid-slots">
                                            {Array.from({ length: 20 }).map((_, index) => (
                                                <div
                                                    key={`reschedule-skeleton-slot-${index}`}
                                                    className="doctor-schedule-admin-page__skeleton doctor-schedule-admin-page__skeleton--slot"
                                                />
                                            ))}
                                        </div>
                                    ) : !rescheduleDayData?.isWorking ? (
                                        <p className="doctor-schedule-admin-page__day-off-note">
                                            {t('doctorScheduleAdmin.dayUnavailable')}
                                        </p>
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
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setRescheduleTime(slot.time);
                                                        }}
                                                    >
                                                        {slot.time}
                                                    </button>
                                                ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="doctor-schedule-admin-page__modal-footer">
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
                                {processingAppointmentId === rescheduleAppointment.id ? (
                                    <span className="doctor-schedule-admin-page__button-loading">
                            <span className="doctor-schedule-admin-page__button-spinner" />
                                        {t('doctorScheduleAdmin.saving')}
                        </span>
                                ) : (
                                    t('doctorScheduleAdmin.confirmReschedule')
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}




            <div className="doctor-schedule-admin-page__container container">
                <h1 className="doctor-schedule-admin-page__title">
                    {t('doctorScheduleAdmin.title')}
                </h1>




                <div className="doctor-schedule-admin-page__layout" ref={layoutAreaRef}>
                    <div className="doctor-schedule-admin-page__calendar-card">
                        <div className="doctor-schedule-admin-page__calendar-top">
                            <div>
                            </div>

                            <div className="doctor-schedule-admin-page__month-nav">
                                {calendarViewMode === 'slots' ? (
                                    <></>
                                ) : (
                                    <>
                                        <button
                                            type="button"
                                            className="doctor-schedule-admin-page__month-nav-btn"
                                            disabled={isBeforeCurrentMonth(shiftMonth(monthKey, -1))}
                                            onClick={() => {
                                                const prev = shiftMonth(monthKey, -1);
                                                if (!isBeforeCurrentMonth(prev)) {
                                                    setMonthKey(prev);
                                                    setSelectedDate(null);
                                                    setSelectedDaySlot('');
                                                }
                                            }}
                                        >
                                            ‹
                                        </button>

                                        <span className="doctor-schedule-admin-page__month-label">
                    {monthLabel(monthKey, language)}
                </span>

                                        <button
                                            type="button"
                                            className="doctor-schedule-admin-page__month-nav-btn"
                                            onClick={() => {
                                                setMonthKey(shiftMonth(monthKey, 1));
                                                setSelectedDate(null);
                                                setSelectedDaySlot('');
                                            }}
                                        >
                                            ›
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {calendarViewMode === 'month' ? (
                            <div
                                className="doctor-schedule-admin-page__calendar-scroll"
                                ref={calendarAreaRef}
                            >
                                <div className="doctor-schedule-admin-page__weekday-row">
                                    {weekdayLabels.map((label, index) => {
                                        const weekdayMap = [1, 2, 3, 4, 5, 6, 0];
                                        const weekdayValue = weekdayMap[index];
                                        const weekend = index >= 5;
                                        const manualActive =
                                            workDaysConfigEnabled &&
                                            workDaysMode === 'manual' &&
                                            manualWeekdays.includes(weekdayValue);

                                        return (
                                            <button
                                                key={label}
                                                type="button"
                                                className={`doctor-schedule-admin-page__weekday-cell ${
                                                    weekend ? 'is-weekend' : 'is-workday'
                                                } ${manualActive ? 'is-manual-active' : ''}`}
                                                onClick={() => {
                                                    if (workDaysConfigEnabled && workDaysMode === 'manual') {
                                                        toggleManualWeekday(weekdayValue);
                                                    }
                                                }}
                                            >
                                                {label}
                                            </button>
                                        );
                                    })}
                                </div>

                                {loadingCalendar ? (
                                    <div className="doctor-schedule-admin-page__skeleton-grid-days">
                                        {Array.from({ length: 35 }).map((_, index) => (
                                            <div
                                                key={`calendar-skeleton-day-${index}`}
                                                className="doctor-schedule-admin-page__skeleton doctor-schedule-admin-page__skeleton--day"
                                            />
                                        ))}
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
                                                        selectedDates.includes(cell.day.date) ? 'is-range' : '',
                                                        scheduleStartDate === cell.day.date ? 'is-schedule-start' : '',
                                                        cell.day.hasConflicts ? 'is-conflict' : '',
                                                        !cell.day.isWorking
                                                            ? 'is-off'
                                                            : cell.day.date === currentDateKey() && cell.day.freeSlots <= 0
                                                                ? 'is-busy'
                                                                : cell.day.freeSlots > 0
                                                                    ? 'is-free'
                                                                    : 'is-busy',
                                                    ].join(' ')}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleCalendarDayClick(e, cell.day.date);
                                                    }}
                                                    onDoubleClick={(e) => {
                                                        e.stopPropagation();

                                                        if (!cell.day.isWorking) {
                                                            setAlert({
                                                                variant: 'info',
                                                                message: t('doctorScheduleAdmin.dayUnavailable'),
                                                            });
                                                            return;
                                                        }

                                                        setSelectedDate(cell.day.date);
                                                        setCalendarViewMode('slots');
                                                    }}
                                                    onMouseEnter={() => handleCalendarDayHover(cell.day.date)}
                                                    onMouseDown={(e) => {
                                                        e.stopPropagation();
                                                        startDayLongPress(cell.day.date);
                                                    }}
                                                    onMouseUp={(e) => {
                                                        e.stopPropagation();
                                                        stopDayLongPress();
                                                    }}
                                                    onMouseLeave={stopDayLongPress}
                                                    onContextMenu={(e) => e.preventDefault()}
                                                >
                                                    <span>{dayNumber(cell.day.date)}</span>
                                                    <small>
                                                        {cell.day.freeSlots}/{cell.day.totalSlots}
                                                    </small>
                                                </button>
                                            ),
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : (
                                <div
                                    className={`doctor-schedule-admin-page__slots-wrap doctor-schedule-admin-page__slots-wrap--with-overlay ${
                                        dayConflicts?.hasAppointments ? 'has-conflicts' : ''
                                    }`}
                                    ref={calendarAreaRef}
                                >
                                    <div className="doctor-schedule-admin-page__slots-topbar">
                                        {dayConflicts?.hasAppointments ? (
                                            <div
                                                className={`doctor-schedule-admin-page__slots-conflicts ${
                                                    conflictsExpanded ? 'is-open' : ''
                                                }`}
                                            >
                                                <div
                                                    className="doctor-schedule-admin-page__slots-conflicts-head"
                                                    onClick={() =>
                                                        setConflictsExpanded((prev) => {
                                                            const next = !prev;
                                                            if (!next) {
                                                                setExpandedConflictIds([]);
                                                            }
                                                            return next;
                                                        })
                                                    }
                                                >
                                                    <h3 className="doctor-schedule-admin-page__appointments-title">
                                                        {t('doctorScheduleAdmin.conflictTitle')}
                                                    </h3>

                                                    <span
                                                        className={`doctor-schedule-admin-page__chevron ${
                                                            conflictsExpanded ? 'is-open' : ''
                                                        }`}
                                                    />
                                                </div>

                                                {conflictsExpanded ? (
                                                    <div className="doctor-schedule-admin-page__slots-conflicts-body">
                                                        {dayConflicts.appointments.map((item) => {
                                                            const isOpen = expandedConflictIds.includes(item.id);

                                                            return (
                                                                <article
                                                                    key={item.id}
                                                                    className="doctor-schedule-admin-page__appointment-row"
                                                                >
                                                                    <div
                                                                        className="doctor-schedule-admin-page__appointment-row-head"
                                                                        onClick={() => toggleConflictAppointment(item.id)}
                                                                    >
                                                                        <div className="doctor-schedule-admin-page__appointment-row-main">
                                                                            <p className="doctor-schedule-admin-page__appointment-short">
                                                                                {patientShortName(
                                                                                    item.patient,
                                                                                    t('doctorScheduleAdmin.unknownPatient'),
                                                                                )}
                                                                            </p>
                                                                            <p className="doctor-schedule-admin-page__appointment-time">
                                                                                {item.appointmentDate
                                                                                    ? formatDateTime(item.appointmentDate).slice(-5)
                                                                                    : '—'}
                                                                            </p>
                                                                        </div>

                                                                        <span
                                                                            className={`doctor-schedule-admin-page__chevron ${
                                                                                isOpen ? 'is-open' : ''
                                                                            }`}
                                                                        />
                                                                    </div>

                                                                    {isOpen ? (
                                                                        <div className="doctor-schedule-admin-page__appointment-expand">
                                                                            <div className="doctor-schedule-admin-page__appointment-details">
                                                                                <div>
                                                                                    {item.patient
                                                                                        ? `${item.patient.lastName} ${item.patient.firstName} ${item.patient.middleName || ''}`
                                                                                            .replace(/\s+/g, ' ')
                                                                                            .trim()
                                                                                        : t('doctorScheduleAdmin.unknownPatient')}
                                                                                </div>
                                                                                <div>{item.patient?.phone || '—'}</div>
                                                                            </div>

                                                                            <div className="doctor-schedule-admin-page__conflict-actions doctor-schedule-admin-page__actions--center">
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
                                                                        </div>
                                                                    ) : null}
                                                                </article>
                                                            );
                                                        })}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : (
                                            <div />
                                        )}

                                        <button
                                            type="button"
                                            className="doctor-schedule-admin-page__month-nav-btn"
                                            onClick={() => {
                                                setCalendarViewMode('month');
                                                setSelectedDaySlot('');
                                                setConflictsExpanded(false);
                                                setExpandedConflictIds([]);
                                            }}
                                        >
                                            ‹
                                        </button>
                                    </div>

                                    {loadingDay ? (
                                        <div className="doctor-schedule-admin-page__skeleton-grid-slots">
                                            {Array.from({ length: 20 }).map((_, index) => (
                                                <div
                                                    key={`slot-skeleton-${index}`}
                                                    className="doctor-schedule-admin-page__skeleton doctor-schedule-admin-page__skeleton--slot"
                                                />
                                            ))}
                                        </div>
                                    ) : dayData?.isWorking ? (
                                        dayData.slots.length ? (
                                            <div className="doctor-schedule-admin-page__slots-grid">
                                                {dayData.slots.map((slot) => (
                                                    <button
                                                        key={slot.time}
                                                        type="button"
                                                        className={[
                                                            'doctor-schedule-admin-page__slot',
                                                            slot.state === 'FREE'
                                                                ? 'doctor-schedule-admin-page__slot--free'
                                                                : slot.state === 'BOOKED'
                                                                    ? 'doctor-schedule-admin-page__slot--booked'
                                                                    : 'doctor-schedule-admin-page__slot--blocked',
                                                            selectedDaySlot === slot.time ? 'is-selected' : '',
                                                        ].join(' ')}
                                                        disabled={slot.state !== 'FREE'}
                                                        onClick={() => {
                                                            if (slot.state === 'FREE') {
                                                                setSelectedDaySlot(slot.time);
                                                            }
                                                        }}
                                                    >
                                                        {slot.time}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="doctor-schedule-admin-page__day-off-note">
                                                {t('doctorScheduleAdmin.noSlots')}
                                            </p>
                                        )
                                    ) : (
                                       <></>
                                    )}
                                </div>
                            )}
                    </div>

                    <div className="doctor-schedule-admin-page__day-card doctor-schedule-admin-page__day-card--main">
                        <div className="doctor-schedule-admin-page__card-head doctor-schedule-admin-page__card-head--with-help">
                            <div>
                                <p className="doctor-schedule-admin-page__selection-summary">
                                    {selectedDates.length > 1
                                        ? `${t('doctorScheduleAdmin.selectedRange')}: ${minDateKey(selectedDates)} — ${maxDateKey(selectedDates)}`
                                        : selectedDate
                                            ? `${t('doctorScheduleAdmin.selectedDate')}: ${selectedDate}`
                                            : t('doctorScheduleAdmin.selectDate')}
                                </p>
                            </div>

                            <button
                                type="button"
                                className="doctor-schedule-admin-page__help-btn"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowRulesHelp((prev) => !prev);
                                }}
                                aria-label="rules help"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                                    <g fill="none" stroke="#000" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.1">
                                        <circle cx="12" cy="12" r="10" />
                                        <path d="M12 16v-4m0-4h.01" />
                                    </g>
                                </svg>
                            </button>

                            {showRulesHelp ? (
                                <div
                                    className="doctor-schedule-admin-page__help-popover"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <h4>{t('doctorScheduleAdmin.rulesHelpTitle')}</h4>
                                    <div className="doctor-schedule-admin-page__help-list">
                                        <div className="doctor-schedule-admin-page__help-row">
        <span className="doctor-schedule-admin-page__help-key doctor-schedule-admin-page__help-key--shift">
            <svg width="120" height="54" viewBox="0 0 120 54" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="120" height="54" rx="11" fill="#90A4AE"/>
                <rect width="120" height="45" rx="10" fill="#CFD8DC"/>
                <path d="M25.905 14.0705C26.0453 13.9207 26.2149 13.8012 26.4032 13.7195C26.5916 13.6378 26.7947 13.5957 27 13.5957C27.2053 13.5957 27.4084 13.6378 27.5968 13.7195C27.7851 13.8012 27.9547 13.9207 28.095 14.0705L37.6125 24.2255C38.5125 25.1825 37.8315 26.75 36.5175 26.75H32.25V31.25C32.25 31.6479 32.092 32.0294 31.8107 32.3107C31.5294 32.592 31.1478 32.75 30.75 32.75H23.25C22.8522 32.75 22.4706 32.592 22.1893 32.3107C21.908 32.0294 21.75 31.6479 21.75 31.25V26.75H17.481C16.17 26.75 15.489 25.1825 16.386 24.224L25.905 14.0705ZM36.519 25.25L27 15.0965L17.481 25.25H21.75C22.1478 25.25 22.5294 25.4081 22.8107 25.6894C23.092 25.9707 23.25 26.3522 23.25 26.75V31.25H30.75V26.75C30.75 26.3522 30.908 25.9707 31.1893 25.6894C31.4706 25.4081 31.8522 25.25 32.25 25.25H36.519Z" fill="black" stroke="black" strokeWidth="0.75"/>
                <path d="M48.192 31.24C46.192 31.24 44.584 30.984 43.368 30.472V28.168C44.056 28.424 44.792 28.632 45.576 28.792C46.376 28.952 47.168 29.032 47.952 29.032C49.184 29.032 50.104 28.888 50.712 28.6C51.336 28.312 51.648 27.736 51.648 26.872C51.648 26.344 51.52 25.92 51.264 25.6C51.008 25.28 50.584 25.008 49.992 24.784C49.4 24.544 48.584 24.296 47.544 24.04C45.88 23.608 44.712 23.064 44.04 22.408C43.368 21.736 43.032 20.816 43.032 19.648C43.032 18.288 43.528 17.224 44.52 16.456C45.512 15.688 46.992 15.304 48.96 15.304C49.856 15.304 50.696 15.368 51.48 15.496C52.28 15.624 52.904 15.768 53.352 15.928V18.232C52.136 17.768 50.792 17.536 49.32 17.536C48.168 17.536 47.272 17.688 46.632 17.992C45.992 18.296 45.672 18.848 45.672 19.648C45.672 20.112 45.784 20.488 46.008 20.776C46.232 21.064 46.616 21.312 47.16 21.52C47.72 21.728 48.488 21.96 49.464 22.216C50.728 22.536 51.704 22.92 52.392 23.368C53.096 23.8 53.584 24.312 53.856 24.904C54.144 25.48 54.288 26.136 54.288 26.872C54.288 28.232 53.784 29.304 52.776 30.088C51.768 30.856 50.24 31.24 48.192 31.24ZM56.8245 31V15.544H59.4405V22.264H66.8805V15.544H69.4965V31H66.8805V24.28H59.4405V31H56.8245ZM72.5276 31V15.544H75.1436V31H72.5276ZM78.1761 31V15.544H88.6881V17.584H80.7921V22.264H87.8001V24.28H80.7921V31H78.1761ZM94.77 31V17.584H89.826V15.544H102.306V17.584H97.386V31H94.77Z" fill="black"/>
            </svg>
        </span>
                                            <p>{t('doctorScheduleAdmin.rulesHelpShift')}</p>
                                        </div>

                                        <div className="doctor-schedule-admin-page__help-row">
        <span className="doctor-schedule-admin-page__help-key doctor-schedule-admin-page__help-key--ctrl">
            <svg width="95" height="54" viewBox="0 0 95 54" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="95" height="54" rx="11" fill="#90A4AE"/>
                <rect width="95" height="45" rx="10" fill="#CFD8DC"/>
                <path d="M27.76 31.24C25.216 31.24 23.288 30.544 21.976 29.152C20.68 27.76 20.032 25.88 20.032 23.512C20.032 21.816 20.304 20.36 20.848 19.144C21.408 17.912 22.256 16.968 23.392 16.312C24.528 15.64 25.976 15.304 27.736 15.304C28.632 15.304 29.448 15.376 30.184 15.52C30.936 15.648 31.632 15.824 32.272 16.048V18.328C31.632 18.072 30.944 17.88 30.208 17.752C29.488 17.608 28.728 17.536 27.928 17.536C26.008 17.536 24.648 18.048 23.848 19.072C23.064 20.096 22.672 21.576 22.672 23.512C22.672 25.32 23.104 26.696 23.968 27.64C24.832 28.568 26.168 29.032 27.976 29.032C28.712 29.032 29.448 28.976 30.184 28.864C30.936 28.736 31.64 28.544 32.296 28.288V30.592C31.656 30.8 30.96 30.96 30.208 31.072C29.472 31.184 28.656 31.24 27.76 31.24ZM38.8403 31V17.584H33.8963V15.544H46.3763V17.584H41.4563V31H38.8403ZM48.4729 31V15.544H55.5769C57.3049 15.544 58.5609 15.992 59.3449 16.888C60.1449 17.768 60.5449 18.968 60.5449 20.488C60.5449 21.576 60.2729 22.504 59.7289 23.272C59.1849 24.04 58.4009 24.576 57.3769 24.88C57.6649 25.088 57.8889 25.312 58.0489 25.552C58.2089 25.792 58.3689 26.112 58.5289 26.512L60.4729 31H57.7849L55.8889 26.68C55.7129 26.264 55.4969 25.968 55.2409 25.792C55.0009 25.616 54.5849 25.528 53.9929 25.528H51.0889V31H48.4729ZM51.0889 23.416H54.8809C55.8249 23.416 56.5689 23.184 57.1129 22.72C57.6569 22.256 57.9289 21.512 57.9289 20.488C57.9289 18.552 56.9929 17.584 55.1209 17.584H51.0889V23.416ZM63.1214 31V15.544H65.7374V28.984H73.6574V31H63.1214Z" fill="black"/>
            </svg>
        </span>
                                            <p>{t('doctorScheduleAdmin.rulesHelpCtrl')}</p>
                                        </div>

                                        <p>{t('doctorScheduleAdmin.rulesHelpLongPress')}</p>
                                        <p>{t('doctorScheduleAdmin.rulesHelpDoubleClick')}</p>
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        <div className="doctor-schedule-admin-page__rules">
                            <label className="doctor-schedule-admin-page__field doctor-schedule-admin-page__field--full">
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

                            <label className="doctor-schedule-admin-page__checkbox-card doctor-schedule-admin-page__checkbox-card--full">
                                <span>{t('doctorScheduleAdmin.workDaysConfig')}</span>
                                <button
                                    type="button"
                                    className={`doctor-schedule-admin-page__checkbox-toggle ${
                                        workDaysConfigEnabled ? 'is-active' : ''
                                    }`}
                                    onClick={() => setWorkDaysConfigEnabled((prev) => !prev)}
                                >
                                    <span className="doctor-schedule-admin-page__checkbox-knob" />
                                </button>
                            </label>

                            {workDaysConfigEnabled ? (
                                <div className="doctor-schedule-admin-page__workdays-config-block doctor-schedule-admin-page__field--full">
                                    <div className="doctor-schedule-admin-page__workdays-inline">
                                        <label className="doctor-schedule-admin-page__field">
                                            <span>{t('doctorScheduleAdmin.workDaysMode')}</span>
                                            <select
                                                value={workDaysMode}
                                                onChange={(e) => setWorkDaysMode(e.target.value as 'cycle' | 'manual')}
                                            >
                                                <option value="manual">
                                                    {t('doctorScheduleAdmin.manualWeekTemplate')}
                                                </option>
                                                <option value="cycle">
                                                    {t('doctorScheduleAdmin.cycleTemplate')}
                                                </option>
                                            </select>
                                        </label>

                                        {workDaysMode === 'cycle' ? (
                                            <>
                                                <label className="doctor-schedule-admin-page__field doctor-schedule-admin-page__field--days-small">
                                                    <span>{t('doctorScheduleAdmin.workDays')}</span>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        value={cycleWorkDays}
                                                        onChange={(e) =>
                                                            setCycleWorkDays(Math.max(1, Number(e.target.value) || 1))
                                                        }
                                                    />
                                                </label>

                                                <label className="doctor-schedule-admin-page__field doctor-schedule-admin-page__field--days-small">
                                                    <span>{t('doctorScheduleAdmin.offDays')}</span>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        value={cycleOffDays}
                                                        onChange={(e) =>
                                                            setCycleOffDays(Math.max(1, Number(e.target.value) || 1))
                                                        }
                                                    />
                                                </label>
                                            </>
                                        ) : null}
                                    </div>
                                </div>
                            ) : null}

                            <div className="doctor-schedule-admin-page__rule-edit-row doctor-schedule-admin-page__field--full">
                                <label className="doctor-schedule-admin-page__checkbox-card doctor-schedule-admin-page__checkbox-card--compact">
            <span>
                {ruleEnabled
                    ? t('doctorScheduleAdmin.workingDay')
                    : t('doctorScheduleAdmin.dayOff')}
            </span>
                                    <button
                                        type="button"
                                        className={`doctor-schedule-admin-page__checkbox-toggle ${
                                            ruleEnabled ? 'is-active' : ''
                                        }`}
                                        onClick={() => setRuleEnabled((prev) => !prev)}
                                    >
                                        <span className="doctor-schedule-admin-page__checkbox-knob" />
                                    </button>
                                </label>

                                {ruleEnabled ? (
                                    <div className="doctor-schedule-admin-page__time-groups">
                                        <div className="doctor-schedule-admin-page__mini-range">
                                            <span>{t('doctorScheduleAdmin.workingHoursLabel')}</span>
                                            <div className="doctor-schedule-admin-page__mini-range-inputs">
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    maxLength={5}
                                                    value={ruleStart}
                                                    onChange={(e) => setRuleStart(normalizeTimeInput(e.target.value))}
                                                />
                                                <span>—</span>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    maxLength={5}
                                                    value={ruleEnd}
                                                    onChange={(e) => setRuleEnd(normalizeTimeInput(e.target.value))}
                                                />
                                            </div>
                                        </div>

                                        <div className="doctor-schedule-admin-page__mini-range">
                                            <span>{t('doctorScheduleAdmin.breakHoursLabel')}</span>
                                            <div className="doctor-schedule-admin-page__mini-range-inputs">
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    maxLength={5}
                                                    value={breakStart}
                                                    onChange={(e) => setBreakStart(normalizeTimeInput(e.target.value))}
                                                />
                                                <span>—</span>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    maxLength={5}
                                                    value={breakEnd}
                                                    onChange={(e) => setBreakEnd(normalizeTimeInput(e.target.value))}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ) : null}
                            </div>

                            <div className="doctor-schedule-admin-page__actions doctor-schedule-admin-page__actions--center doctor-schedule-admin-page__field--full">
                                <button
                                    type="button"
                                    className="doctor-schedule-admin-page__primary doctor-schedule-admin-page__primary--centered"
                                    disabled={savingRules || (!selectedDate && !selectedDates.length && !scheduleStartDate)}
                                    onClick={() => void handleApplyLocalRules()}
                                >
                                    {savingRules ? (
                                        <span className="doctor-schedule-admin-page__button-loading">
                    <span className="doctor-schedule-admin-page__button-spinner" />
                                            {t('doctorScheduleAdmin.saving')}
                </span>
                                    ) : (
                                        t('doctorScheduleAdmin.applyLocalRules')
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}