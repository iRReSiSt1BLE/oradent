import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    getAllDoctors,
    requestDoctorEmailVerification,
    toggleDoctorActive,
    updateDoctor,
} from '../../shared/api/doctorApi';
import { getPhoneVerificationStatus, startPhoneVerification } from '../../shared/api/phoneVerificationApi';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import TelegramQrCard from '../../shared/ui/TelegramQrCard/TelegramQrCard';
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

const EMAIL_COOLDOWN_MS = 3 * 60 * 1000;
const EMAIL_COOLDOWN_KEY = 'doctorEdit.emailCooldown.v1';

function normalizeEmail(value: string) {
    return value.trim().toLowerCase();
}

function normalizePhone(value: string) {
    return value.trim();
}

function formatCooldown(ms: number) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

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

    const [editingDoctor, setEditingDoctor] = useState<DoctorItem | null>(null);
    const [editLoading, setEditLoading] = useState(false);
    const [emailCodeLoading, setEmailCodeLoading] = useState(false);
    const [phoneVerifyLoading, setPhoneVerifyLoading] = useState(false);

    const [modalError, setModalError] = useState('');
    const [modalMessage, setModalMessage] = useState('');

    const [editForm, setEditForm] = useState({
        lastName: '',
        firstName: '',
        middleName: '',
        email: '',
        phone: '',
        emailCode: '',
        actorPassword: '',
    });

    const [emailCodeRequested, setEmailCodeRequested] = useState(false);
    const [emailCodeForEmail, setEmailCodeForEmail] = useState('');
    const [emailCooldownUntil, setEmailCooldownUntil] = useState(0);
    const [nowTs, setNowTs] = useState(Date.now());

    const [phoneVerificationSessionId, setPhoneVerificationSessionId] = useState('');
    const [phoneVerified, setPhoneVerified] = useState(false);
    const [phoneVerifiedForPhone, setPhoneVerifiedForPhone] = useState('');
    const [telegramBotUrl, setTelegramBotUrl] = useState('');
    const [isPhoneModalOpen, setIsPhoneModalOpen] = useState(false);

    const phonePollingRef = useRef<number | null>(null);

    const normalizedEditEmail = useMemo(() => normalizeEmail(editForm.email), [editForm.email]);
    const normalizedEditPhone = useMemo(() => normalizePhone(editForm.phone), [editForm.phone]);

    const cooldownLeftMs = Math.max(0, emailCooldownUntil - nowTs);
    const cooldownActive = cooldownLeftMs > 0;

    useEffect(() => {
        const timer = window.setInterval(() => setNowTs(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        void loadDoctors();

        return () => {
            if (phonePollingRef.current) {
                window.clearInterval(phonePollingRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!editingDoctor) return;
        if (!emailCodeForEmail) return;
        if (normalizedEditEmail !== emailCodeForEmail) {
            setEmailCodeRequested(false);
            setEditForm((prev) => ({ ...prev, emailCode: '' }));
            setEmailCooldownUntil(0);
        }
    }, [editingDoctor, normalizedEditEmail, emailCodeForEmail]);

    useEffect(() => {
        if (!editingDoctor) return;
        if (!phoneVerifiedForPhone) return;

        if (normalizedEditPhone !== phoneVerifiedForPhone) {
            setPhoneVerified(false);
            setPhoneVerificationSessionId('');
            setTelegramBotUrl('');
            setIsPhoneModalOpen(false);
        }
    }, [editingDoctor, normalizedEditPhone, phoneVerifiedForPhone]);

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

    function openEditModal(doctor: DoctorItem) {
        const key = `${EMAIL_COOLDOWN_KEY}:${doctor.id}`;
        let until = 0;
        let storedEmail = '';
        try {
            const raw = window.localStorage.getItem(key);
            if (raw) {
                const parsed = JSON.parse(raw) as { email: string; until: number };
                until = parsed?.until || 0;
                storedEmail = normalizeEmail(parsed?.email || '');
            }
        } catch {}

        const currentEmail = normalizeEmail(doctor.email);

        setEditingDoctor(doctor);
        setEditForm({
            lastName: doctor.lastName,
            firstName: doctor.firstName,
            middleName: doctor.middleName || '',
            email: doctor.email,
            phone: doctor.phone,
            emailCode: '',
            actorPassword: '',
        });

        setEmailCodeRequested(storedEmail === currentEmail && until > Date.now());
        setEmailCodeForEmail(storedEmail === currentEmail ? currentEmail : '');
        setEmailCooldownUntil(storedEmail === currentEmail ? until : 0);

        setPhoneVerificationSessionId('');
        setPhoneVerified(false);
        setPhoneVerifiedForPhone('');
        setTelegramBotUrl('');
        setIsPhoneModalOpen(false);

        setModalError('');
        setModalMessage('');
    }

    function closeEditModal() {
        setEditingDoctor(null);

        if (phonePollingRef.current) {
            window.clearInterval(phonePollingRef.current);
            phonePollingRef.current = null;
        }
    }

    async function handleRequestEmailCodeForEdit() {
        if (!token || !editingDoctor) return;
        if (!normalizedEditEmail) return setModalError('Вкажи email');
        if (cooldownActive) return;

        const emailChanged = normalizedEditEmail !== normalizeEmail(editingDoctor.email);

        if (!emailChanged) {
            setModalMessage('Email не змінено, код не потрібен');
            setModalError('');
            return;
        }

        setEmailCodeLoading(true);
        setModalMessage('');
        setModalError('');

        try {
            const result = await requestDoctorEmailVerification(token, normalizedEditEmail);
            const until = Date.now() + EMAIL_COOLDOWN_MS;
            const key = `${EMAIL_COOLDOWN_KEY}:${editingDoctor.id}`;

            setEmailCodeRequested(true);
            setEmailCodeForEmail(normalizedEditEmail);
            setEmailCooldownUntil(until);

            window.localStorage.setItem(key, JSON.stringify({ email: normalizedEditEmail, until }));

            setModalMessage(result.message);
        } catch (err) {
            setModalError(err instanceof Error ? err.message : 'Не вдалося надіслати код підтвердження');
        } finally {
            setEmailCodeLoading(false);
        }
    }

    async function handleStartPhoneVerificationForEdit() {
        if (!editingDoctor) return;
        if (!normalizedEditPhone) return setModalError('Вкажи телефон');

        const phoneChanged = normalizedEditPhone !== normalizePhone(editingDoctor.phone);

        if (!phoneChanged) {
            setModalMessage('Телефон не змінено, підтвердження не потрібне');
            setModalError('');
            return;
        }

        setPhoneVerifyLoading(true);
        setModalMessage('');
        setModalError('');

        try {
            const result = await startPhoneVerification(normalizedEditPhone);
            setPhoneVerificationSessionId(result.sessionId);
            setPhoneVerified(false);
            setTelegramBotUrl(result.telegramBotUrl);
            setIsPhoneModalOpen(true);

            if (phonePollingRef.current) {
                window.clearInterval(phonePollingRef.current);
            }

            phonePollingRef.current = window.setInterval(async () => {
                try {
                    const status = await getPhoneVerificationStatus(result.sessionId);

                    if (status.status === 'VERIFIED') {
                        if (phonePollingRef.current) {
                            window.clearInterval(phonePollingRef.current);
                            phonePollingRef.current = null;
                        }

                        setPhoneVerified(true);
                        setPhoneVerifiedForPhone(normalizedEditPhone);
                        setTelegramBotUrl('');
                        setIsPhoneModalOpen(false);
                        setModalMessage('Телефон підтверджено');
                    }

                    if (status.status === 'FAILED' || status.status === 'EXPIRED') {
                        if (phonePollingRef.current) {
                            window.clearInterval(phonePollingRef.current);
                            phonePollingRef.current = null;
                        }

                        setPhoneVerified(false);
                        setModalError('Підтвердження телефону не завершено');
                    }
                } catch (pollErr) {
                    if (phonePollingRef.current) {
                        window.clearInterval(phonePollingRef.current);
                        phonePollingRef.current = null;
                    }

                    setPhoneVerified(false);
                    setModalError(pollErr instanceof Error ? pollErr.message : 'Помилка перевірки статусу телефону');
                }
            }, 2000);
        } catch (err) {
            setModalError(err instanceof Error ? err.message : 'Не вдалося запустити підтвердження телефону');
        } finally {
            setPhoneVerifyLoading(false);
        }
    }

    async function handleSaveDoctorEdit(e: React.FormEvent) {
        e.preventDefault();
        if (!token || !editingDoctor) return;

        const nextLastName = editForm.lastName.trim();
        const nextFirstName = editForm.firstName.trim();
        const nextMiddleName = editForm.middleName.trim();
        const nextEmail = normalizedEditEmail;
        const nextPhone = normalizedEditPhone;

        const nameChanged =
            nextLastName !== editingDoctor.lastName ||
            nextFirstName !== editingDoctor.firstName ||
            nextMiddleName !== (editingDoctor.middleName || '');

        const emailChanged = nextEmail !== normalizeEmail(editingDoctor.email);
        const phoneChanged = nextPhone !== normalizePhone(editingDoctor.phone);

        if (!nameChanged && !emailChanged && !phoneChanged) {
            setModalError('Немає змін для збереження');
            return;
        }

        if (emailChanged && (!emailCodeRequested || !editForm.emailCode.trim())) {
            setModalError('Для зміни пошти потрібно надіслати і ввести код підтвердження');
            return;
        }

        if (phoneChanged && (!phoneVerificationSessionId || !phoneVerified)) {
            setModalError('Для зміни телефону потрібно пройти підтвердження');
            return;
        }

        if (!editForm.actorPassword.trim()) {
            setModalError('Введи свій пароль для підтвердження');
            return;
        }

        const payload: {
            lastName?: string;
            firstName?: string;
            middleName?: string;
            email?: string;
            phone?: string;
            emailCode?: string;
            phoneVerificationSessionId?: string;
            actorPassword: string;
        } = {
            actorPassword: editForm.actorPassword.trim(),
        };

        if (nameChanged) {
            payload.lastName = nextLastName;
            payload.firstName = nextFirstName;
            payload.middleName = nextMiddleName || undefined;
        }

        if (emailChanged) {
            payload.email = nextEmail;
            payload.emailCode = editForm.emailCode.trim();
        }

        if (phoneChanged) {
            payload.phone = nextPhone;
            payload.phoneVerificationSessionId = phoneVerificationSessionId;
        }

        setEditLoading(true);
        setModalMessage('');
        setModalError('');

        try {
            const result = await updateDoctor(token, editingDoctor.id, payload);

            setDoctors((prev) => prev.map((item) => (item.id === editingDoctor.id ? result.doctor : item)));

            setMessage(result.message);
            closeEditModal();
        } catch (err) {
            const raw = err instanceof Error ? err.message : 'Не вдалося оновити лікаря';
            setModalError(raw || 'Не вдалося оновити лікаря');
        } finally {
            setEditLoading(false);
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
                        <p className="doctor-list-page__subtitle">Перегляд, активація, редагування та профілі лікарів.</p>

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
                                                onClick={() => openEditModal(doctor)}
                                            >
                                                РЕДАГУВАТИ
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

            {editingDoctor && (
                <div className="doctor-list-page__modal-backdrop">
                    <form className="doctor-list-page__modal" onSubmit={handleSaveDoctorEdit}>
                        <h2>Редагування лікаря</h2>

                        {modalError && <AlertToast message={modalError} variant="error" onClose={() => setModalError('')} />}
                        {modalMessage && (
                            <AlertToast message={modalMessage} variant="success" onClose={() => setModalMessage('')} />
                        )}

                        <input
                            value={editForm.lastName}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, lastName: e.target.value }))}
                            placeholder="Прізвище"
                        />
                        <input
                            value={editForm.firstName}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, firstName: e.target.value }))}
                            placeholder="Ім'я"
                        />
                        <input
                            value={editForm.middleName}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, middleName: e.target.value }))}
                            placeholder="По батькові"
                        />
                        <input
                            value={editForm.email}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                            placeholder="Email"
                        />
                        <input
                            value={editForm.phone}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, phone: e.target.value }))}
                            placeholder="Телефон"
                        />

                        <div className="doctor-list-page__verify-row">
                            <button
                                type="button"
                                onClick={handleRequestEmailCodeForEdit}
                                disabled={emailCodeLoading || cooldownActive}
                                title={emailCodeRequested ? 'Надіслати код' : undefined}
                            >
                                {emailCodeLoading
                                    ? 'НАДСИЛАННЯ...'
                                    : cooldownActive
                                        ? `НАДІСЛАНО ${formatCooldown(cooldownLeftMs)}`
                                        : emailCodeRequested
                                            ? 'НАДІСЛАТИ КОД'
                                            : 'НАДІСЛАТИ КОД НА ПОШТУ'}
                            </button>

                            <button
                                type="button"
                                onClick={handleStartPhoneVerificationForEdit}
                                disabled={
                                    phoneVerifyLoading ||
                                    !normalizedEditPhone ||
                                    (phoneVerified && normalizedEditPhone === phoneVerifiedForPhone)
                                }
                            >
                                {phoneVerifyLoading
                                    ? 'ПІДГОТОВКА...'
                                    : phoneVerified && normalizedEditPhone === phoneVerifiedForPhone
                                        ? 'ТЕЛЕФОН ПІДТВЕРДЖЕНО'
                                        : 'ПІДТВЕРДИТИ ТЕЛЕФОН'}
                            </button>
                        </div>

                        <input
                            value={editForm.emailCode}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, emailCode: e.target.value }))}
                            placeholder="Код підтвердження email"
                        />

                        <input
                            type="password"
                            value={editForm.actorPassword}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, actorPassword: e.target.value }))}
                            placeholder="Твій пароль для підтвердження"
                        />

                        <div className="doctor-list-page__verify-status">
                            <span className={emailCodeRequested ? 'ok' : 'pending'}>
                                Email: {emailCodeRequested ? 'код надіслано' : 'код не надіслано'}
                            </span>
                            <span className={phoneVerified ? 'ok' : 'pending'}>
                                Телефон: {phoneVerified ? 'підтверджено' : 'не підтверджено'}
                            </span>
                        </div>

                        <div className="doctor-list-page__modal-actions">
                            <button type="button" onClick={closeEditModal}>
                                СКАСУВАТИ
                            </button>
                            <button type="submit" disabled={editLoading}>
                                {editLoading ? 'ЗБЕРЕЖЕННЯ...' : 'ЗБЕРЕГТИ'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {isPhoneModalOpen && telegramBotUrl && (
                <div className="doctor-list-page__phone-modal-backdrop">
                    <div className="doctor-list-page__phone-modal">
                        <h2>ПІДТВЕРДЖЕННЯ ТЕЛЕФОНУ</h2>
                        <TelegramQrCard
                            telegramBotUrl={telegramBotUrl}
                            title="QR ДЛЯ ПІДТВЕРДЖЕННЯ НОВОГО ТЕЛЕФОНУ"
                            subtitle="Скануй код через Telegram або натисни кнопку переходу."
                        />
                        <button type="button" onClick={() => setIsPhoneModalOpen(false)}>
                            ЗГОРНУТИ
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
