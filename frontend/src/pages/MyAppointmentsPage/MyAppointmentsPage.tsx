import { useEffect, useMemo, useState } from 'react';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    getMyAppointments,
    type AppointmentItem,
} from '../../shared/api/appointmentApi';
import { getToken } from '../../shared/utils/authStorage';
import { useI18n } from '../../shared/i18n/I18nProvider';
import './MyAppointmentsPage.scss';

type TabKey = 'active' | 'completed';

type AlertState = {
    variant: 'success' | 'error' | 'info';
    message: string;
} | null;

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

        if ('data' in record && record.data && typeof record.data === 'object') {
            return (
                record.data[language] ||
                record.data.ua ||
                record.data.en ||
                record.data.de ||
                record.data.fr ||
                ''
            );
        }

        return '';
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

function dateParts(value: string | null) {
    if (!value) {
        return {
            day: '--',
            monthYear: '—',
            time: '—',
        };
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return {
            day: '--',
            monthYear: '—',
            time: '—',
        };
    }

    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');

    return {
        day: dd,
        monthYear: `${mm}.${yyyy}`,
        time: `${hh}:${min}`,
    };
}

function statusLabel(item: AppointmentItem, t: (key: string) => string) {
    switch (item.status) {
        case 'COMPLETED':
            return t('myAppointments.statusCompleted');
        case 'CANCELLED':
            return t('myAppointments.statusCancelled');
        case 'BOOKED':
        default:
            return t('myAppointments.statusBooked');
    }
}

function statusTone(item: AppointmentItem) {
    switch (item.status) {
        case 'COMPLETED':
            return 'is-completed';
        case 'CANCELLED':
            return 'is-cancelled';
        case 'BOOKED':
        default:
            return 'is-booked';
    }
}

function paymentLabel(item: AppointmentItem, t: (key: string) => string) {
    if (item.paymentStatus === 'PAID') return t('myAppointments.paymentPaid');
    if (item.paymentStatus === 'FAILED') return t('myAppointments.paymentFailed');
    if (item.paymentMethod === 'CASH') return t('myAppointments.paymentAtClinic');
    return t('myAppointments.paymentPending');
}

function paymentTone(item: AppointmentItem) {
    if (item.paymentStatus === 'PAID') return 'is-paid';
    if (item.paymentStatus === 'FAILED') return 'is-failed';
    return 'is-pending';
}

function paymentMethodLabel(item: AppointmentItem, t: (key: string) => string) {
    if (item.paymentMethod === 'GOOGLE_PAY') return 'Google Pay';
    if (item.paymentMethod === 'CASH') return t('myAppointments.paymentMethodCash');
    return item.paymentMethod || '—';
}

function sourceLabel(item: AppointmentItem, t: (key: string) => string) {
    if (item.source === 'GUEST') return t('myAppointments.sourceGuest');
    return t('myAppointments.sourceAuthenticated');
}

export default function MyAppointmentsPage() {
    const token = getToken();
    const { language, t } = useI18n();

    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<TabKey>('active');
    const [activeAppointments, setActiveAppointments] = useState<AppointmentItem[]>([]);
    const [completedAppointments, setCompletedAppointments] = useState<AppointmentItem[]>([]);
    const [alert, setAlert] = useState<AlertState>(null);

    useEffect(() => {
        async function load() {
            if (!token) {
                setLoading(false);
                setAlert({
                    variant: 'error',
                    message: t('myAppointments.authRequired'),
                });
                return;
            }

            try {
                setLoading(true);
                const response = await getMyAppointments(token);
                setActiveAppointments(Array.isArray(response.active) ? response.active : []);
                setCompletedAppointments(Array.isArray(response.completed) ? response.completed : []);
            } catch (err: any) {
                setAlert({
                    variant: 'error',
                    message: err?.message || t('myAppointments.loadFailed'),
                });
            } finally {
                setLoading(false);
            }
        }

        void load();
    }, [token, t]);

    const items = useMemo(
        () => (tab === 'active' ? activeAppointments : completedAppointments),
        [tab, activeAppointments, completedAppointments],
    );

    return (
        <section className="my-appointments-page">
            {alert && (
                <AlertToast
                    variant={alert.variant}
                    message={alert.message}
                    onClose={() => setAlert(null)}
                />
            )}

            <div className="container my-appointments-page__container">
                <h1 className="my-appointments-page__title">
                    {t('myAppointments.title')}
                </h1>
                <p className="my-appointments-page__subtitle">
                    {t('myAppointments.subtitle')}
                </p>

                <div className="my-appointments-page__tabs">
                    <button
                        type="button"
                        className={`my-appointments-page__tab ${tab === 'active' ? 'is-active' : ''}`}
                        onClick={() => setTab('active')}
                    >
                        {t('myAppointments.tabActive')}
                    </button>

                    <button
                        type="button"
                        className={`my-appointments-page__tab ${tab === 'completed' ? 'is-active' : ''}`}
                        onClick={() => setTab('completed')}
                    >
                        {t('myAppointments.tabCompleted')}
                    </button>
                </div>

                {loading ? (
                    <div className="my-appointments-page__state">
                        {t('myAppointments.loading')}
                    </div>
                ) : !items.length ? (
                    <div className="my-appointments-page__state">
                        {tab === 'active'
                            ? t('myAppointments.emptyActive')
                            : t('myAppointments.emptyCompleted')}
                    </div>
                ) : (
                    <div className="my-appointments-page__list">
                        {items.map((item) => {
                            const serviceLabel =
                                parseDbI18nValue(item.serviceName, language) || '—';
                            const doctorLabel = item.doctorName || '—';
                            const dateCard = dateParts(item.appointmentDate);

                            return (
                                <article key={item.id} className="my-appointments-page__item">
                                    <div className="my-appointments-page__left">
                                        <div className="my-appointments-page__date-card">
                                            <span className="my-appointments-page__date-day">
                                                {dateCard.day}
                                            </span>
                                            <span className="my-appointments-page__date-month">
                                                {dateCard.monthYear}
                                            </span>
                                            <span className="my-appointments-page__date-time">
                                                {dateCard.time}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="my-appointments-page__right">
                                        <div className="my-appointments-page__item-head">
                                            <div className="my-appointments-page__item-head-main">
                                                <h2 className="my-appointments-page__service">
                                                    {serviceLabel}
                                                </h2>
                                                <p className="my-appointments-page__doctor">
                                                    {doctorLabel}
                                                </p>
                                            </div>

                                            <div className="my-appointments-page__badges">
                                                <span
                                                    className={`my-appointments-page__badge ${statusTone(item)}`}
                                                >
                                                    {statusLabel(item, t)}
                                                </span>
                                                <span
                                                    className={`my-appointments-page__badge my-appointments-page__badge--payment ${paymentTone(item)}`}
                                                >
                                                    {paymentLabel(item, t)}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="my-appointments-page__grid">
                                            <div className="my-appointments-page__field">
                                                <span className="my-appointments-page__label">
                                                    {t('myAppointments.dateTime')}
                                                </span>
                                                <strong className="my-appointments-page__value">
                                                    {formatDateTime(
                                                        item.appointmentDate,
                                                        t('myAppointments.noDate'),
                                                    )}
                                                </strong>
                                            </div>

                                            <div className="my-appointments-page__field">
                                                <span className="my-appointments-page__label">
                                                    {t('myAppointments.source')}
                                                </span>
                                                <strong className="my-appointments-page__value">
                                                    {sourceLabel(item, t)}
                                                </strong>
                                            </div>

                                            <div className="my-appointments-page__field">
                                                <span className="my-appointments-page__label">
                                                    {t('myAppointments.paymentMethod')}
                                                </span>
                                                <strong className="my-appointments-page__value">
                                                    {paymentMethodLabel(item, t)}
                                                </strong>
                                            </div>

                                            <div className="my-appointments-page__field">
                                                <span className="my-appointments-page__label">
                                                    {t('myAppointments.amount')}
                                                </span>
                                                <strong className="my-appointments-page__value">
                                                    {item.paidAmountUah != null
                                                        ? `${item.paidAmountUah} грн`
                                                        : '—'}
                                                </strong>
                                            </div>

                                            <div className="my-appointments-page__field my-appointments-page__field--wide">
                                                <span className="my-appointments-page__label">
                                                    {t('myAppointments.recordNumber')}
                                                </span>
                                                <strong className="my-appointments-page__value">
                                                    #{item.id.slice(0, 8)}
                                                </strong>
                                            </div>
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </div>
        </section>
    );
}