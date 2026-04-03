import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import { getAllDoctors } from '../../shared/api/doctorApi';
import {
    blockDoctorSlot,
    getDoctorRawSchedule,
    getDoctorScheduleDay,
    getDoctorScheduleMonth,
    unblockDoctorSlot,
    updateDoctorScheduleSettings,
} from '../../shared/api/doctorScheduleApi';
import { getToken } from '../../shared/utils/authStorage';
import './DoctorScheduleAdminPage.scss';

type DoctorOption = {
    id: string;
    userId: string;
    fullName: string;
};

type WeekdayRule = {
    weekday: number;
    enabled: boolean;
    start: string;
    end: string;
    breaks: Array<{ start: string; end: string }>;
};

type CycleRule = {
    workDays: number;
    offDays: number;
    anchorDate: string;
    start: string;
    end: string;
    breaks: Array<{ start: string; end: string }>;
};

type RawSchedule = {
    templateType?: 'WEEKLY' | 'CYCLE';
    slotMinutes?: number;
    weeklyTemplate?: WeekdayRule[];
    cycleTemplate?: CycleRule;
};

type DayCell = {
    date: string;
    isWorking: boolean;
    freeSlots: number;
    totalSlots: number;
};

type AlertState = {
    variant: 'success' | 'error' | 'info';
    message: string;
} | null;

const WEEKDAYS = [
    { key: 1, label: 'Пн' },
    { key: 2, label: 'Вт' },
    { key: 3, label: 'Ср' },
    { key: 4, label: 'Чт' },
    { key: 5, label: 'Пт' },
    { key: 6, label: 'Сб' },
    { key: 0, label: 'Нд' },
];

function toIsoDate(d: Date): string {
    const year = d.getFullYear();
    const month = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getMonthKey(dateIso: string): string {
    return dateIso.slice(0, 7);
}

function addDays(input: string, delta: number): string {
    const d = new Date(`${input}T00:00:00`);
    d.setDate(d.getDate() + delta);
    return toIsoDate(d);
}

function rangeDates(from: string, to: string): string[] {
    const out: string[] = [];
    let cur = from;
    while (cur <= to) {
        out.push(cur);
        cur = addDays(cur, 1);
    }
    return out;
}

function normalizeTime24(value: string): string {
    const v = (value || '').trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(v);
    if (!m) return '';
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return '';
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return '';
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function buildWeeklyDefault(): WeekdayRule[] {
    return WEEKDAYS.map((d) => ({
        weekday: d.key,
        enabled: d.key >= 1 && d.key <= 5,
        start: '09:00',
        end: '18:00',
        breaks: [],
    }));
}

export default function DoctorScheduleAdminPage() {
    const token = getToken();
    const location = useLocation();
    const urlDoctorId = new URLSearchParams(location.search).get('doctorId') || '';

    const [alert, setAlert] = useState<AlertState>(null);

    const [doctors, setDoctors] = useState<DoctorOption[]>([]);
    const [selectedDoctorId, setSelectedDoctorId] = useState('');
    const [applyToAllDoctors, setApplyToAllDoctors] = useState(false);

    const [templateType, setTemplateType] = useState<'WEEKLY' | 'CYCLE'>('WEEKLY');
    const [slotMinutes, setSlotMinutes] = useState(20);

    const [weeklyTemplate, setWeeklyTemplate] = useState<WeekdayRule[]>(buildWeeklyDefault());
    const [cycleTemplate, setCycleTemplate] = useState<CycleRule>({
        workDays: 5,
        offDays: 2,
        anchorDate: toIsoDate(new Date()),
        start: '09:00',
        end: '18:00',
        breaks: [],
    });

    const today = toIsoDate(new Date());
    const [monthKey, setMonthKey] = useState(getMonthKey(today));
    const [selectedDate, setSelectedDate] = useState(today);

    const [monthDays, setMonthDays] = useState<DayCell[]>([]);
    const [selectedDaySlots, setSelectedDaySlots] = useState<Array<{ time: string; state: 'FREE' | 'BOOKED' | 'BLOCKED' }>>([]);

    const [ruleFromDate, setRuleFromDate] = useState(today);
    const [ruleToDate, setRuleToDate] = useState(today);
    const [ruleDayEnabled, setRuleDayEnabled] = useState(true);
    const [ruleDayStart, setRuleDayStart] = useState('09:00');
    const [ruleDayEnd, setRuleDayEnd] = useState('18:00');
    const [ruleBlockFrom, setRuleBlockFrom] = useState('');
    const [ruleBlockTo, setRuleBlockTo] = useState('');
    const [fixToRange, setFixToRange] = useState(false);

    const [loadingDoctors, setLoadingDoctors] = useState(false);
    const [loadingSchedule, setLoadingSchedule] = useState(false);
    const [savingTemplate, setSavingTemplate] = useState(false);
    const [applyingRules, setApplyingRules] = useState(false);

    const selectedDoctorName = useMemo(
        () => doctors.find((d) => d.id === selectedDoctorId)?.fullName ?? 'Лікар не обраний',
        [doctors, selectedDoctorId],
    );

    const effectiveDates = useMemo(() => {
        if (!ruleFromDate) return [];
        if (!fixToRange) return [ruleFromDate];
        if (!ruleToDate || ruleToDate < ruleFromDate) return [ruleFromDate];
        return rangeDates(ruleFromDate, ruleToDate);
    }, [ruleFromDate, ruleToDate, fixToRange]);

    function showError(message: string) {
        setAlert({ variant: 'error', message });
    }

    function showSuccess(message: string) {
        setAlert({ variant: 'success', message });
    }

    function normalizeRawSchedule(rawAny: any): RawSchedule {
        const raw = rawAny?.schedule ?? rawAny ?? {};
        return {
            templateType: raw.templateType === 'CYCLE' ? 'CYCLE' : 'WEEKLY',
            slotMinutes: Number(raw.slotMinutes) > 0 ? Number(raw.slotMinutes) : 20,
            weeklyTemplate: Array.isArray(raw.weeklyTemplate) ? raw.weeklyTemplate : undefined,
            cycleTemplate: raw.cycleTemplate,
        };
    }

    async function loadDoctors() {
        if (!token) return;
        try {
            setLoadingDoctors(true);
            const resp = await getAllDoctors(token);
            const list = Array.isArray((resp as any)?.doctors) ? (resp as any).doctors : [];
            const mapped: DoctorOption[] = list.map((d: any) => ({
                id: d.id,
                userId: d.userId,
                fullName: `${d.lastName ?? ''} ${d.firstName ?? ''} ${d.middleName ?? ''}`.replace(/\s+/g, ' ').trim() || d.email || d.id,
            }));
            setDoctors(mapped);

            setSelectedDoctorId((prev) => {
                if (prev && mapped.some((d) => d.id === prev)) return prev;
                const match = urlDoctorId ? mapped.find((d) => d.id === urlDoctorId || d.userId === urlDoctorId) : null;
                if (match) return match.id;
                return mapped[0]?.id || '';
            });
        } catch {
            showError('Не вдалося завантажити лікарів');
        } finally {
            setLoadingDoctors(false);
        }
    }

    async function loadRawSchedule() {
        if (!token || !selectedDoctorId) return;
        try {
            setLoadingSchedule(true);

            const rawResp = await (getDoctorRawSchedule as any)(token, selectedDoctorId);
            const raw = normalizeRawSchedule(rawResp);

            setTemplateType(raw.templateType || 'WEEKLY');
            setSlotMinutes(raw.slotMinutes || 20);

            if (Array.isArray(raw.weeklyTemplate) && raw.weeklyTemplate.length) {
                setWeeklyTemplate(
                    raw.weeklyTemplate.map((r: any) => ({
                        weekday: Number(r.weekday),
                        enabled: !!r.enabled,
                        start: normalizeTime24(r.start) || '09:00',
                        end: normalizeTime24(r.end) || '18:00',
                        breaks: [],
                    })),
                );
            } else {
                setWeeklyTemplate(buildWeeklyDefault());
            }

            if (raw.cycleTemplate) {
                setCycleTemplate({
                    workDays: Math.max(1, Number(raw.cycleTemplate.workDays) || 5),
                    offDays: Math.max(1, Number(raw.cycleTemplate.offDays) || 2),
                    anchorDate: raw.cycleTemplate.anchorDate || today,
                    start: normalizeTime24(raw.cycleTemplate.start) || '09:00',
                    end: normalizeTime24(raw.cycleTemplate.end) || '18:00',
                    breaks: [],
                });
            }
        } catch {
            showError('Не вдалося завантажити налаштування графіка');
        } finally {
            setLoadingSchedule(false);
        }
    }

    async function loadMonthAndDay() {
        if (!selectedDoctorId) return;
        try {
            const monthResp = await (getDoctorScheduleMonth as any)(selectedDoctorId, monthKey);
            const monthDaysData = Array.isArray(monthResp?.days) ? monthResp.days : [];
            const mapped: DayCell[] = monthDaysData.map((d: any) => ({
                date: d.date,
                isWorking: !!d.isWorking,
                freeSlots: Number(d.freeSlots) || 0,
                totalSlots: Number(d.totalSlots) || 0,
            }));
            setMonthDays(mapped);

            const dayResp = await (getDoctorScheduleDay as any)(selectedDoctorId, selectedDate);
            setSelectedDaySlots(Array.isArray(dayResp?.slots) ? dayResp.slots : []);
        } catch {
            showError('Не вдалося завантажити календар');
        }
    }

    useEffect(() => {
        void loadDoctors();
    }, []);

    useEffect(() => {
        void loadRawSchedule();
    }, [selectedDoctorId]);

    useEffect(() => {
        void loadMonthAndDay();
    }, [selectedDoctorId, monthKey, selectedDate]);

    function updateWeekRule(index: number, patch: Partial<WeekdayRule>) {
        setWeeklyTemplate((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    }

    async function saveTemplateForDoctor(doctorId: string) {
        if (!token) return;

        const weeklyPayload = weeklyTemplate.map((w) => ({
            weekday: w.weekday,
            enabled: w.enabled,
            start: normalizeTime24(w.start) || '09:00',
            end: normalizeTime24(w.end) || '18:00',
            breaks: [],
        }));

        const cyclePayload = {
            workDays: cycleTemplate.workDays,
            offDays: cycleTemplate.offDays,
            anchorDate: cycleTemplate.anchorDate,
            start: normalizeTime24(cycleTemplate.start) || '09:00',
            end: normalizeTime24(cycleTemplate.end) || '18:00',
            breaks: [],
        };

        await (updateDoctorScheduleSettings as any)(token, doctorId, {
            templateType,
            slotMinutes,
            weeklyTemplate: weeklyPayload,
            cycleTemplate: cyclePayload,
        });
    }

    async function handleSaveTemplate() {
        if (!token || !selectedDoctorId) return;
        try {
            setSavingTemplate(true);
            if (applyToAllDoctors) {
                for (const d of doctors) {
                    await saveTemplateForDoctor(d.id);
                }
            } else {
                await saveTemplateForDoctor(selectedDoctorId);
            }
            showSuccess('Графік збережено');
            await loadMonthAndDay();
        } catch {
            showError('Помилка збереження графіка');
        } finally {
            setSavingTemplate(false);
        }
    }

    async function applyRuleForDoctor(doctorId: string) {
        if (!token) return;

        const dates = effectiveDates;
        const dayStart = normalizeTime24(ruleDayStart);
        const dayEnd = normalizeTime24(ruleDayEnd);
        const blockFrom = normalizeTime24(ruleBlockFrom);
        const blockTo = normalizeTime24(ruleBlockTo);

        if (!dates.length) return;

        if (ruleDayEnabled && (!dayStart || !dayEnd || dayStart >= dayEnd)) {
            throw new Error('invalid-day-time');
        }

        if ((blockFrom && !blockTo) || (!blockFrom && blockTo) || (blockFrom && blockTo && blockFrom >= blockTo)) {
            throw new Error('invalid-block-time');
        }

        const rawResp = await (getDoctorRawSchedule as any)(token, doctorId);
        const existingBlockedSlots = Array.isArray(rawResp?.schedule?.blockedSlots) ? rawResp.schedule.blockedSlots : [];

        const adminGeneratedSlots = existingBlockedSlots.filter(
            (slot: any) => dates.includes(slot.date) && slot.reason === 'admin-local-rule',
        );

        for (const slot of adminGeneratedSlots) {
            await (unblockDoctorSlot as any)(token, doctorId, {
                date: slot.date,
                start: slot.start,
                end: slot.end,
            });
        }

        const dayOverrides = dates.map((date) => ({
            date,
            enabled: ruleDayEnabled,
            start: ruleDayEnabled ? dayStart : '00:00',
            end: ruleDayEnabled ? dayEnd : '00:00',
            breaks: [],
        }));

        await (updateDoctorScheduleSettings as any)(token, doctorId, {
            templateType,
            slotMinutes,
            dayOverrides,
        });

        if (blockFrom && blockTo && ruleDayEnabled) {
            for (const date of dates) {
                await (blockDoctorSlot as any)(token, doctorId, {
                    date,
                    start: blockFrom,
                    end: blockTo,
                    reason: 'admin-local-rule',
                });
            }
        }
    }
    async function handleApplyRules() {
        if (!token || !selectedDoctorId) return;
        try {
            setApplyingRules(true);
            if (applyToAllDoctors) {
                for (const d of doctors) {
                    await applyRuleForDoctor(d.id);
                }
            } else {
                await applyRuleForDoctor(selectedDoctorId);
            }
            showSuccess('Локальні правила застосовано');
            await loadMonthAndDay();
        } catch (e: any) {
            if (e?.message === 'invalid-day-time') {
                showError('Вкажіть коректний початок/кінець дня');
            } else if (e?.message === 'invalid-block-time') {
                showError('Невірний інтервал блокування');
            } else {
                showError('Не вдалося застосувати локальні правила');
            }
        } finally {
            setApplyingRules(false);
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

            <div className="doctor-schedule-admin-page__card">
                <h1 className="doctor-schedule-admin-page__title">КЕРУВАННЯ ГРАФІКАМИ ЛІКАРІВ</h1>

                <div className="doctor-schedule-admin-page__topbar">
                    <label className="doctor-schedule-admin-page__field">
                        <span>Лікар</span>
                        <select
                            value={selectedDoctorId}
                            onChange={(e) => setSelectedDoctorId(e.target.value)}
                            disabled={loadingDoctors || !doctors.length}
                        >
                            {doctors.map((d) => (
                                <option key={d.id} value={d.id}>
                                    {d.fullName}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="doctor-schedule-admin-page__field">
                        <span>Крок слоту (хв)</span>
                        <input
                            type="number"
                            min={5}
                            step={5}
                            value={slotMinutes}
                            onChange={(e) => setSlotMinutes(Math.max(5, Number(e.target.value) || 20))}
                        />
                    </label>

                    <label className="doctor-schedule-admin-page__field doctor-schedule-admin-page__field--check">
                        <span>Застосувати до всіх</span>
                        <input
                            type="checkbox"
                            checked={applyToAllDoctors}
                            onChange={(e) => setApplyToAllDoctors(e.target.checked)}
                        />
                    </label>
                </div>

                <div className="doctor-schedule-admin-page__template-switch">
                    <button
                        type="button"
                        className={templateType === 'WEEKLY' ? 'is-active' : ''}
                        onClick={() => setTemplateType('WEEKLY')}
                    >
                        Тижневий шаблон
                    </button>
                    <button
                        type="button"
                        className={templateType === 'CYCLE' ? 'is-active' : ''}
                        onClick={() => setTemplateType('CYCLE')}
                    >
                        Циклічний шаблон
                    </button>
                </div>

                {templateType === 'WEEKLY' ? (
                    <div className="doctor-schedule-admin-page__week-grid">
                        {weeklyTemplate.map((r, idx) => {
                            const label = WEEKDAYS.find((w) => w.key === r.weekday)?.label ?? String(r.weekday);
                            return (
                                <div className="doctor-schedule-admin-page__week-row" key={`${r.weekday}-${idx}`}>
                                    <div className="doctor-schedule-admin-page__week-day">{label}</div>
                                    <label className="doctor-schedule-admin-page__week-enabled">
                                        <input
                                            type="checkbox"
                                            checked={r.enabled}
                                            onChange={(e) => updateWeekRule(idx, { enabled: e.target.checked })}
                                        />
                                        <span>{r.enabled ? 'Робочий' : 'Вихідний'}</span>
                                    </label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={r.start}
                                        disabled={!r.enabled}
                                        onChange={(e) => updateWeekRule(idx, { start: e.target.value })}
                                        placeholder="09:00"
                                    />
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={r.end}
                                        disabled={!r.enabled}
                                        onChange={(e) => updateWeekRule(idx, { end: e.target.value })}
                                        placeholder="18:00"
                                    />
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="doctor-schedule-admin-page__cycle-grid">
                        <label className="doctor-schedule-admin-page__field">
                            <span>Робочі дні</span>
                            <input
                                type="number"
                                min={1}
                                value={cycleTemplate.workDays}
                                onChange={(e) => setCycleTemplate((p) => ({ ...p, workDays: Math.max(1, Number(e.target.value) || 1) }))}
                            />
                        </label>
                        <label className="doctor-schedule-admin-page__field">
                            <span>Вихідні дні</span>
                            <input
                                type="number"
                                min={1}
                                value={cycleTemplate.offDays}
                                onChange={(e) => setCycleTemplate((p) => ({ ...p, offDays: Math.max(1, Number(e.target.value) || 1) }))}
                            />
                        </label>
                        <label className="doctor-schedule-admin-page__field">
                            <span>Опорна дата</span>
                            <input
                                type="date"
                                value={cycleTemplate.anchorDate}
                                onChange={(e) => setCycleTemplate((p) => ({ ...p, anchorDate: e.target.value }))}
                            />
                        </label>
                        <label className="doctor-schedule-admin-page__field">
                            <span>Початок</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={cycleTemplate.start}
                                onChange={(e) => setCycleTemplate((p) => ({ ...p, start: e.target.value }))}
                                placeholder="09:00"
                            />
                        </label>
                        <label className="doctor-schedule-admin-page__field">
                            <span>Кінець</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={cycleTemplate.end}
                                onChange={(e) => setCycleTemplate((p) => ({ ...p, end: e.target.value }))}
                                placeholder="18:00"
                            />
                        </label>
                    </div>
                )}

                <div className="doctor-schedule-admin-page__save-wrap">
                    <button type="button" onClick={handleSaveTemplate} disabled={savingTemplate || loadingSchedule}>
                        {savingTemplate ? 'Збереження...' : 'ЗБЕРЕГТИ ГРАФІК'}
                    </button>
                </div>

                <div className="doctor-schedule-admin-page__rules-card">
                    <h2>Локальні правила дня</h2>

                    <div className="doctor-schedule-admin-page__rules-grid">
                        <label className="doctor-schedule-admin-page__field">
                            <span>Від дати</span>
                            <input
                                type="date"
                                value={ruleFromDate}
                                onChange={(e) => {
                                    setRuleFromDate(e.target.value);
                                    if (ruleToDate < e.target.value) setRuleToDate(e.target.value);
                                }}
                            />
                        </label>

                        <label className="doctor-schedule-admin-page__field">
                            <span>До дати</span>
                            <input
                                type="date"
                                value={ruleToDate}
                                disabled={!fixToRange}
                                onChange={(e) => setRuleToDate(e.target.value)}
                            />
                        </label>

                        <label className="doctor-schedule-admin-page__field">
                            <span>Початок дня</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={ruleDayStart}
                                disabled={!ruleDayEnabled}
                                onChange={(e) => setRuleDayStart(e.target.value)}
                                placeholder="09:00"
                            />
                        </label>

                        <label className="doctor-schedule-admin-page__field">
                            <span>Кінець дня</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={ruleDayEnd}
                                disabled={!ruleDayEnabled}
                                onChange={(e) => setRuleDayEnd(e.target.value)}
                                placeholder="18:00"
                            />
                        </label>

                        <label className="doctor-schedule-admin-page__field">
                            <span>Блокувати від</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={ruleBlockFrom}
                                onChange={(e) => setRuleBlockFrom(e.target.value)}
                                placeholder="13:00"
                            />
                        </label>

                        <label className="doctor-schedule-admin-page__field">
                            <span>Блокувати до</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={ruleBlockTo}
                                onChange={(e) => setRuleBlockTo(e.target.value)}
                                placeholder="14:00"
                            />
                        </label>

                        <label className="doctor-schedule-admin-page__check-card">
                            <span>Стан дня</span>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={ruleDayEnabled}
                                    onChange={(e) => setRuleDayEnabled(e.target.checked)}
                                />
                                <span>{ruleDayEnabled ? 'Робочий' : 'Вихідний'}</span>
                            </label>
                        </label>

                        <label className="doctor-schedule-admin-page__check-card">
                            <span>Фіксація</span>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={fixToRange}
                                    onChange={(e) => setFixToRange(e.target.checked)}
                                />
                                <span>На всі дні діапазону</span>
                            </label>
                        </label>
                    </div>

                    <div className="doctor-schedule-admin-page__rules-action">
                        <button type="button" onClick={handleApplyRules} disabled={applyingRules}>
                            {applyingRules ? 'Застосування...' : applyToAllDoctors ? 'ЗАСТОСУВАТИ ДО ВСІХ ЛІКАРІВ' : 'ЗАСТОСУВАТИ ПРАВИЛА'}
                        </button>
                    </div>
                </div>

                <div className="doctor-schedule-admin-page__calendar-section">
                    <div className="doctor-schedule-admin-page__calendar-card">
                        <div className="doctor-schedule-admin-page__calendar-head">
                            <h3>Календар</h3>
                            <input type="month" value={monthKey} onChange={(e) => setMonthKey(e.target.value)} />
                        </div>

                        <div className="doctor-schedule-admin-page__calendar-grid">
                            {monthDays.map((d) => {
                                const hasFree = d.freeSlots > 0;
                                const isActive = d.date === selectedDate;

                                return (
                                    <button
                                        key={d.date}
                                        type="button"
                                        className={[
                                            'doctor-schedule-admin-page__day',
                                            isActive ? 'is-active' : '',
                                            !d.isWorking ? 'is-off' : hasFree ? 'is-free' : 'is-full',
                                        ].join(' ')}
                                        onClick={() => setSelectedDate(d.date)}
                                    >
                                        <span>{d.date.slice(-2)}</span>
                                        <small>{d.freeSlots}/{d.totalSlots}</small>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="doctor-schedule-admin-page__slots-card">
                        <h3>{selectedDoctorName} — {selectedDate}</h3>
                        <div className="doctor-schedule-admin-page__slots-grid">
                            {selectedDaySlots.length ? (
                                selectedDaySlots.map((slot) => (
                                    <div
                                        key={slot.time}
                                        className={`doctor-schedule-admin-page__slot doctor-schedule-admin-page__slot--${slot.state.toLowerCase()}`}
                                    >
                                        {slot.time}
                                    </div>
                                ))
                            ) : (
                                <p className="doctor-schedule-admin-page__empty">На цей день слотів немає</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
