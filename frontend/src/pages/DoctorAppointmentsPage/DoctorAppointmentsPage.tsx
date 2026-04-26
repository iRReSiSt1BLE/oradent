import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    getConsultationPdfWithPassword,
    getDoctorArchiveAppointments,
    getDoctorSharedArchiveAppointments,
    type DoctorArchiveAppointmentItem,
} from '../../shared/api/appointmentApi';
import {
    getVideosByAppointment,
    shareAppointmentVideos,
    streamVideoWithPassword,
    type VideoRecord,
} from '../../shared/api/videoApi';
import { getPublicDoctors, type PublicDoctorItem } from '../../shared/api/doctorApi';
import { getToken } from '../../shared/utils/authStorage';
import './DoctorAppointmentsPage.scss';

type AlertState = {
    variant: 'success' | 'error' | 'info';
    message: string;
} | null;

type TabKey = 'mine' | 'shared';
type AccessDurationKey = 'forever' | '30m' | '1h' | '90m' | '1d' | '3d' | '7d' | '30d';

type PasswordAction =
    | { type: 'videos'; appointment: DoctorArchiveAppointmentItem }
    | { type: 'pdf'; appointment: DoctorArchiveAppointmentItem }
    | { type: 'share'; appointment: DoctorArchiveAppointmentItem };

type LoadedVideo = {
    id: string;
    fileName: string;
    url: string;
    createdAt: string;
};

const accessDurationOptions: Array<{ value: AccessDurationKey; label: string }> = [
    { value: 'forever', label: 'Назавжди' },
    { value: '30m', label: '30 хвилин' },
    { value: '1h', label: '1 година' },
    { value: '90m', label: '1.5 години' },
    { value: '1d', label: '1 день' },
    { value: '3d', label: '3 дні' },
    { value: '7d', label: '7 днів' },
    { value: '30d', label: '30 днів' },
];

function dedupeVideoRecords(records: VideoRecord[]) {
    const seen = new Map<string, VideoRecord>();
    records.forEach((record) => {
        const key = record.id || `${record.originalFileName}-${record.createdAt}`;
        if (!seen.has(key)) seen.set(key, record);
    });
    return Array.from(seen.values());
}

function formatDateTime(value: string | null) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function formatDateOnly(value: string | null) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(date);
}

function resolveStatusLabel(item: DoctorArchiveAppointmentItem) {
    const status = String(item.visitFlowStatus || item.status || '').toUpperCase();
    if (status === 'COMPLETED') return 'Завершено';
    if (status === 'NO_SHOW') return 'Не з’явився';
    if (String(item.status || '').toUpperCase() === 'CANCELLED') return 'Скасовано';
    return 'Минув';
}

function resolveDurationExpiry(value: AccessDurationKey) {
    if (value === 'forever') return null;

    const now = new Date();
    const next = new Date(now);

    if (value === '30m') next.setMinutes(next.getMinutes() + 30);
    if (value === '1h') next.setHours(next.getHours() + 1);
    if (value === '90m') next.setMinutes(next.getMinutes() + 90);
    if (value === '1d') next.setDate(next.getDate() + 1);
    if (value === '3d') next.setDate(next.getDate() + 3);
    if (value === '7d') next.setDate(next.getDate() + 7);
    if (value === '30d') next.setDate(next.getDate() + 30);

    return next.toISOString();
}

export default function DoctorAppointmentsPage() {
    const navigate = useNavigate();
    const token = getToken();

    const [tab, setTab] = useState<TabKey>('mine');
    const [mine, setMine] = useState<DoctorArchiveAppointmentItem[]>([]);
    const [shared, setShared] = useState<DoctorArchiveAppointmentItem[]>([]);
    const [doctors, setDoctors] = useState<PublicDoctorItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [alert, setAlert] = useState<AlertState>(null);
    const [passwordAction, setPasswordAction] = useState<PasswordAction | null>(null);
    const [password, setPassword] = useState('');
    const [passwordSubmitting, setPasswordSubmitting] = useState(false);
    const [shareDoctorId, setShareDoctorId] = useState('');
    const [shareDuration, setShareDuration] = useState<AccessDurationKey>('forever');
    const [videosModalFor, setVideosModalFor] = useState<DoctorArchiveAppointmentItem | null>(null);
    const [loadedVideos, setLoadedVideos] = useState<LoadedVideo[]>([]);

    const visibleItems = useMemo(() => (tab === 'mine' ? mine : shared), [mine, shared, tab]);

    useEffect(() => {
        return () => {
            loadedVideos.forEach((video) => URL.revokeObjectURL(video.url));
        };
    }, [loadedVideos]);

    async function loadData() {
        if (!token) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const [mineRes, sharedRes, doctorsRes] = await Promise.all([
                getDoctorArchiveAppointments(token),
                getDoctorSharedArchiveAppointments(token),
                getPublicDoctors(),
            ]);

            setMine(Array.isArray(mineRes.appointments) ? mineRes.appointments : []);
            setShared(Array.isArray(sharedRes.appointments) ? sharedRes.appointments : []);
            setDoctors(Array.isArray((doctorsRes as any)?.doctors) ? (doctorsRes as any).doctors : []);
        } catch (err) {
            setAlert({
                variant: 'error',
                message: err instanceof Error ? err.message : 'Не вдалося завантажити архів прийомів',
            });
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadData();
    }, [token]);

    function openPasswordAction(action: PasswordAction) {
        setPassword('');
        setShareDoctorId('');
        setShareDuration('forever');
        setPasswordAction(action);
    }

    async function handlePasswordActionConfirm() {
        if (!token || !passwordAction) return;
        if (!password.trim()) {
            setAlert({ variant: 'error', message: 'Вкажи пароль від акаунта' });
            return;
        }

        setPasswordSubmitting(true);
        try {
            if (passwordAction.type === 'pdf') {
                const blob = await getConsultationPdfWithPassword(token, passwordAction.appointment.id, password.trim());
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank', 'noopener,noreferrer');
                window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
                setAlert({ variant: 'success', message: 'Консультативний файл відкрито' });
            }

            if (passwordAction.type === 'videos') {
                const response = await getVideosByAppointment(token, passwordAction.appointment.id);
                const records = dedupeVideoRecords(Array.isArray(response.data) ? response.data : []);

                if (!records.length) {
                    throw new Error('Для цього прийому відео ще немає');
                }

                loadedVideos.forEach((video) => URL.revokeObjectURL(video.url));

                const blobs = await Promise.all(
                    records.map(async (record: VideoRecord) => {
                        const blob = await streamVideoWithPassword(token, record.id, password.trim());
                        return {
                            id: record.id,
                            fileName: record.originalFileName,
                            createdAt: record.createdAt,
                            url: URL.createObjectURL(blob),
                        } as LoadedVideo;
                    }),
                );

                setLoadedVideos(blobs);
                setVideosModalFor(passwordAction.appointment);
                setAlert({ variant: 'success', message: 'Відео підготовлено до перегляду' });
            }

            if (passwordAction.type === 'share') {
                if (!shareDoctorId) {
                    throw new Error('Оберіть лікаря, якому треба надати доступ');
                }

                const result = await shareAppointmentVideos(token, passwordAction.appointment.id, {
                    sharedWithDoctorId: shareDoctorId,
                    password: password.trim(),
                    expiresAt: resolveDurationExpiry(shareDuration),
                });

                setAlert({
                    variant: 'success',
                    message: result.message || 'Доступ до відео успішно надано',
                });
                await loadData();
            }

            setPasswordAction(null);
            setPassword('');
        } catch (err) {
            setAlert({
                variant: 'error',
                message: err instanceof Error ? err.message : 'Не вдалося виконати дію',
            });
        } finally {
            setPasswordSubmitting(false);
        }
    }

    return (
        <div className="page-shell doctor-appointments-page">
            {alert ? <AlertToast message={alert.message} variant={alert.variant} onClose={() => setAlert(null)} /> : null}

            <div className="container doctor-appointments-page__container">
                <section className="doctor-appointments-page__card">
                    <div className="doctor-appointments-page__head">
                        <div>
                            <h1 className="doctor-appointments-page__title">МИНУЛІ ЗАПИСИ</h1>
                            <p className="doctor-appointments-page__subtitle">
                                Тут зібрані завершені або минулі прийоми, а також записи, якими поділилися з вами інші лікарі.
                            </p>
                        </div>

                        <button
                            type="button"
                            className="doctor-appointments-page__ghost-btn"
                            onClick={() => navigate('/doctor/appointments-week')}
                        >
                            Назад до тижня
                        </button>
                    </div>

                    <div className="doctor-appointments-page__tabs">
                        <button
                            type="button"
                            className={`doctor-appointments-page__tab ${tab === 'mine' ? 'is-active' : ''}`}
                            onClick={() => setTab('mine')}
                        >
                            Мої минулі
                        </button>
                        <button
                            type="button"
                            className={`doctor-appointments-page__tab ${tab === 'shared' ? 'is-active' : ''}`}
                            onClick={() => setTab('shared')}
                        >
                            Поділилися зі мною
                        </button>
                    </div>

                    {loading ? (
                        <div className="doctor-appointments-page__list">
                            {Array.from({ length: 3 }).map((_, index) => (
                                <div key={`skeleton-${index}`} className="doctor-appointments-page__skeleton" />
                            ))}
                        </div>
                    ) : visibleItems.length === 0 ? (
                        <div className="doctor-appointments-page__state">
                            {tab === 'mine'
                                ? 'У вас поки немає минулих записів.'
                                : 'Ще немає записів, якими з вами поділилися.'}
                        </div>
                    ) : (
                        <div className="doctor-appointments-page__list">
                            {visibleItems.map((item) => (
                                <article key={item.id} className={`doctor-appointments-page__item ${tab === 'shared' ? 'is-shared' : ''}`}>
                                    <div className="doctor-appointments-page__item-top">
                                        <div>
                                            <h2>{item.patient?.fullName || 'Пацієнт не вказаний'}</h2>
                                            <p>{formatDateTime(item.appointmentDate)}</p>
                                        </div>
                                        <span className="doctor-appointments-page__status-pill">{resolveStatusLabel(item)}</span>
                                    </div>

                                    <div className="doctor-appointments-page__grid">
                                        <div>
                                            <span>Телефон</span>
                                            <strong>{item.patient?.phone || '—'}</strong>
                                        </div>
                                        <div>
                                            <span>Пошта</span>
                                            <strong>{item.patient?.email || '—'}</strong>
                                        </div>
                                        <div>
                                            <span>Послуга</span>
                                            <strong>{item.serviceName || '—'}</strong>
                                        </div>
                                        <div>
                                            <span>Кабінет</span>
                                            <strong>{item.cabinetName || '—'}</strong>
                                        </div>
                                        {tab === 'shared' ? (
                                            <>
                                                <div>
                                                    <span>Лікар-власник</span>
                                                    <strong>{item.sharedByDoctorName || item.doctorName || '—'}</strong>
                                                </div>
                                                <div>
                                                    <span>Доступ до</span>
                                                    <strong>{item.accessExpiresAt ? formatDateTime(item.accessExpiresAt) : 'Без обмеження'}</strong>
                                                </div>
                                            </>
                                        ) : null}
                                    </div>

                                    <div className="doctor-appointments-page__actions">
                                        <button
                                            type="button"
                                            className="doctor-appointments-page__secondary-btn"
                                            onClick={() => openPasswordAction({ type: 'pdf', appointment: item })}
                                            disabled={!item.consultationPdfReady}
                                        >
                                            Переглянути файл
                                        </button>

                                        <button
                                            type="button"
                                            className="doctor-appointments-page__secondary-btn"
                                            onClick={() => navigate(`/my-dental-chart?appointmentId=${item.id}`)}
                                        >
                                            Переглянути зубну карту
                                        </button>

                                        <button
                                            type="button"
                                            className="doctor-appointments-page__secondary-btn"
                                            onClick={() => openPasswordAction({ type: 'videos', appointment: item })}
                                            disabled={Number(item.videosCount || 0) <= 0}
                                        >
                                            Переглянути відео
                                        </button>

                                        {tab === 'mine' ? (
                                            <button
                                                type="button"
                                                className="doctor-appointments-page__primary-btn"
                                                onClick={() => openPasswordAction({ type: 'share', appointment: item })}
                                            >
                                                Надати доступ іншому лікарю
                                            </button>
                                        ) : null}
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            {passwordAction ? (
                <div className="doctor-appointments-page__modal-backdrop" onClick={() => !passwordSubmitting && setPasswordAction(null)}>
                    <div className="doctor-appointments-page__modal" onClick={(event) => event.stopPropagation()}>
                        <div className="doctor-appointments-page__modal-head">
                            <div>
                                <h3>
                                    {passwordAction.type === 'pdf'
                                        ? 'Перегляд консультативного файлу'
                                        : passwordAction.type === 'videos'
                                            ? 'Перегляд відео'
                                            : 'Надати доступ до відео'}
                                </h3>
                                <p>
                                    {passwordAction.type === 'share'
                                        ? 'Оберіть лікаря, строк доступу та підтвердьте дію паролем.'
                                        : 'Для цієї дії потрібно підтвердити пароль від вашого акаунта.'}
                                </p>
                            </div>
                            <button
                                type="button"
                                className="doctor-appointments-page__icon-btn"
                                onClick={() => !passwordSubmitting && setPasswordAction(null)}
                            >
                                ×
                            </button>
                        </div>

                        <div className="doctor-appointments-page__modal-body">
                            {passwordAction.type === 'share' ? (
                                <>
                                    <label className="doctor-appointments-page__field">
                                        <span>ЛІКАР</span>
                                        <select value={shareDoctorId} onChange={(event) => setShareDoctorId(event.target.value)}>
                                            <option value="">Оберіть лікаря</option>
                                            {doctors
                                                .filter((doctor) => (doctor.userId || doctor.id) !== passwordAction.appointment.doctorId)
                                                .map((doctor) => (
                                                    <option key={doctor.id} value={doctor.userId || doctor.id}>
                                                        {[doctor.lastName, doctor.firstName, doctor.middleName].filter(Boolean).join(' ')}
                                                    </option>
                                                ))}
                                        </select>
                                    </label>

                                    <label className="doctor-appointments-page__field">
                                        <span>СТРОК ДОСТУПУ</span>
                                        <select value={shareDuration} onChange={(event) => setShareDuration(event.target.value as AccessDurationKey)}>
                                            {accessDurationOptions.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </>
                            ) : null}

                            <label className="doctor-appointments-page__field">
                                <span>ПАРОЛЬ ВІД АКАУНТА</span>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(event) => setPassword(event.target.value)}
                                    placeholder="Введіть пароль"
                                />
                            </label>
                        </div>

                        <div className="doctor-appointments-page__modal-actions">
                            <button
                                type="button"
                                className="doctor-appointments-page__ghost-btn"
                                onClick={() => setPasswordAction(null)}
                                disabled={passwordSubmitting}
                            >
                                Скасувати
                            </button>
                            <button
                                type="button"
                                className="doctor-appointments-page__primary-btn"
                                onClick={() => void handlePasswordActionConfirm()}
                                disabled={passwordSubmitting}
                            >
                                {passwordSubmitting ? <span className="doctor-appointments-page__spinner" /> : null}
                                {passwordSubmitting ? 'Виконання...' : 'Підтвердити'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {videosModalFor ? (
                <div className="doctor-appointments-page__modal-backdrop" onClick={() => setVideosModalFor(null)}>
                    <div className="doctor-appointments-page__modal doctor-appointments-page__modal--videos" onClick={(event) => event.stopPropagation()}>
                        <div className="doctor-appointments-page__modal-head">
                            <div>
                                <h3>ВІДЕО ПРИЙОМУ</h3>
                                <p>{videosModalFor.patient?.fullName || 'Пацієнт не вказаний'} · {formatDateOnly(videosModalFor.appointmentDate)}</p>
                            </div>
                            <button
                                type="button"
                                className="doctor-appointments-page__icon-btn"
                                onClick={() => setVideosModalFor(null)}
                            >
                                ×
                            </button>
                        </div>

                        <div className="doctor-appointments-page__videos-list">
                            {loadedVideos.map((video) => (
                                <article key={video.id} className="doctor-appointments-page__video-card">
                                    <div className="doctor-appointments-page__video-head">
                                        <strong>{video.fileName}</strong>
                                        <span>{formatDateTime(video.createdAt)}</span>
                                    </div>
                                    <video controls className="doctor-appointments-page__video-player" src={video.url} />
                                </article>
                            ))}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
