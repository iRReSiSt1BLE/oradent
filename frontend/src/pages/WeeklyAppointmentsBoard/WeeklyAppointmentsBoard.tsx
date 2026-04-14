import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    changeAppointmentCabinet,
    getAdminWeekAppointments,
    getDoctorWeekAppointments,
    markAppointmentPaid,
    updateAppointmentVisitFlowStatus,
    type WeeklyAppointmentItem,
} from '../../shared/api/appointmentApi';
import { getToken } from '../../shared/utils/authStorage';
import { useI18n } from '../../shared/i18n/I18nProvider';
import './WeeklyAppointmentsBoard.scss';

type Scope = 'admin' | 'doctor';
type AlertState = { variant: 'success' | 'error' | 'info'; message: string } | null;

type Props = {
    scope: Scope;
};

type ProcessingAction = 'waiting' | 'no_show' | 'paid' | 'cabinet' | 'start';

type ProcessingState = {
    id: string;
    action: ProcessingAction;
} | null;

function startOfToday() {
    const next = new Date();
    next.setHours(0, 0, 0, 0);
    return next;
}

function addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function toDateKey(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatDateTime(value: string | null, language: string) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    const locale = language === 'ua' ? 'uk-UA' : language === 'de' ? 'de-DE' : language === 'fr' ? 'fr-FR' : 'en-US';
    return new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function formatTimeRange(value: string | null, durationMinutes: number | null, language: string) {
    if (!value) return '—';
    const start = new Date(value);
    if (Number.isNaN(start.getTime())) return value;
    const end = new Date(start.getTime() + Number(durationMinutes || 0) * 60 * 1000);
    const locale = language === 'ua' ? 'uk-UA' : language === 'de' ? 'de-DE' : language === 'fr' ? 'fr-FR' : 'en-US';
    const fmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
    return `${fmt.format(start)} — ${fmt.format(end)}`;
}

function weekdayLabel(date: Date, language: string) {
    const locale = language === 'ua' ? 'uk-UA' : language === 'de' ? 'de-DE' : language === 'fr' ? 'fr-FR' : 'en-US';
    return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
}

function dateLabel(date: Date) {
    return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function visitStatusMeta(status: string, t: (key: string) => string) {
    switch (String(status || '').toUpperCase()) {
        case 'WAITING_CALL':
            return { label: t('weeklyAppointments.visitWaiting'), className: 'is-purple' };
        case 'IN_PROGRESS':
            return { label: t('weeklyAppointments.visitInProgress'), className: 'is-teal' };
        case 'COMPLETED':
            return { label: t('weeklyAppointments.visitCompleted'), className: 'is-green' };
        case 'NO_SHOW':
            return { label: t('weeklyAppointments.visitNoShow'), className: 'is-red' };
        default:
            return { label: t('weeklyAppointments.visitScheduled'), className: 'is-neutral' };
    }
}

function paymentStatusMeta(status: string | null | undefined, t: (key: string) => string) {
    return String(status || '').toUpperCase() === 'PAID'
        ? { label: t('weeklyAppointments.paymentPaid'), className: 'is-green' }
        : { label: t('weeklyAppointments.paymentPending'), className: 'is-red' };
}

function isProcessing(processing: ProcessingState, id: string, action: ProcessingAction) {
    return processing?.id === id && processing?.action === action;
}

export default function WeeklyAppointmentsBoard({ scope }: Props) {
    const token = getToken();
    const navigate = useNavigate();
    const { t, language } = useI18n();

    const [selectedDate, setSelectedDate] = useState(() => toDateKey(startOfToday()));
    const [appointments, setAppointments] = useState<WeeklyAppointmentItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [alert, setAlert] = useState<AlertState>(null);
    const [processing, setProcessing] = useState<ProcessingState>(null);
    const [draftCabinets, setDraftCabinets] = useState<Record<string, string>>({});

    const weekDays = useMemo(() => {
        const base = startOfToday();
        return Array.from({ length: 7 }, (_, index) => addDays(base, index));
    }, []);

    const loadAppointments = useCallback(async () => {
        const authToken = token;
        if (!authToken) return;

        try {
            setLoading(true);
            const anchor = toDateKey(weekDays[0] || startOfToday());
            const response = scope === 'admin'
                ? await getAdminWeekAppointments(authToken, anchor)
                : await getDoctorWeekAppointments(authToken, anchor);

            const nextAppointments = Array.isArray(response.appointments) ? response.appointments : [];
            setAppointments(nextAppointments);
            setDraftCabinets(Object.fromEntries(nextAppointments.map((item) => [item.id, item.cabinetId || ''])));
        } catch (err: any) {
            setAlert({ variant: 'error', message: err?.message || t('weeklyAppointments.loadError') });
        } finally {
            setLoading(false);
        }
    }, [scope, t, token, weekDays]);

    useEffect(() => {
        void loadAppointments();
    }, [loadAppointments]);

    const filteredAppointments = useMemo(() => {
        return appointments.filter((item) => {
            if (!item.appointmentDate) return false;
            return toDateKey(new Date(item.appointmentDate)) === selectedDate;
        });
    }, [appointments, selectedDate]);

    async function runAction(itemId: string, action: ProcessingAction, handler: () => Promise<unknown>, successMessage: string) {
        try {
            setProcessing({ id: itemId, action });
            await handler();
            await loadAppointments();
            setAlert({ variant: 'success', message: successMessage });
        } catch (err: any) {
            setAlert({ variant: 'error', message: err?.message || t('weeklyAppointments.actionError') });
        } finally {
            setProcessing(null);
        }
    }

    return (
        <section className="weekly-appointments-board">
            {alert ? <AlertToast variant={alert.variant} message={alert.message} onClose={() => setAlert(null)} /> : null}

            <div className="weekly-appointments-board__container container">
                <div className="weekly-appointments-board__header">
                    <div>
                        <h1 className="weekly-appointments-board__title">
                            {scope === 'admin' ? t('weeklyAppointments.adminTitle') : t('weeklyAppointments.doctorTitle')}
                        </h1>
                        <p className="weekly-appointments-board__subtitle">
                            {scope === 'admin' ? t('weeklyAppointments.adminSubtitle') : t('weeklyAppointments.doctorSubtitle')}
                        </p>
                    </div>

                    {scope === 'doctor' ? (
                        <button
                            type="button"
                            className="weekly-appointments-board__ghost-btn"
                            onClick={() => navigate('/doctor/appointments')}
                        >
                            Минулі записи
                        </button>
                    ) : null}
                </div>

                <div className="weekly-appointments-board__days">
                    {weekDays.map((day) => {
                        const key = toDateKey(day);
                        const count = appointments.filter((item) => item.appointmentDate && toDateKey(new Date(item.appointmentDate)) === key).length;
                        return (
                            <button
                                key={key}
                                type="button"
                                className={[
                                    'weekly-appointments-board__day',
                                    selectedDate === key ? 'is-active' : '',
                                    count > 0 ? 'has-items' : 'is-empty',
                                ].filter(Boolean).join(' ')}
                                onClick={() => setSelectedDate(key)}
                            >
                                <span>{weekdayLabel(day, language)}</span>
                                <strong>{dateLabel(day)}</strong>
                                <small>{count}</small>
                            </button>
                        );
                    })}
                </div>

                <div className="weekly-appointments-board__list">
                    {loading ? (
                        Array.from({ length: 4 }).map((_, index) => (
                            <div key={`skeleton-${index}`} className="weekly-appointments-board__skeleton-card">
                                <div className="weekly-appointments-board__skeleton-top">
                                    <div className="weekly-appointments-board__skeleton-line is-title" />
                                    <div className="weekly-appointments-board__skeleton-pill" />
                                </div>
                                <div className="weekly-appointments-board__skeleton-line is-meta" />
                                <div className="weekly-appointments-board__skeleton-grid">
                                    <div className="weekly-appointments-board__skeleton-line" />
                                    <div className="weekly-appointments-board__skeleton-line" />
                                    <div className="weekly-appointments-board__skeleton-line" />
                                    <div className="weekly-appointments-board__skeleton-line" />
                                </div>
                            </div>
                        ))
                    ) : filteredAppointments.length === 0 ? (
                        <div className="weekly-appointments-board__empty">{t('weeklyAppointments.empty')}</div>
                    ) : (
                        filteredAppointments.map((item) => {
                            const payment = paymentStatusMeta(item.paymentStatus, t);
                            const visit = visitStatusMeta(item.visitFlowStatus, t);
                            const selectedCabinet = draftCabinets[item.id] ?? item.cabinetId ?? '';
                            const isCompletedVisit = String(item.visitFlowStatus || '').toUpperCase() === 'COMPLETED' || String(item.status || '').toUpperCase() === 'COMPLETED';

                            return (
                                <article key={item.id} className={`weekly-appointments-board__item ${scope === 'admin' && isCompletedVisit ? 'is-completed-admin' : ''}`}>
                                    <div className="weekly-appointments-board__item-top">
                                        <div>
                                            <h3>{item.patient?.fullName || t('weeklyAppointments.noPatient')}</h3>
                                            <p>{formatDateTime(item.appointmentDate, language)}</p>
                                        </div>
                                        <div className="weekly-appointments-board__pills">
                                            <span className={`weekly-appointments-board__pill ${payment.className}`}>{payment.label}</span>
                                            <span className={`weekly-appointments-board__pill ${visit.className}`}>{visit.label}</span>
                                        </div>
                                    </div>

                                    <div className="weekly-appointments-board__grid">
                                        <div>
                                            <span>{t('weeklyAppointments.phone')}</span>
                                            <strong>{item.patient?.phone || '—'}</strong>
                                        </div>
                                        <div>
                                            <span>{t('weeklyAppointments.email')}</span>
                                            <strong>{item.patient?.email || '—'}</strong>
                                        </div>
                                        {scope === 'admin' ? (
                                            <div>
                                                <span>{t('weeklyAppointments.doctor')}</span>
                                                <strong>{item.doctorName || '—'}</strong>
                                            </div>
                                        ) : null}
                                        <div>
                                            <span>{t('weeklyAppointments.cabinet')}</span>
                                            <strong>{item.cabinetName || '—'}</strong>
                                        </div>
                                        <div>
                                            <span>{t('weeklyAppointments.service')}</span>
                                            <strong>{item.serviceName || '—'}</strong>
                                        </div>
                                        <div>
                                            <span>{t('weeklyAppointments.time')}</span>
                                            <strong>{formatTimeRange(item.appointmentDate, item.durationMinutes, language)}</strong>
                                        </div>
                                    </div>

                                    <div className="weekly-appointments-board__actions">
                                        {scope === 'admin' ? (
                                            isCompletedVisit ? null : (
                                            <>
                                                {String(item.paymentStatus || '').toUpperCase() !== 'PAID' ? (
                                                    <button
                                                        type="button"
                                                        className="weekly-appointments-board__secondary-btn"
                                                        disabled={Boolean(processing)}
                                                        onClick={() => void runAction(item.id, 'paid', () => markAppointmentPaid(token!, item.id), t('weeklyAppointments.paymentSaved'))}
                                                    >
                                                        {isProcessing(processing, item.id, 'paid') ? <span className="weekly-appointments-board__spinner" /> : null}
                                                        {t('weeklyAppointments.markPaid')}
                                                    </button>
                                                ) : null}

                                                {String(item.visitFlowStatus || '').toUpperCase() !== 'WAITING_CALL' ? (
                                                    <button
                                                        type="button"
                                                        className="weekly-appointments-board__secondary-btn"
                                                        disabled={Boolean(processing)}
                                                        onClick={() => void runAction(item.id, 'waiting', () => updateAppointmentVisitFlowStatus(token!, item.id, 'WAITING_CALL'), t('weeklyAppointments.waitingSaved'))}
                                                    >
                                                        {isProcessing(processing, item.id, 'waiting') ? <span className="weekly-appointments-board__spinner" /> : null}
                                                        {t('weeklyAppointments.markWaiting')}
                                                    </button>
                                                ) : null}

                                                {String(item.visitFlowStatus || '').toUpperCase() !== 'NO_SHOW' ? (
                                                    <button
                                                        type="button"
                                                        className="weekly-appointments-board__danger-btn"
                                                        disabled={Boolean(processing)}
                                                        onClick={() => void runAction(item.id, 'no_show', () => updateAppointmentVisitFlowStatus(token!, item.id, 'NO_SHOW'), t('weeklyAppointments.noShowSaved'))}
                                                    >
                                                        {isProcessing(processing, item.id, 'no_show') ? <span className="weekly-appointments-board__spinner" /> : null}
                                                        {t('weeklyAppointments.markNoShow')}
                                                    </button>
                                                ) : null}

                                                {item.availableCabinets.length > 0 ? (
                                                    <div className="weekly-appointments-board__cabinet-edit">
                                                        <select
                                                            value={selectedCabinet}
                                                            onChange={(event) => setDraftCabinets((prev) => ({ ...prev, [item.id]: event.target.value }))}
                                                            disabled={Boolean(processing)}
                                                        >
                                                            <option value="">{t('weeklyAppointments.selectCabinet')}</option>
                                                            {item.availableCabinets.map((cabinet) => (
                                                                <option key={cabinet.id} value={cabinet.id}>{cabinet.name}</option>
                                                            ))}
                                                        </select>
                                                        <button
                                                            type="button"
                                                            className="weekly-appointments-board__primary-btn"
                                                            disabled={Boolean(processing) || !selectedCabinet || selectedCabinet === item.cabinetId}
                                                            onClick={() => void runAction(item.id, 'cabinet', () => changeAppointmentCabinet(token!, item.id, selectedCabinet), t('weeklyAppointments.cabinetSaved'))}
                                                        >
                                                            {isProcessing(processing, item.id, 'cabinet') ? <span className="weekly-appointments-board__spinner" /> : null}
                                                            {t('weeklyAppointments.changeCabinet')}
                                                        </button>
                                                    </div>
                                                ) : null}
                                            </>
                                            )
                                        ) : (
                                            <button
                                                type="button"
                                                className="weekly-appointments-board__primary-btn"
                                                disabled={Boolean(processing) || item.recordingCompleted === true || String(item.visitFlowStatus || '').toUpperCase() === 'COMPLETED'}
                                                onClick={() => {
                                                    if (String(item.visitFlowStatus || '').toUpperCase() === 'IN_PROGRESS') {
                                                        navigate(`/doctor/appointments/${item.id}`);
                                                        return;
                                                    }
                                                    void runAction(item.id, 'start', async () => {
                                                        await updateAppointmentVisitFlowStatus(token!, item.id, 'IN_PROGRESS');
                                                        navigate(`/doctor/appointments/${item.id}`);
                                                    }, t('weeklyAppointments.recordingStarted'));
                                                }}
                                            >
                                                {isProcessing(processing, item.id, 'start') ? <span className="weekly-appointments-board__spinner" /> : null}
                                                {String(item.visitFlowStatus || '').toUpperCase() === 'IN_PROGRESS'
                                                    ? t('weeklyAppointments.recordingInProgress')
                                                    : t('weeklyAppointments.startRecording')}
                                            </button>
                                        )}
                                    </div>
                                </article>
                            );
                        })
                    )}
                </div>
            </div>
        </section>
    );
}
