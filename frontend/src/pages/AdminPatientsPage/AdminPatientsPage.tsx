import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider';
import { getToken } from '../../shared/utils/authStorage';
import { getAdminPatients, type AdminPatientListItem } from '../../shared/api/patientApi';
import {
    getAdminPatientAppointments,
    type AppointmentItem,
    adminCancelAppointment,
    adminRefundAppointment,
    adminRescheduleAppointment,
} from '../../shared/api/appointmentApi';
import {
    getDoctorScheduleDay,
    getDoctorScheduleMonth,
    type DayScheduleResponse,
    type MonthDayCell,
} from '../../shared/api/doctorScheduleApi';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import './AdminPatientsPage.scss';

type AlertState = {
    variant: 'success' | 'error' | 'info';
    message: string;
} | null;

function formatDateTime(value: string | null, fallback: string) {
    if (!value) return fallback;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');

    return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}

function formatDateOnly(value: string) {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;

    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();

    return `${dd}.${mm}.${yyyy}`;
}

function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function parseDbI18nValue(raw: unknown, language: string): string {
    if (!raw) return '';

    if (typeof raw === 'object' && raw !== null) {
        const record = raw as Record<string, any>;

        if ('ua' in record || 'en' in record || 'de' in record || 'fr' in record) {
            return record[language] || record.ua || record.en || record.de || record.fr || '';
        }

        if ('i18n' in record && record.i18n) {
            const map = record.i18n as Record<string, string>;
            return map[language] || map.ua || map.en || map.de || map.fr || '';
        }

        if ('value' in record && typeof record.value === 'string') {
            return record.value;
        }

        if ('name' in record) {
            return parseDbI18nValue(record.name, language);
        }
    }

    if (typeof raw === 'string') {
        if (!raw.includes('__ORADENT_I18N__')) {
            return raw;
        }

        try {
            const start = raw.indexOf('{');
            if (start === -1) return raw;

            const parsed = JSON.parse(raw.slice(start));
            const data = parsed?.data;

            if (data && typeof data === 'object') {
                return data[language] || data.ua || data.en || data.de || data.fr || raw;
            }

            return raw;
        } catch {
            return raw;
        }
    }

    return String(raw);
}

export default function AdminPatientsPage() {
    const token = getToken();
    const { t, language } = useI18n();

    const [search, setSearch] = useState('');
    const [loadingPatients, setLoadingPatients] = useState(true);
    const [loadingAppointments, setLoadingAppointments] = useState(false);
    const [patients, setPatients] = useState<AdminPatientListItem[]>([]);
    const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
    const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
    const [alert, setAlert] = useState<AlertState>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);

    const [rescheduleOpen, setRescheduleOpen] = useState(false);
    const [rescheduleAppointment, setRescheduleAppointment] = useState<AppointmentItem | null>(null);
    const [rescheduleMonth, setRescheduleMonth] = useState(currentMonthKey());
    const [rescheduleMonthData, setRescheduleMonthData] = useState<MonthDayCell[]>([]);
    const [rescheduleSelectedDate, setRescheduleSelectedDate] = useState<string | null>(null);
    const [rescheduleDayData, setRescheduleDayData] = useState<DayScheduleResponse | null>(null);
    const [rescheduleSelectedTime, setRescheduleSelectedTime] = useState('');
    const [loadingMonth, setLoadingMonth] = useState(false);
    const [loadingDay, setLoadingDay] = useState(false);

    const selectedPatient = useMemo(
        () => patients.find((item) => item.id === selectedPatientId) || null,
        [patients, selectedPatientId],
    );

    async function loadPatients(currentSearch = search) {
        if (!token) return;

        try {
            setLoadingPatients(true);

            const response = await getAdminPatients(token, currentSearch);
            const nextPatients = Array.isArray(response.patients) ? response.patients : [];

            setPatients(nextPatients);

            if (selectedPatientId) {
                const stillExists = nextPatients.some((item) => item.id === selectedPatientId);
                if (!stillExists) {
                    setSelectedPatientId(null);
                    setAppointments([]);
                }
            }
        } catch (err: any) {
            setAlert({
                variant: 'error',
                message: err?.message || t('adminPatients.loadPatientsError'),
            });
        } finally {
            setLoadingPatients(false);
        }
    }

    async function handleSelectPatient(patient: AdminPatientListItem) {
        if (!token) return;

        try {
            setLoadingAppointments(true);
            setSelectedPatientId(patient.id);

            const response = await getAdminPatientAppointments(token, patient.id);
            setAppointments(Array.isArray(response.appointments) ? response.appointments : []);
        } catch (err: any) {
            setAppointments([]);
            setAlert({
                variant: 'error',
                message: err?.message || t('adminPatients.loadAppointmentsError'),
            });
        } finally {
            setLoadingAppointments(false);
        }
    }

    async function reloadSelectedPatient() {
        if (!selectedPatient || !token) return;
        await handleSelectPatient(selectedPatient);
    }

    function openRescheduleModal(appointment: AppointmentItem) {
        setRescheduleAppointment(appointment);
        setRescheduleOpen(true);
        setRescheduleMonth(currentMonthKey());
        setRescheduleMonthData([]);
        setRescheduleSelectedDate(null);
        setRescheduleDayData(null);
        setRescheduleSelectedTime('');
    }

    function closeRescheduleModal() {
        setRescheduleOpen(false);
        setRescheduleAppointment(null);
        setRescheduleSelectedDate(null);
        setRescheduleSelectedTime('');
        setRescheduleDayData(null);
        setRescheduleMonthData([]);
    }

    useEffect(() => {
        void loadPatients('');
    }, []);

    useEffect(() => {
        async function loadMonth() {
            if (!token || !rescheduleOpen || !rescheduleAppointment?.doctorId) return;

            try {
                setLoadingMonth(true);
                const response = await getDoctorScheduleMonth(
                    rescheduleAppointment.doctorId,
                    rescheduleMonth,
                );
                setRescheduleMonthData(Array.isArray(response.days) ? response.days : []);
            } catch (err: any) {
                setAlert({
                    variant: 'error',
                    message: err?.message || t('adminPatients.loadScheduleMonthError'),
                });
            } finally {
                setLoadingMonth(false);
            }
        }

        void loadMonth();
    }, [token, rescheduleOpen, rescheduleAppointment?.doctorId, rescheduleMonth, t]);

    useEffect(() => {
        async function loadDay() {
            if (!token || !rescheduleOpen || !rescheduleAppointment?.doctorId || !rescheduleSelectedDate) {
                setRescheduleDayData(null);
                return;
            }

            try {
                setLoadingDay(true);
                const response = await getDoctorScheduleDay(
                    rescheduleAppointment.doctorId,
                    rescheduleSelectedDate,
                );
                setRescheduleDayData(response);
            } catch (err: any) {
                setAlert({
                    variant: 'error',
                    message: err?.message || t('adminPatients.loadScheduleDayError'),
                });
            } finally {
                setLoadingDay(false);
            }
        }

        void loadDay();
    }, [token, rescheduleOpen, rescheduleAppointment?.doctorId, rescheduleSelectedDate, t]);

    return (
        <section className="admin-patients-page">
            {alert && (
                <AlertToast
                    variant={alert.variant}
                    message={alert.message}
                    onClose={() => setAlert(null)}
                />
            )}

            <div className="admin-patients-page__container container">
                <div className="admin-patients-page__header">
                    <div>
                        <h1 className="admin-patients-page__title">{t('adminPatients.title')}</h1>
                        <p className="admin-patients-page__subtitle">{t('adminPatients.subtitle')}</p>
                    </div>
                </div>

                <div className="admin-patients-page__layout">
                    <div className="admin-patients-page__sidebar">
                        <div className="admin-patients-page__sidebar-top">
                            <input
                                className="admin-patients-page__search"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t('adminPatients.searchPlaceholder')}
                            />

                            <button
                                type="button"
                                className="admin-patients-page__secondary"
                                onClick={() => void loadPatients(search)}
                            >
                                {t('adminPatients.searchButton')}
                            </button>
                        </div>

                        {loadingPatients ? (
                            <div className="admin-patients-page__state">
                                {t('adminPatients.loadingPatients')}
                            </div>
                        ) : !patients.length ? (
                            <div className="admin-patients-page__state">
                                {t('adminPatients.emptyPatients')}
                            </div>
                        ) : (
                            <div className="admin-patients-page__patient-list">
                                {patients.map((patient) => {
                                    const fullName = `${patient.lastName || ''} ${patient.firstName || ''} ${patient.middleName || ''}`
                                        .replace(/\s+/g, ' ')
                                        .trim();

                                    return (
                                        <button
                                            key={patient.id}
                                            type="button"
                                            className={`admin-patients-page__patient-card ${
                                                selectedPatientId === patient.id ? 'is-active' : ''
                                            }`}
                                            onClick={() => void handleSelectPatient(patient)}
                                        >
                                            <strong>{fullName || t('adminPatients.noName')}</strong>

                                            <span>{patient.phone || t('adminPatients.noPhone')}</span>

                                            <div className="admin-patients-page__patient-card-meta">
                                                <span>
                                                    {patient.hasAccount
                                                        ? t('adminPatients.hasAccount')
                                                        : t('adminPatients.guestPatient')}
                                                </span>
                                                <span>
                                                    {t('adminPatients.appointmentsCount')}: {patient.appointmentsCount}
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="admin-patients-page__content">
                        {!selectedPatient ? (
                            <div className="admin-patients-page__state">
                                {t('adminPatients.selectPatient')}
                            </div>
                        ) : (
                            <>
                                <div className="admin-patients-page__patient-head">
                                    <div>
                                        <h2>
                                            {`${selectedPatient.lastName || ''} ${selectedPatient.firstName || ''} ${selectedPatient.middleName || ''}`
                                                .replace(/\s+/g, ' ')
                                                .trim() || t('adminPatients.noName')}
                                        </h2>

                                        <p>
                                            {selectedPatient.phone || t('adminPatients.noPhone')}
                                            {' · '}
                                            {selectedPatient.email || t('adminPatients.noEmail')}
                                        </p>
                                    </div>

                                    <div className="admin-patients-page__patient-head-meta">
                                        <span>
                                            {selectedPatient.phoneVerified
                                                ? t('adminPatients.phoneVerified')
                                                : t('adminPatients.phoneNotVerified')}
                                        </span>
                                        <span>
                                            {selectedPatient.hasAccount
                                                ? t('adminPatients.hasAccount')
                                                : t('adminPatients.guestPatient')}
                                        </span>
                                    </div>
                                </div>

                                {loadingAppointments ? (
                                    <div className="admin-patients-page__state">
                                        {t('adminPatients.loadingAppointments')}
                                    </div>
                                ) : !appointments.length ? (
                                    <div className="admin-patients-page__state">
                                        {t('adminPatients.emptyAppointments')}
                                    </div>
                                ) : (
                                    <div className="admin-patients-page__appointments">
                                        {appointments.map((appointment) => {
                                            const isPaidOnline =
                                                appointment.paymentStatus === 'PAID' &&
                                                appointment.paymentMethod === 'GOOGLE_PAY';

                                            const canCancel =
                                                appointment.status !== 'CANCELLED' &&
                                                (!isPaidOnline || appointment.refundStatus === 'REFUNDED');

                                            const refundLabel =
                                                appointment.refundStatus === 'REFUNDED'
                                                    ? t('adminPatients.refundStatusRefunded')
                                                    : appointment.refundStatus === 'PENDING'
                                                        ? t('adminPatients.refundStatusPending')
                                                        : appointment.refundStatus === 'FAILED'
                                                            ? t('adminPatients.refundStatusFailed')
                                                            : t('adminPatients.refundStatusNone');

                                            return (
                                                <article
                                                    key={appointment.id}
                                                    className="admin-patients-page__appointment-card"
                                                >
                                                    <div className="admin-patients-page__appointment-top">
                                                        <strong>
                                                            {parseDbI18nValue(
                                                                appointment.serviceName,
                                                                language,
                                                            ) || t('adminPatients.noService')}
                                                        </strong>

                                                        <span className="admin-patients-page__badge">
                                                            {appointment.status || 'BOOKED'}
                                                        </span>
                                                    </div>

                                                    <div className="admin-patients-page__appointment-grid admin-patients-page__appointment-grid--simple">
                                                        <div>
                                                            <span>{t('adminPatients.doctor')}</span>
                                                            <strong>
                                                                {appointment.doctorName || t('adminPatients.noDoctor')}
                                                            </strong>
                                                        </div>

                                                        <div>
                                                            <span>{t('adminPatients.dateTime')}</span>
                                                            <strong>
                                                                {formatDateTime(
                                                                    appointment.appointmentDate,
                                                                    t('adminPatients.noDate'),
                                                                )}
                                                            </strong>
                                                        </div>

                                                        <div>
                                                            <span>{t('adminPatients.amount')}</span>
                                                            <strong>
                                                                {appointment.paidAmountUah != null
                                                                    ? `${appointment.paidAmountUah} грн`
                                                                    : '—'}
                                                            </strong>
                                                        </div>

                                                        <div>
                                                            <span>{t('adminPatients.paidOnline')}</span>
                                                            <strong>
                                                                {isPaidOnline
                                                                    ? t('adminPatients.yes')
                                                                    : t('adminPatients.no')}
                                                            </strong>
                                                        </div>

                                                        <div>
                                                            <span>{t('adminPatients.refundStatus')}</span>
                                                            <strong>{refundLabel}</strong>
                                                        </div>
                                                    </div>

                                                    <div className="admin-patients-page__appointment-actions">
                                                        <button
                                                            type="button"
                                                            className="admin-patients-page__secondary"
                                                            disabled={processingId === appointment.id || !canCancel}
                                                            onClick={async () => {
                                                                if (!token) return;

                                                                try {
                                                                    setProcessingId(appointment.id);

                                                                    await adminCancelAppointment(token, appointment.id, {});

                                                                    setAlert({
                                                                        variant: 'success',
                                                                        message: t('adminPatients.cancelDone'),
                                                                    });

                                                                    await reloadSelectedPatient();
                                                                } catch (err: any) {
                                                                    setAlert({
                                                                        variant: 'error',
                                                                        message:
                                                                            err?.message ||
                                                                            t('adminPatients.cancelFailed'),
                                                                    });
                                                                } finally {
                                                                    setProcessingId(null);
                                                                }
                                                            }}
                                                        >
                                                            {t('adminPatients.cancelAppointment')}
                                                        </button>

                                                        <button
                                                            type="button"
                                                            className="admin-patients-page__secondary"
                                                            disabled={
                                                                processingId === appointment.id ||
                                                                appointment.status === 'CANCELLED'
                                                            }
                                                            onClick={() => openRescheduleModal(appointment)}
                                                        >
                                                            {t('adminPatients.rescheduleAppointment')}
                                                        </button>

                                                        <button
                                                            type="button"
                                                            className="admin-patients-page__secondary"
                                                            disabled={processingId === appointment.id || !isPaidOnline}
                                                            onClick={async () => {
                                                                if (!token) return;

                                                                try {
                                                                    setProcessingId(appointment.id);

                                                                    const nextRefundStatus =
                                                                        appointment.refundStatus === 'PENDING'
                                                                            ? 'REFUNDED'
                                                                            : 'PENDING';

                                                                    await adminRefundAppointment(
                                                                        token,
                                                                        appointment.id,
                                                                        {
                                                                            refundStatus: nextRefundStatus,
                                                                        },
                                                                    );

                                                                    setAlert({
                                                                        variant: 'success',
                                                                        message:
                                                                            nextRefundStatus === 'PENDING'
                                                                                ? t(
                                                                                    'adminPatients.refundPendingDone',
                                                                                )
                                                                                : t(
                                                                                    'adminPatients.refundCompletedDone',
                                                                                ),
                                                                    });

                                                                    await reloadSelectedPatient();
                                                                } catch (err: any) {
                                                                    setAlert({
                                                                        variant: 'error',
                                                                        message:
                                                                            err?.message ||
                                                                            t('adminPatients.refundFailed'),
                                                                    });
                                                                } finally {
                                                                    setProcessingId(null);
                                                                }
                                                            }}
                                                        >
                                                            {appointment.refundStatus === 'PENDING'
                                                                ? t('adminPatients.markRefunded')
                                                                : t('adminPatients.refundAction')}
                                                        </button>
                                                    </div>
                                                </article>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {rescheduleOpen && rescheduleAppointment ? (
                <div
                    className="admin-patients-page__modal-backdrop"
                    onClick={closeRescheduleModal}
                >
                    <div
                        className="admin-patients-page__modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="admin-patients-page__modal-header">
                            <div>
                                <h3>{t('adminPatients.rescheduleTitle')}</h3>
                                <p>{rescheduleAppointment.doctorName || t('adminPatients.noDoctor')}</p>
                            </div>

                            <button
                                type="button"
                                className="admin-patients-page__modal-close"
                                onClick={closeRescheduleModal}
                            >
                                ×
                            </button>
                        </div>

                        <div className="admin-patients-page__modal-body">
                            <div className="admin-patients-page__schedule-layout">
                                <div className="admin-patients-page__calendar-box">
                                    <div className="admin-patients-page__calendar-head">
                                        <h3>{t('adminPatients.calendar')}</h3>

                                        <input
                                            type="month"
                                            value={rescheduleMonth}
                                            onChange={(e) => setRescheduleMonth(e.target.value)}
                                        />
                                    </div>

                                    {loadingMonth ? (
                                        <div className="admin-patients-page__state">
                                            {t('adminPatients.loadingScheduleMonth')}
                                        </div>
                                    ) : (
                                        <div className="admin-patients-page__month-grid">
                                            {rescheduleMonthData.map((d) => (
                                                <button
                                                    key={d.date}
                                                    type="button"
                                                    className={[
                                                        'admin-patients-page__day',
                                                        d.date === rescheduleSelectedDate ? 'is-selected' : '',
                                                        !d.isWorking
                                                            ? 'is-off'
                                                            : d.freeSlots > 0
                                                                ? 'is-free'
                                                                : 'is-busy',
                                                    ].join(' ')}
                                                    onClick={() => {
                                                        setRescheduleSelectedDate(d.date);
                                                        setRescheduleSelectedTime('');
                                                        setRescheduleDayData(null);
                                                    }}
                                                >
                                                    <span className="admin-patients-page__day-number">
                                                        {d.date.slice(-2)}
                                                    </span>

                                                    <small className="admin-patients-page__day-meta">
                                                        {d.freeSlots}/{d.totalSlots}
                                                    </small>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="admin-patients-page__slots-box">
                                    <div className="admin-patients-page__calendar-head">
                                        <h3>
                                            {rescheduleSelectedDate
                                                ? `${t('adminPatients.freeTimeOn')} ${formatDateOnly(
                                                    rescheduleSelectedDate,
                                                )}`
                                                : t('adminPatients.selectDate')}
                                        </h3>
                                    </div>

                                    {!rescheduleSelectedDate ? (
                                        <div className="admin-patients-page__state">
                                            {t('adminPatients.selectDateFirst')}
                                        </div>
                                    ) : loadingDay ? (
                                        <div className="admin-patients-page__state">
                                            {t('adminPatients.loadingScheduleDay')}
                                        </div>
                                    ) : !rescheduleDayData?.isWorking ? (
                                        <div className="admin-patients-page__state">
                                            {t('adminPatients.dayUnavailable')}
                                        </div>
                                    ) : (
                                        <div className="admin-patients-page__slots">
                                            {rescheduleDayData.slots
                                                .filter((s) => s.state === 'FREE')
                                                .map((slot) => (
                                                    <button
                                                        key={slot.time}
                                                        type="button"
                                                        className={`admin-patients-page__slot ${
                                                            rescheduleSelectedTime === slot.time
                                                                ? 'is-selected'
                                                                : ''
                                                        }`}
                                                        onClick={() => setRescheduleSelectedTime(slot.time)}
                                                    >
                                                        <span>{slot.time}</span>
                                                        <span>
                                                            {rescheduleSelectedTime === slot.time
                                                                ? t('adminPatients.selected')
                                                                : t('adminPatients.choose')}
                                                        </span>
                                                    </button>
                                                ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="admin-patients-page__modal-actions">
                                <button
                                    type="button"
                                    className="admin-patients-page__secondary"
                                    onClick={closeRescheduleModal}
                                >
                                    {t('common.cancel')}
                                </button>

                                <button
                                    type="button"
                                    className="admin-patients-page__secondary"
                                    disabled={
                                        processingId === rescheduleAppointment.id ||
                                        !rescheduleSelectedDate ||
                                        !rescheduleSelectedTime
                                    }
                                    onClick={async () => {
                                        if (!token || !rescheduleAppointment || !rescheduleSelectedDate || !rescheduleSelectedTime) {
                                            return;
                                        }

                                        try {
                                            setProcessingId(rescheduleAppointment.id);

                                            await adminRescheduleAppointment(token, rescheduleAppointment.id, {
                                                doctorId: rescheduleAppointment.doctorId || undefined,
                                                appointmentDate: new Date(
                                                    `${rescheduleSelectedDate}T${rescheduleSelectedTime}:00`,
                                                ).toISOString(),
                                            });

                                            setAlert({
                                                variant: 'success',
                                                message: t('adminPatients.rescheduleDone'),
                                            });

                                            closeRescheduleModal();
                                            await reloadSelectedPatient();
                                        } catch (err: any) {
                                            setAlert({
                                                variant: 'error',
                                                message:
                                                    err?.message ||
                                                    t('adminPatients.rescheduleFailed'),
                                            });
                                        } finally {
                                            setProcessingId(null);
                                        }
                                    }}
                                >
                                    {t('adminPatients.confirmReschedule')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </section>
    );
}