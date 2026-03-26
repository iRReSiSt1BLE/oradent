import { useEffect, useMemo, useRef, useState } from 'react';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    getAllAdmins,
    requestAdminEmailVerification,
    toggleAdminActive,
    updateAdmin,
} from '../../shared/api/adminApi';
import {
    getPhoneVerificationStatus,
    startPhoneVerification,
} from '../../shared/api/phoneVerificationApi';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
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
    const [phoneVerificationSessionId, setPhoneVerificationSessionId] = useState('');
    const [phoneVerified, setPhoneVerified] = useState(false);
    const [telegramBotUrl, setTelegramBotUrl] = useState('');

    const phonePollingRef = useRef<number | null>(null);

    const isAllowed = role === 'SUPER_ADMIN';

    useEffect(() => {
        void loadAdmins();

        return () => {
            if (phonePollingRef.current) {
                window.clearInterval(phonePollingRef.current);
            }
        };
    }, []);

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
        setEmailCodeRequested(false);
        setPhoneVerificationSessionId('');
        setPhoneVerified(false);
        setTelegramBotUrl('');
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

        const nextEmail = editForm.email.trim().toLowerCase();
        const emailChanged = nextEmail !== editingAdmin.email.toLowerCase();

        if (!emailChanged) {
            setModalMessage('Email не змінено, код не потрібен');
            setModalError('');
            return;
        }

        setEmailCodeLoading(true);
        setModalMessage('');
        setModalError('');

        try {
            const result = await requestAdminEmailVerification(token, nextEmail);
            setEmailCodeRequested(true);
            setModalMessage(result.message);
        } catch (err) {
            setModalError(err instanceof Error ? err.message : 'Не вдалося надіслати код підтвердження');
        } finally {
            setEmailCodeLoading(false);
        }
    }

    async function handleStartPhoneVerificationForEdit() {
        if (!editingAdmin) return;

        const nextPhone = editForm.phone.trim();
        const phoneChanged = nextPhone !== editingAdmin.phone;

        if (!phoneChanged) {
            setModalMessage('Телефон не змінено, підтвердження не потрібне');
            setModalError('');
            return;
        }

        setPhoneVerifyLoading(true);
        setModalMessage('');
        setModalError('');

        try {
            const result = await startPhoneVerification(nextPhone);
            setPhoneVerificationSessionId(result.sessionId);
            setPhoneVerified(false);
            setTelegramBotUrl(result.telegramBotUrl);

            window.open(result.telegramBotUrl, '_blank', 'noopener,noreferrer');

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
        const nextEmail = editForm.email.trim().toLowerCase();
        const nextPhone = editForm.phone.trim();

        const nameChanged =
            nextLastName !== editingAdmin.lastName ||
            nextFirstName !== editingAdmin.firstName ||
            nextMiddleName !== (editingAdmin.middleName || '');

        const emailChanged = nextEmail !== editingAdmin.email.toLowerCase();
        const phoneChanged = nextPhone !== editingAdmin.phone;

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
        } = {};

        if (nameChanged) {
            payload.lastName = nextLastName;
            payload.firstName = nextFirstName;
            payload.middleName = nextMiddleName || undefined;
        }

        if (emailChanged) {
            payload.email = nextEmail;
        }

        if (phoneChanged) {
            payload.phone = nextPhone;
        }

        setEditLoading(true);
        setModalMessage('');
        setModalError('');

        try {
            const result = await updateAdmin(token, editingAdmin.id, payload);

            setAdmins((prev) =>
                prev.map((item) => (item.id === editingAdmin.id ? result.admin : item)),
            );

            setMessage(result.message);
            closeEditModal();
        } catch (err) {
            const raw = err instanceof Error ? err.message : 'Не вдалося оновити адміністратора';

            if (raw.includes('property superAdminPassword should not exist') || raw.includes('property emailCode should not exist')) {
                setModalError('Бекенд не приймає додаткові поля підтвердження. Онови DTO бекенда для secure update.');
                return;
            }

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
                            <div className="admin-list-page__blocked">
                                Доступно лише для SUPER_ADMIN.
                            </div>
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
                                                    className={`admin-list-page__status-dot ${admin.isActive ? 'is-active' : 'is-inactive'}`}
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
                        {modalMessage && <AlertToast message={modalMessage} variant="success" onClose={() => setModalMessage('')} />}

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
                            onChange={(e) => {
                                setEditForm((prev) => ({ ...prev, email: e.target.value, emailCode: '' }));
                                setEmailCodeRequested(false);
                            }}
                            placeholder="Email"
                        />
                        <input
                            value={editForm.phone}
                            onChange={(e) => {
                                setEditForm((prev) => ({ ...prev, phone: e.target.value }));
                                setPhoneVerificationSessionId('');
                                setPhoneVerified(false);
                                setTelegramBotUrl('');
                            }}
                            placeholder="Телефон"
                        />

                        <div className="admin-list-page__verify-row">
                            <button type="button" onClick={handleRequestEmailCodeForEdit} disabled={emailCodeLoading}>
                                {emailCodeLoading ? 'НАДСИЛАННЯ...' : 'НАДІСЛАТИ КОД НА ПОШТУ'}
                            </button>
                            <button type="button" onClick={handleStartPhoneVerificationForEdit} disabled={phoneVerifyLoading}>
                                {phoneVerifyLoading ? 'ПІДГОТОВКА...' : 'ПІДТВЕРДИТИ ТЕЛЕФОН'}
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
                            {telegramBotUrl && (
                                <a href={telegramBotUrl} target="_blank" rel="noreferrer">
                                    ВІДКРИТИ TELEGRAM
                                </a>
                            )}
                        </div>

                        <div className="admin-list-page__modal-actions">
                            <button type="button" onClick={closeEditModal}>Скасувати</button>
                            <button type="submit" disabled={editLoading}>
                                {editLoading ? 'Збереження...' : 'Зберегти'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}
