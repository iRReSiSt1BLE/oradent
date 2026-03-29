import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import { buildDoctorAvatarUrl, getAllDoctors, toggleDoctorActive } from '../../shared/api/doctorApi';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import './DoctorListPage.scss';

type DoctorItem = {
    id: string;
    userId: string;
    email: string;
    lastName: string;
    firstName: string;
    middleName: string | null;
    phone: string;
    isActive: boolean;
    hasAvatar: boolean;
    avatarVersion: number;
    avatar: { sm: string; md: string; lg: string } | null;
};

export default function DoctorListPage() {
    const token = getToken();
    const role = getUserRole();
    const isAllowed = role === 'ADMIN' || role === 'SUPER_ADMIN';
    const navigate = useNavigate();

    const [doctors, setDoctors] = useState<DoctorItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [togglingId, setTogglingId] = useState<string | null>(null);

    useEffect(() => {
        void loadDoctors();
    }, []);

    async function loadDoctors() {
        if (!token) {
            setError('Спочатку увійди в систему');
            setLoading(false);
            return;
        }

        if (!isAllowed) {
            setLoading(false);
            return;
        }

        try {
            const result = await getAllDoctors(token);
            setDoctors(result.doctors);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося завантажити лікарів');
        } finally {
            setLoading(false);
        }
    }

    const filteredDoctors = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return doctors;

        return doctors.filter((doctor) => {
            const fullName = `${doctor.lastName} ${doctor.firstName} ${doctor.middleName || ''}`.toLowerCase();
            return fullName.includes(q);
        });
    }, [doctors, search]);

    async function handleToggleDoctor(doctorId: string) {
        if (!token) return;

        setMessage('');
        setError('');
        setTogglingId(doctorId);

        try {
            const result = await toggleDoctorActive(token, doctorId);

            setDoctors((prev) =>
                prev.map((item) => (item.id === doctorId ? { ...item, isActive: result.isActive } : item)),
            );

            setMessage(result.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося змінити статус лікаря');
        } finally {
            setTogglingId(null);
        }
    }

    return (
        <div className="page-shell doctor-list-page">
            <div className="container doctor-list-page__container">
                <div className="doctor-list-page__content">
                    {error && (
                        <div className="doctor-list-page__top-alert">
                            <AlertToast message={error} variant="error" onClose={() => setError('')} />
                        </div>
                    )}
                    {message && (
                        <div className="doctor-list-page__top-alert">
                            <AlertToast message={message} variant="success" onClose={() => setMessage('')} />
                        </div>
                    )}

                    <section className="doctor-list-page__card">
                        <h1 className="doctor-list-page__title">ЛІКАРІ</h1>
                        <p className="doctor-list-page__subtitle">Перегляд, активація та профілі лікарів.</p>

                        {isAllowed && (
                            <div className="doctor-list-page__search-wrap">
                                <input
                                    className="doctor-list-page__search"
                                    placeholder="Пошук по ПІБ..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>
                        )}

                        {!isAllowed ? (
                            <div className="doctor-list-page__blocked">Доступно лише для ADMIN та SUPER_ADMIN.</div>
                        ) : loading ? (
                            <div className="doctor-list-page__loading">Завантаження...</div>
                        ) : (
                            <div className="doctor-list-page__list">
                                {filteredDoctors.map((doctor) => (
                                    <article key={doctor.id} className="doctor-list-page__item">
                                        <div className="doctor-list-page__left">
                                            {doctor.hasAvatar ? (
                                                <img
                                                    className="doctor-list-page__mini-avatar"
                                                    src={buildDoctorAvatarUrl(doctor.id, 'sm', doctor.avatarVersion)}
                                                    alt={`${doctor.lastName} ${doctor.firstName}`}
                                                    loading="lazy"
                                                    decoding="async"
                                                />
                                            ) : (
                                                <div className="doctor-list-page__mini-avatar doctor-list-page__mini-avatar--placeholder">
                                                    {doctor.lastName?.[0] || 'Л'}
                                                </div>
                                            )}

                                            <div className="doctor-list-page__meta">
                                                <h3>
                                                    {doctor.lastName} {doctor.firstName} {doctor.middleName || ''}
                                                    <span
                                                        className={`doctor-list-page__status-dot ${
                                                            doctor.isActive ? 'is-active' : 'is-inactive'
                                                        }`}
                                                    />
                                                </h3>
                                                <p>{doctor.email}</p>
                                                <p>{doctor.phone}</p>
                                            </div>
                                        </div>

                                        <div className="doctor-list-page__actions">
                                            <button
                                                type="button"
                                                className="doctor-list-page__action-btn"
                                                onClick={() => handleToggleDoctor(doctor.id)}
                                                disabled={togglingId === doctor.id}
                                            >
                                                {togglingId === doctor.id
                                                    ? 'ОБРОБКА...'
                                                    : doctor.isActive
                                                        ? 'ДЕАКТИВУВАТИ'
                                                        : 'АКТИВУВАТИ'}
                                            </button>

                                            <button
                                                type="button"
                                                className="doctor-list-page__action-btn"
                                                onClick={() => navigate(`/admin/doctors/${doctor.id}`)}
                                            >
                                                ПРОФІЛЬ
                                            </button>
                                        </div>
                                    </article>
                                ))}

                                {!filteredDoctors.length && (
                                    <div className="doctor-list-page__empty">Нічого не знайдено за ПІБ.</div>
                                )}
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}
