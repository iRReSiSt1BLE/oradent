import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    getConsultationPdfWithPassword,
    getMyAppointments,
    type AppointmentItem,
} from '../../shared/api/appointmentApi';
import { getToken } from '../../shared/utils/authStorage';
import { useI18n } from '../../shared/i18n/I18nProvider';
import ReviewModal from '../../shared/ui/ReviewModal/ReviewModal';
import ReviewStars from '../../shared/ui/ReviewStars/ReviewStars';
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
            return record.data[language] || record.data.ua || record.data.en || record.data.de || record.data.fr || '';
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

function formatDateTime(value: string | null, fallback = '—') {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('uk-UA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function dateParts(value: string | null) {
    if (!value) {
        return { day: '--', monthYear: '—', time: '—' };
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return { day: '--', monthYear: '—', time: '—' };
    }

    return {
        day: String(date.getDate()).padStart(2, '0'),
        monthYear: `${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`,
        time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
    };
}

function isReviewable(item: AppointmentItem) {
    const status = String(item.visitFlowStatus || item.status || '').toUpperCase();
    return status === 'COMPLETED';
}

function statusLabel(item: AppointmentItem) {
    const status = String(item.visitFlowStatus || item.status || '').toUpperCase();
    if (status === 'COMPLETED') return 'Завершено';
    if (status === 'NO_SHOW') return 'Не відбувся';
    if (status === 'CANCELLED') return 'Скасовано';
    return 'Заплановано';
}

function paymentLabel(item: AppointmentItem) {
    if (item.paymentStatus === 'PAID') return 'Оплачено';
    if (item.paymentMethod === 'CASH') return 'Оплата на місці';
    if (item.paymentStatus === 'FAILED') return 'Оплата не пройшла';
    return 'Очікує оплату';
}

function cardTone(item: AppointmentItem) {
    const status = String(item.visitFlowStatus || item.status || '').toUpperCase();
    if (status === 'COMPLETED') return 'is-completed';
    if (status === 'NO_SHOW' || status === 'CANCELLED') return 'is-muted';
    return 'is-active';
}

function SkeletonCard() {
    return (
        <article className="my-appointments-page__card my-appointments-page__card--skeleton">
            <div className="my-appointments-page__date-card" />
            <div className="my-appointments-page__skeleton-body">
                <span />
                <span />
                <span />
            </div>
        </article>
    );
}

export default function MyAppointmentsPage() {
    const token = getToken();
    const { language, t } = useI18n();

    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<TabKey>('active');
    const [activeAppointments, setActiveAppointments] = useState<AppointmentItem[]>([]);
    const [completedAppointments, setCompletedAppointments] = useState<AppointmentItem[]>([]);
    const [alert, setAlert] = useState<AlertState>(null);
    const [reviewTarget, setReviewTarget] = useState<AppointmentItem | null>(null);
    const [pdfTarget, setPdfTarget] = useState<AppointmentItem | null>(null);
    const [pdfPassword, setPdfPassword] = useState('');
    const [pdfLoading, setPdfLoading] = useState(false);
    const [pdfError, setPdfError] = useState('');

    useEffect(() => {
        async function load() {
            if (!token) {
                setLoading(false);
                setAlert({ variant: 'error', message: t('myAppointments.authRequired') });
                return;
            }

            try {
                setLoading(true);
                const response = await getMyAppointments(token);
                setActiveAppointments(Array.isArray(response.active) ? response.active : []);
                setCompletedAppointments(Array.isArray(response.completed) ? response.completed : []);
            } catch (err) {
                setAlert({
                    variant: 'error',
                    message: err instanceof Error ? err.message : t('myAppointments.loadFailed'),
                });
            } finally {
                setLoading(false);
            }
        }

        void load();
    }, [token, t]);

    const items = useMemo(() => (tab === 'active' ? activeAppointments : completedAppointments), [tab, activeAppointments, completedAppointments]);

    async function handleOpenPdf() {
        if (!token || !pdfTarget) return;
        try {
            setPdfLoading(true);
            setPdfError('');
            const blob = await getConsultationPdfWithPassword(token, pdfTarget.id, pdfPassword);
            const url = window.URL.createObjectURL(blob);
            window.open(url, '_blank', 'noopener,noreferrer');
            window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
            setPdfTarget(null);
            setPdfPassword('');
        } catch (err) {
            setPdfError(err instanceof Error ? err.message : 'Не вдалося відкрити файл');
        } finally {
            setPdfLoading(false);
        }
    }

    function handleReviewSubmitted(updatedAppointment: AppointmentItem, message: string) {
        setCompletedAppointments((prev) => prev.map((item) => (item.id === updatedAppointment.id ? { ...item, ...updatedAppointment } : item)));
        setAlert({ variant: 'success', message });
    }

    return (
        <section className="my-appointments-page">
            {alert ? <AlertToast variant={alert.variant} message={alert.message} onClose={() => setAlert(null)} /> : null}

            {token ? (
                <ReviewModal
                    open={Boolean(reviewTarget)}
                    token={token}
                    appointmentId={reviewTarget?.id || null}
                    serviceName={reviewTarget ? parseDbI18nValue(reviewTarget.serviceName, language) : ''}
                    doctorName={reviewTarget?.doctorName || ''}
                    onClose={() => setReviewTarget(null)}
                    onSubmitted={(appointment, message) => handleReviewSubmitted(appointment, message)}
                />
            ) : null}

            {pdfTarget ? (
                <div className="my-appointments-page__modal" role="dialog" aria-modal="true">
                    <div className="my-appointments-page__modal-backdrop" onClick={() => setPdfTarget(null)} />
                    <div className="my-appointments-page__modal-card">
                        <button type="button" className="my-appointments-page__modal-close" onClick={() => setPdfTarget(null)}>
                            ×
                        </button>
                        <h3>Перегляд консультативного висновку</h3>
                        <p>Введіть пароль від акаунта, щоб відкрити PDF-файл.</p>
                        <input
                            type="password"
                            value={pdfPassword}
                            onChange={(event) => setPdfPassword(event.target.value)}
                            placeholder="Пароль від акаунта"
                            disabled={pdfLoading}
                        />
                        {pdfError ? <div className="my-appointments-page__modal-error">{pdfError}</div> : null}
                        <button type="button" className="my-appointments-page__modal-submit" onClick={() => void handleOpenPdf()} disabled={pdfLoading}>
                            {pdfLoading ? <span className="my-appointments-page__spinner" /> : null}
                            <span>{pdfLoading ? 'Відкриваємо...' : 'Відкрити файл'}</span>
                        </button>
                    </div>
                </div>
            ) : null}

            <div className="container my-appointments-page__container">
                <div className="my-appointments-page__head">
                    <h1 className="my-appointments-page__title">{t('myAppointments.title')}</h1>
                    <p className="my-appointments-page__subtitle">Ваші майбутні та завершені записи, консультативні висновки та відгуки.</p>
                </div>

                <div className="my-appointments-page__tabs">
                    <button type="button" className={`my-appointments-page__tab ${tab === 'active' ? 'is-active' : ''}`} onClick={() => setTab('active')}>
                        Активні
                    </button>
                    <button type="button" className={`my-appointments-page__tab ${tab === 'completed' ? 'is-active' : ''}`} onClick={() => setTab('completed')}>
                        Завершені
                    </button>
                </div>

                {loading ? (
                    <div className="my-appointments-page__list">
                        <SkeletonCard />
                        <SkeletonCard />
                        <SkeletonCard />
                    </div>
                ) : !items.length ? (
                    <div className="my-appointments-page__state">
                        {tab === 'active' ? 'Наразі у вас немає активних записів.' : 'Наразі немає завершених записів.'}
                    </div>
                ) : (
                    <div className="my-appointments-page__list">
                        {items.map((item) => {
                            const serviceLabel = parseDbI18nValue(item.serviceName, language) || '—';
                            const doctorLabel = item.doctorName || '—';
                            const dateCard = dateParts(item.appointmentDate);
                            const reviewed = item.reviewRating != null;
                            const canOpenPdf = Boolean(item.consultationConclusion || (item.treatmentPlanItems || []).length || (item.recommendationItems || []).length || (item.medicationItems || []).length);

                            return (
                                <article key={item.id} className={`my-appointments-page__card ${cardTone(item)}`}>
                                    <div className="my-appointments-page__date-wrap">
                                        <div className="my-appointments-page__date-card">
                                            <span>{dateCard.day}</span>
                                            <strong>{dateCard.monthYear}</strong>
                                            <small>{dateCard.time}</small>
                                        </div>
                                    </div>

                                    <div className="my-appointments-page__card-body">
                                        <div className="my-appointments-page__card-top">
                                            <div>
                                                <h2>{serviceLabel}</h2>
                                                <p>{doctorLabel}</p>
                                            </div>
                                            <div className="my-appointments-page__badges">
                                                <span className="my-appointments-page__badge">{statusLabel(item)}</span>
                                                <span className="my-appointments-page__badge my-appointments-page__badge--soft">{paymentLabel(item)}</span>
                                            </div>
                                        </div>

                                        <div className="my-appointments-page__grid">
                                            <div>
                                                <span>Дата та час</span>
                                                <strong>{formatDateTime(item.appointmentDate)}</strong>
                                            </div>
                                            <div>
                                                <span>Номер запису</span>
                                                <strong>#{item.id.slice(0, 8)}</strong>
                                            </div>
                                            <div>
                                                <span>Оплата</span>
                                                <strong>{item.paidAmountUah != null ? `${item.paidAmountUah} грн` : '—'}</strong>
                                            </div>
                                            <div>
                                                <span>Джерело</span>
                                                <strong>{item.source === 'GUEST' ? 'Гостьовий запис' : item.source === 'DOCTOR_FOLLOW_UP' ? 'Запис лікарем' : 'Через акаунт'}</strong>
                                            </div>
                                        </div>

                                        {tab === 'completed' ? (
                                            <div className="my-appointments-page__footer">
                                                {canOpenPdf ? (
                                                    <button type="button" className="my-appointments-page__action-btn" onClick={() => {
                                                        setPdfTarget(item);
                                                        setPdfError('');
                                                        setPdfPassword('');
                                                    }}>
                                                        Переглянути висновок
                                                    </button>
                                                ) : null}

                                                <Link className="my-appointments-page__action-btn" to={`/my-dental-chart?appointmentId=${item.id}`}>
                                                    Переглянути зубну карту
                                                </Link>

                                                {isReviewable(item) && !reviewed ? (
                                                    <button type="button" className="my-appointments-page__action-btn my-appointments-page__action-btn--primary" onClick={() => setReviewTarget(item)}>
                                                        Залишити відгук
                                                    </button>
                                                ) : null}

                                                {reviewed ? (
                                                    <div className="my-appointments-page__review-chip">
                                                        <ReviewStars value={Number(item.reviewRating || 0)} size="sm" />
                                                        <span>{Number(item.reviewRating || 0).toFixed(1)}</span>
                                                        <small>{item.reviewAnonymous ? 'Анонімний відгук' : 'Відгук додано'}</small>
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}
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
