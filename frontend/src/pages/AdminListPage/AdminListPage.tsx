import { useEffect, useMemo, useRef, useState } from 'react';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import { getAllAdmins, requestAdminEmailVerification, toggleAdminActive, updateAdmin } from '../../shared/api/adminApi';
import { getPhoneVerificationStatus, startPhoneVerification } from '../../shared/api/phoneVerificationApi';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import TelegramQrCard from '../../shared/ui/TelegramQrCard/TelegramQrCard';
import './AdminListPage.scss';

type AdminItem = {
    id: string;
    userId: string;
    email: string;
    lastName: string;
    firstName: string;
    middleName: string | null;
    phone: string;
    isActive: boolean;
    role: string;
};

const EMAIL_COOLDOWN_MS = 3 * 60 * 1000;
const EMAIL_COOLDOWN_KEY = 'adminEdit.emailCooldown.v1';

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

export default function AdminListPage() {
    const token = getToken();
    const role = getUserRole();

    const [admins, setAdmins] = useState<AdminItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const [search, setSearch] = useState('');
    const [togglingId, setTogglingId] = useState<string | null>(null);

    const [editingAdmin, setEditingAdmin] = useState<AdminItem | null>(null);
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
        superAdminPassword: '',
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

    const isAllowed = role === 'SUPER_ADMIN';

    const normalizedEditEmail = useMemo(() => normalizeEmail(editForm.email), [editForm.email]);
    const normalizedEditPhone = useMemo(() => normalizePhone(editForm.phone), [editForm.phone]);

    const cooldownLeftMs = Math.max(0, emailCooldownUntil - nowTs);
    const cooldownActive = cooldownLeftMs > 0;

    useEffect(() => {
        const timer = window.setInterval(() => setNowTs(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        void loadAdmins();

        return () => {
            if (phonePollingRef.current) {
                window.clearInterval(phonePollingRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!editingAdmin) return;
        if (!emailCodeForEmail) return;
        if (normalizedEditEmail !== emailCodeForEmail) {
            setEmailCodeRequested(false);
            setEditForm((prev) => ({ ...prev, emailCode: '' }));
            setEmailCooldownUntil(0);
        }
    }, [editingAdmin, normalizedEditEmail, emailCodeForEmail]);

    useEffect(() => {
        if (!editingAdmin) return;
        if (!phoneVerifiedForPhone) return;

        if (normalizedEditPhone !== phoneVerifiedForPhone) {
            setPhoneVerified(false);
            setPhoneVerificationSessionId('');
            setTelegramBotUrl('');
            setIsPhoneModalOpen(false);
        }
    }, [editingAdmin, normalizedEditPhone, phoneVerifiedForPhone]);

    async function loadAdmins() {
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
            const result = await getAllAdmins(token);
            setAdmins(result.admins);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося завантажити адміністраторів');
        } finally {
            setLoading(false);
        }
    }

    const filteredAdmins = useMemo(() => {
        const q = search.trim().toLowerCase();
        const withoutSuperAdmin = admins.filter((admin) => admin.role !== 'SUPER_ADMIN');

        if (!q) return withoutSuperAdmin;

        return withoutSuperAdmin.filter((admin) => {
            const fullName = `${admin.lastName} ${admin.firstName} ${admin.middleName || ''}`.toLowerCase();
            return fullName.includes(q);
        });
    }, [admins, search]);

    async function handleToggleAdmin(adminId: string) {
        if (!token) return;

        setMessage('');
        setError('');
        setTogglingId(adminId);

        try {
            const result = await toggleAdminActive(token, adminId);

            setAdmins((prev) =>
                prev.map((item) => (item.id === adminId ? { ...item, isActive: result.isActive } : item)),
            );

            setMessage(result.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося змінити статус адміністратора');
        } finally {
            setTogglingId(null);
        }
    }

    function openEditModal(admin: AdminItem) {
        const key = `${EMAIL_COOLDOWN_KEY}:${admin.id}`;
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

        const currentEmail = normalizeEmail(admin.email);

        setEditingAdmin(admin);
        setEditForm({
            lastName: admin.lastName,
            firstName: admin.firstName,
            middleName: admin.middleName || '',
            email: admin.email,
            phone: admin.phone,
            emailCode: '',
            superAdminPassword: '',
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
        setEditingAdmin(null);

        if (phonePollingRef.current) {
            window.clearInterval(phonePollingRef.current);
            phonePollingRef.current = null;
        }
    }

    async function handleRequestEmailCodeForEdit() {
        if (!token || !editingAdmin) return;
        if (!normalizedEditEmail) return setModalError('Вкажи email');
        if (cooldownActive) return;

        const emailChanged = normalizedEditEmail !== normalizeEmail(editingAdmin.email);

        if (!emailChanged) {
            setModalMessage('Email не змінено, код не потрібен');
            setModalError('');
            return;
        }

        setEmailCodeLoading(true);
        setModalMessage('');
        setModalError('');

        try {
            const result = await requestAdminEmailVerification(token, normalizedEditEmail);
            const until = Date.now() + EMAIL_COOLDOWN_MS;
            const key = `${EMAIL_COOLDOWN_KEY}:${editingAdmin.id}`;

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
        if (!editingAdmin) return;
        if (!normalizedEditPhone) return setModalError('Вкажи телефон');

        const phoneChanged = normalizedEditPhone !== normalizePhone(editingAdmin.phone);

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

    async function handleSaveAdminEdit(e: React.FormEvent) {
        e.preventDefault();
        if (!token || !editingAdmin) return;

        const nextLastName = editForm.lastName.trim();
        const nextFirstName = editForm.firstName.trim();
        const nextMiddleName = editForm.middleName.trim();
        const nextEmail = normalizedEditEmail;
        const nextPhone = normalizedEditPhone;

        const nameChanged =
            nextLastName !== editingAdmin.lastName ||
            nextFirstName !== editingAdmin.firstName ||
            nextMiddleName !== (editingAdmin.middleName || '');

        const emailChanged = nextEmail !== normalizeEmail(editingAdmin.email);
        const phoneChanged = nextPhone !== normalizePhone(editingAdmin.phone);

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

        if (!editForm.superAdminPassword.trim()) {
            setModalError('Введи свій пароль SUPER_ADMIN для підтвердження');
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
            superAdminPassword: string;
        } = {
            superAdminPassword: editForm.superAdminPassword.trim(),
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
            const result = await updateAdmin(token, editingAdmin.id, payload);

            setAdmins((prev) => prev.map((item) => (item.id === editingAdmin.id ? result.admin : item)));

            setMessage(result.message);
            closeEditModal();
        } catch (err) {
            const raw = err instanceof Error ? err.message : 'Не вдалося оновити адміністратора';
            setModalError(raw || 'Не вдалося оновити адміністратора');
        } finally {
            setEditLoading(false);
        }
    }

    return (
        <div className="page-shell admin-list-page">
            <div className="container admin-list-page__container">
                <div className="admin-list-page__content">
                    {error && (
                        <div className="admin-list-page__top-alert">
                            <AlertToast message={error} variant="error" onClose={() => setError('')} />
                        </div>
                    )}
                    {message && (
                        <div className="admin-list-page__top-alert">
                            <AlertToast message={message} variant="success" onClose={() => setMessage('')} />
                        </div>
                    )}

                    <section className="admin-list-page__card">
                        <h1 className="admin-list-page__title">АДМІНІСТРАТОРИ</h1>
                        <p className="admin-list-page__subtitle">Перегляд, активація та деактивація адміністраторів.</p>

                        {isAllowed && (
                            <div className="admin-list-page__search-wrap">
                                <input
                                    className="admin-list-page__search"
                                    placeholder="Пошук по ПІБ..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>
                        )}

                        {!isAllowed ? (
                            <div className="admin-list-page__blocked">Доступно лише для SUPER_ADMIN.</div>
                        ) : loading ? (
                            <div className="admin-list-page__loading">Завантаження...</div>
                        ) : (
                            <div className="admin-list-page__list">
                                {filteredAdmins.map((admin) => (
                                    <article key={admin.id} className="admin-list-page__item">
                                        <div className="admin-list-page__meta">
                                            <h3>
                                                {admin.lastName} {admin.firstName} {admin.middleName || ''}
                                                <span
                                                    className={`admin-list-page__status-dot ${
                                                        admin.isActive ? 'is-active' : 'is-inactive'
                                                    }`}
                                                    aria-label={admin.isActive ? 'Активний' : 'Неактивний'}
                                                    title={admin.isActive ? 'Активний' : 'Неактивний'}
                                                />
                                            </h3>
                                            <p>{admin.email}</p>
                                            <p>{admin.phone}</p>
                                        </div>

                                        <div className="admin-list-page__actions">
                                            <button
                                                type="button"
                                                className="admin-list-page__action-btn"
                                                onClick={() => handleToggleAdmin(admin.id)}
                                                disabled={togglingId === admin.id}
                                            >
                                                {togglingId === admin.id
                                                    ? 'ОБРОБКА...'
                                                    : admin.isActive
                                                        ? 'ДЕАКТИВУВАТИ'
                                                        : 'АКТИВУВАТИ'}
                                            </button>

                                            <button
                                                type="button"
                                                className="admin-list-page__action-btn"
                                                onClick={() => openEditModal(admin)}
                                            >
                                                РЕДАГУВАТИ
                                            </button>
                                        </div>
                                    </article>
                                ))}

                                {!filteredAdmins.length && (
                                    <div className="admin-list-page__empty">Нічого не знайдено за ПІБ.</div>
                                )}
                            </div>
                        )}
                    </section>
                </div>
            </div>

            {editingAdmin && (
                <div className="admin-list-page__modal-backdrop">
                    <form className="admin-list-page__modal" onSubmit={handleSaveAdminEdit}>
                        <h2>Редагування адміністратора</h2>

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

                        <div className="admin-list-page__verify-row">
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
                            value={editForm.superAdminPassword}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, superAdminPassword: e.target.value }))}
                            placeholder="Твій пароль SUPER_ADMIN"
                        />

                        <div className="admin-list-page__verify-status">
                            <span className={emailCodeRequested ? 'ok' : 'pending'}>
                                Email: {emailCodeRequested ? 'код надіслано' : 'код не надіслано'}
                            </span>
                            <span className={phoneVerified ? 'ok' : 'pending'}>
                                Телефон: {phoneVerified ? 'підтверджено' : 'не підтверджено'}
                            </span>
                        </div>

                        <div className="admin-list-page__modal-actions">
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
                <div className="admin-list-page__phone-modal-backdrop">
                    <div className="admin-list-page__phone-modal">
                        <h2>ПІДТВЕРДЖЕННЯ ТЕЛЕФОНУ</h2>
                        <TelegramQrCard
                            telegramBotUrl={telegramBotUrl}
                            title="QR ДЛЯ ПІДТВЕРДЖЕННЯ НОВОГО ТЕЛЕФОНУ"
                            subtitle="Скануй код через Telegram або натисни кнопку переходу. Вікно закриється після підтвердження."
                        />
                        <div className="admin-list-page__phone-modal-loader">
                            <div className="admin-list-page__spinner" />
                            <span>Очікуємо підтвердження...</span>
                        </div>
                        <button type="button" onClick={() => setIsPhoneModalOpen(false)}>
                            ЗГОРНУТИ
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
