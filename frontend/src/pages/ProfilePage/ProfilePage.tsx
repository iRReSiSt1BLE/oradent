import { useEffect, useMemo, useRef, useState } from 'react';
import { getToken, removeToken } from '../../shared/utils/authStorage';
import { getPhoneVerificationStatus } from '../../shared/api/phoneVerificationApi';
import {
    changeMyPassword,
    confirmEmailChange,
    confirmPhoneChange,
    getMyProfile,
    requestEmailChange,
    startPhoneChange,
    updateProfile,
} from '../../shared/api/profileApi';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import TelegramQrCard from '../../shared/ui/TelegramQrCard/TelegramQrCard';
import './ProfilePage.scss';

type Profile = {
    userId: string;
    email: string;
    authProvider: string;
    role: string;
    patientId: string | null;
    lastName: string;
    firstName: string;
    middleName: string | null;
    phone: string | null;
    phoneVerified: boolean;
};

type ModalType = 'none' | 'name' | 'email' | 'phone' | 'password';

const EMAIL_COOLDOWN_MS = 3 * 60 * 1000;

function normalizeEmail(value: string) {
    return value.trim().toLowerCase();
}

function formatCooldown(ms: number) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function ProfilePage() {
    const token = getToken();

    const [profile, setProfile] = useState<Profile | null>(null);
    const [loadingProfile, setLoadingProfile] = useState(true);

    const [pageMessage, setPageMessage] = useState('');
    const [pageError, setPageError] = useState('');

    const [modalType, setModalType] = useState<ModalType>('none');
    const [modalMessage, setModalMessage] = useState('');
    const [modalError, setModalError] = useState('');

    const [nameLoading, setNameLoading] = useState(false);
    const [emailLoading, setEmailLoading] = useState(false);
    const [phoneLoading, setPhoneLoading] = useState(false);
    const [passwordLoading, setPasswordLoading] = useState(false);

    const [nameForm, setNameForm] = useState({
        lastName: '',
        firstName: '',
        middleName: '',
        password: '',
    });

    const [emailStep, setEmailStep] = useState<'request' | 'confirm'>('request');
    const [emailForm, setEmailForm] = useState({
        newEmail: '',
        password: '',
        code: '',
    });

    const [emailCooldownUntil, setEmailCooldownUntil] = useState(0);
    const [emailCodeForEmail, setEmailCodeForEmail] = useState('');
    const [nowTs, setNowTs] = useState(Date.now());

    const [phoneForm, setPhoneForm] = useState({
        phone: '',
        password: '',
    });

    const [passwordForm, setPasswordForm] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
    });

    const [telegramBotUrl, setTelegramBotUrl] = useState('');
    const [waitingTelegram, setWaitingTelegram] = useState(false);

    const pollingRef = useRef<number | null>(null);

    const isAdminProfile = profile?.role === 'ADMIN' || profile?.role === 'SUPER_ADMIN';
    const canEditData = profile?.role !== 'ADMIN';
    const canChangePassword = profile?.role === 'ADMIN' || profile?.role === 'SUPER_ADMIN';

    const normalizedNewEmail = useMemo(() => normalizeEmail(emailForm.newEmail), [emailForm.newEmail]);
    const cooldownLeftMs = Math.max(0, emailCooldownUntil - nowTs);
    const cooldownActive = cooldownLeftMs > 0;
    const cooldownKey = profile ? `profile.emailCooldown.v1:${profile.userId}` : 'profile.emailCooldown.v1:anon';

    useEffect(() => {
        const timer = window.setInterval(() => setNowTs(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        void loadProfile();

        return () => {
            if (pollingRef.current) {
                window.clearInterval(pollingRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!emailCodeForEmail) return;
        if (normalizedNewEmail !== emailCodeForEmail) {
            setEmailStep('request');
            setEmailForm((prev) => ({ ...prev, code: '' }));
            setEmailCooldownUntil(0);
            setEmailCodeForEmail('');
        }
    }, [normalizedNewEmail, emailCodeForEmail]);

    async function loadProfile() {
        if (!token) {
            setPageError('Спочатку увійди в систему');
            setLoadingProfile(false);
            return;
        }

        try {
            const result = await getMyProfile(token);
            setProfile(result.profile);
            setNameForm({
                lastName: result.profile.lastName,
                firstName: result.profile.firstName,
                middleName: result.profile.middleName || '',
                password: '',
            });
        } catch (err) {
            setPageError(err instanceof Error ? err.message : 'Не вдалося завантажити профіль');
        } finally {
            setLoadingProfile(false);
        }
    }

    function clearModalState() {
        setModalError('');
        setModalMessage('');
    }

    function readCooldownForEmail(email: string) {
        try {
            const raw = window.localStorage.getItem(cooldownKey);
            if (!raw) return 0;
            const parsed = JSON.parse(raw) as { email: string; until: number };
            if (normalizeEmail(parsed.email) === normalizeEmail(email) && parsed.until > Date.now()) {
                return parsed.until;
            }
            return 0;
        } catch {
            return 0;
        }
    }

    function openModal(type: ModalType) {
        clearModalState();
        setModalType(type);

        if (type === 'name') {
            if (!canEditData || !profile) return;
            setNameForm({
                lastName: profile.lastName,
                firstName: profile.firstName,
                middleName: profile.middleName || '',
                password: '',
            });
        }

        if (type === 'email') {
            if (!canEditData) return;
            setEmailStep('request');
            setEmailForm({ newEmail: '', password: '', code: '' });
            setEmailCooldownUntil(0);
            setEmailCodeForEmail('');
        }

        if (type === 'phone') {
            if (!canEditData) return;
            setPhoneForm({
                phone: profile?.phone || '',
                password: '',
            });
            setTelegramBotUrl('');
            setWaitingTelegram(false);
        }

        if (type === 'password') {
            if (!canChangePassword) return;
            setPasswordForm({
                currentPassword: '',
                newPassword: '',
                confirmPassword: '',
            });
        }
    }

    function closeModal() {
        setModalType('none');
        clearModalState();
        setEmailStep('request');
        setWaitingTelegram(false);

        if (pollingRef.current) {
            window.clearInterval(pollingRef.current);
            pollingRef.current = null;
        }
    }

    async function handleSaveName(e: React.FormEvent) {
        e.preventDefault();

        if (!token || !canEditData) return;

        setNameLoading(true);
        clearModalState();

        try {
            const result = await updateProfile(token, {
                lastName: nameForm.lastName,
                firstName: nameForm.firstName,
                middleName: nameForm.middleName || undefined,
                password: nameForm.password,
            });

            setProfile((prev) =>
                prev
                    ? {
                        ...prev,
                        lastName: result.profile.lastName,
                        firstName: result.profile.firstName,
                        middleName: result.profile.middleName,
                    }
                    : prev,
            );

            setPageMessage(result.message);
            closeModal();
        } catch (err) {
            setModalError(err instanceof Error ? err.message : 'Не вдалося оновити ПІБ');
        } finally {
            setNameLoading(false);
        }
    }

    async function handleRequestEmailChange() {
        if (!token || !canEditData) return;
        if (cooldownActive) return;

        setEmailLoading(true);
        clearModalState();

        try {
            const result = await requestEmailChange(token, {
                newEmail: emailForm.newEmail,
                password: emailForm.password,
            });

            const until = Date.now() + EMAIL_COOLDOWN_MS;
            setEmailStep('confirm');
            setEmailCodeForEmail(normalizedNewEmail);
            setEmailCooldownUntil(until);

            window.localStorage.setItem(
                cooldownKey,
                JSON.stringify({ email: normalizedNewEmail, until }),
            );

            setModalMessage(result.message);
        } catch (err) {
            setModalError(err instanceof Error ? err.message : 'Не вдалося надіслати код');
        } finally {
            setEmailLoading(false);
        }
    }

    async function handleConfirmEmailChange() {
        if (!token || !canEditData) return;

        setEmailLoading(true);
        clearModalState();

        try {
            const result = await confirmEmailChange(token, {
                newEmail: emailForm.newEmail,
                code: emailForm.code,
            });

            setProfile((prev) => (prev ? { ...prev, email: result.email } : prev));

            window.localStorage.removeItem(cooldownKey);
            setEmailCooldownUntil(0);
            setEmailCodeForEmail('');

            setPageMessage(result.message);
            closeModal();
        } catch (err) {
            setModalError(err instanceof Error ? err.message : 'Не вдалося змінити пошту');
        } finally {
            setEmailLoading(false);
        }
    }

    async function handleStartPhoneChange() {
        if (!token || !canEditData) return;

        setPhoneLoading(true);
        clearModalState();

        try {
            const result = await startPhoneChange(token, {
                phone: phoneForm.phone,
                password: phoneForm.password,
            });

            setTelegramBotUrl(result.telegramBotUrl);
            setWaitingTelegram(true);

            if (pollingRef.current) {
                window.clearInterval(pollingRef.current);
            }

            pollingRef.current = window.setInterval(async () => {
                try {
                    const status = await getPhoneVerificationStatus(result.sessionId);

                    if (status.status === 'VERIFIED') {
                        if (pollingRef.current) {
                            window.clearInterval(pollingRef.current);
                            pollingRef.current = null;
                        }

                        const confirmResult = await confirmPhoneChange(token, {
                            phoneVerificationSessionId: result.sessionId,
                            phone: phoneForm.phone,
                        });

                        setProfile((prev) =>
                            prev
                                ? {
                                    ...prev,
                                    phone: confirmResult.phone,
                                    phoneVerified: confirmResult.phoneVerified,
                                }
                                : prev,
                        );

                        setPageMessage(confirmResult.message);
                        closeModal();
                    }

                    if (status.status === 'FAILED' || status.status === 'EXPIRED') {
                        if (pollingRef.current) {
                            window.clearInterval(pollingRef.current);
                            pollingRef.current = null;
                        }

                        closeModal();
                        setPageError('Номер телефону не підтверджено або час сесії минув');
                    }
                } catch (pollErr) {
                    if (pollingRef.current) {
                        window.clearInterval(pollingRef.current);
                        pollingRef.current = null;
                    }

                    const msg =
                        pollErr instanceof Error
                            ? pollErr.message
                            : 'Помилка під час підтвердження телефону';

                    closeModal();
                    setPageError(msg);
                }
            }, 2000);
        } catch (err) {
            setModalError(err instanceof Error ? err.message : 'Не вдалося розпочати зміну телефону');
        } finally {
            setPhoneLoading(false);
        }
    }

    async function handleChangePassword(e: React.FormEvent) {
        e.preventDefault();
        if (!token || !canChangePassword) return;

        if (!passwordForm.currentPassword.trim()) {
            setModalError('Введи поточний пароль');
            return;
        }

        if (!passwordForm.newPassword.trim()) {
            setModalError('Введи новий пароль');
            return;
        }

        if (passwordForm.newPassword !== passwordForm.confirmPassword) {
            setModalError('Новий пароль і підтвердження не співпадають');
            return;
        }

        setPasswordLoading(true);
        clearModalState();

        try {
            const result = await changeMyPassword(token, {
                currentPassword: passwordForm.currentPassword,
                newPassword: passwordForm.newPassword,
            });

            setPageMessage(result.message || 'Пароль успішно змінено');
            closeModal();
        } catch (err) {
            setModalError(err instanceof Error ? err.message : 'Не вдалося змінити пароль');
        } finally {
            setPasswordLoading(false);
        }
    }

    function handleLogout() {
        removeToken();
        window.location.href = '/login';
    }

    return (
        <div className="page-shell profile-retro">
            <div className="container profile-retro__container">
                <div className="profile-retro__content">
                    {pageError && (
                        <div className="profile-retro__top-alert">
                            <AlertToast message={pageError} variant="error" onClose={() => setPageError('')} />
                        </div>
                    )}

                    {pageMessage && (
                        <div className="profile-retro__top-alert">
                            <AlertToast message={pageMessage} variant="success" onClose={() => setPageMessage('')} />
                        </div>
                    )}

                    <div className="profile-retro__card">
                        <div className="profile-retro__header">
                            <div>
                                <h1 className="profile-retro__title">
                                    {isAdminProfile ? 'ПРОФІЛЬ АДМІНА' : 'ПРОФІЛЬ ПАЦІЄНТА'}
                                </h1>
                                <p className="profile-retro__subtitle">
                                    {canEditData
                                        ? 'Тут можна змінити ПІБ, пошту та номер телефону.'
                                        : 'Редагування ПІБ/контактів доступне лише для SUPER_ADMIN.'}
                                </p>
                            </div>

                            <button className="profile-retro__danger" type="button" onClick={handleLogout}>
                                ВИЙТИ
                            </button>
                        </div>

                        {loadingProfile ? (
                            <div className="profile-retro__loading">
                                <div className="profile-retro__spinner" />
                                <span>Завантаження профілю...</span>
                            </div>
                        ) : profile ? (
                            <>
                                <div className="profile-retro__stack">
                                    <div className="profile-retro__info-card">
                                        <span>{isAdminProfile ? 'АДМІН' : 'ПАЦІЄНТ'}</span>
                                        <strong>
                                            {profile.lastName} {profile.firstName} {profile.middleName || ''}
                                        </strong>
                                    </div>

                                    <div className="profile-retro__info-card">
                                        <span>EMAIL</span>
                                        <strong>{profile.email}</strong>
                                    </div>

                                    <div className="profile-retro__info-card">
                                        <span>ТЕЛЕФОН</span>
                                        <strong>{profile.phone || 'НЕ ВКАЗАНО'}</strong>
                                    </div>
                                </div>

                                <div className="profile-retro__actions">
                                    {canEditData && (
                                        <>
                                            <button className="profile-retro__secondary" type="button" onClick={() => openModal('name')}>
                                                ЗМІНИТИ ІМ’Я
                                            </button>

                                            <button className="profile-retro__secondary" type="button" onClick={() => openModal('email')}>
                                                ЗМІНИТИ ПОШТУ
                                            </button>

                                            <button className="profile-retro__secondary" type="button" onClick={() => openModal('phone')}>
                                                ЗМІНИТИ ТЕЛЕФОН
                                            </button>
                                        </>
                                    )}

                                    {canChangePassword && (
                                        <button className="profile-retro__secondary" type="button" onClick={() => openModal('password')}>
                                            ЗМІНИТИ ПАРОЛЬ
                                        </button>
                                    )}
                                </div>
                            </>
                        ) : null}
                    </div>
                </div>
            </div>

            {modalType !== 'none' && (
                <div className="profile-retro__modal-backdrop">
                    <div className="profile-retro__modal">
                        {modalError && (
                            <div className="profile-retro__modal-toast">
                                <AlertToast message={modalError} variant="error" onClose={() => setModalError('')} />
                            </div>
                        )}

                        {modalMessage && (
                            <div className="profile-retro__modal-toast">
                                <AlertToast message={modalMessage} variant="success" onClose={() => setModalMessage('')} />
                            </div>
                        )}

                        {modalType === 'name' && canEditData && (
                            <>
                                <h2 className="profile-retro__modal-title">ЗМІНА ІМЕНІ</h2>

                                <form className="profile-retro__modal-form" onSubmit={handleSaveName}>
                                    <div className="profile-retro__field">
                                        <label htmlFor="profile-lastName">ПРІЗВИЩЕ</label>
                                        <input
                                            id="profile-lastName"
                                            className="profile-retro__input"
                                            value={nameForm.lastName}
                                            onChange={(e) => setNameForm((prev) => ({ ...prev, lastName: e.target.value }))}
                                        />
                                    </div>

                                    <div className="profile-retro__field">
                                        <label htmlFor="profile-firstName">ІМ'Я</label>
                                        <input
                                            id="profile-firstName"
                                            className="profile-retro__input"
                                            value={nameForm.firstName}
                                            onChange={(e) => setNameForm((prev) => ({ ...prev, firstName: e.target.value }))}
                                        />
                                    </div>

                                    <div className="profile-retro__field">
                                        <label htmlFor="profile-middleName">ПО БАТЬКОВІ</label>
                                        <input
                                            id="profile-middleName"
                                            className="profile-retro__input"
                                            value={nameForm.middleName}
                                            onChange={(e) => setNameForm((prev) => ({ ...prev, middleName: e.target.value }))}
                                        />
                                    </div>

                                    <div className="profile-retro__field">
                                        <label htmlFor="profile-password">ПАРОЛЬ</label>
                                        <input
                                            id="profile-password"
                                            className="profile-retro__input"
                                            type="password"
                                            placeholder="Поточний пароль"
                                            value={nameForm.password}
                                            onChange={(e) => setNameForm((prev) => ({ ...prev, password: e.target.value }))}
                                        />
                                    </div>

                                    <div className="profile-retro__modal-actions">
                                        <button className="profile-retro__secondary" type="button" onClick={closeModal}>
                                            СКАСУВАТИ
                                        </button>

                                        <button className="profile-retro__submit" type="submit" disabled={nameLoading}>
                                            {nameLoading ? 'ЗБЕРЕЖЕННЯ...' : 'ЗБЕРЕГТИ'}
                                        </button>
                                    </div>
                                </form>
                            </>
                        )}

                        {modalType === 'email' && canEditData && (
                            <>
                                <h2 className="profile-retro__modal-title">ЗМІНА ПОШТИ</h2>

                                {emailStep === 'request' ? (
                                    <>
                                        <div className="profile-retro__field">
                                            <label htmlFor="email-new">НОВА ПОШТА</label>
                                            <input
                                                id="email-new"
                                                className="profile-retro__input"
                                                type="email"
                                                placeholder="new@email.com"
                                                value={emailForm.newEmail}
                                                onChange={(e) => {
                                                    const next = e.target.value;
                                                    setEmailForm((prev) => ({ ...prev, newEmail: next }));
                                                    const until = readCooldownForEmail(next);
                                                    setEmailCooldownUntil(until);
                                                }}
                                            />
                                        </div>
                                        <div className="profile-retro__field">
                                            <label htmlFor="email-password">ПАРОЛЬ</label>
                                            <input
                                                id="email-password"
                                                className="profile-retro__input"
                                                type="password"
                                                placeholder="Поточний пароль"
                                                value={emailForm.password}
                                                onChange={(e) => setEmailForm((prev) => ({ ...prev, password: e.target.value }))}
                                            />
                                        </div>

                                        <div className="profile-retro__modal-actions">
                                            <button className="profile-retro__secondary" type="button" onClick={closeModal}>
                                                СКАСУВАТИ
                                            </button>

                                            <button
                                                className="profile-retro__submit"
                                                type="button"
                                                onClick={handleRequestEmailChange}
                                                disabled={emailLoading || cooldownActive}
                                                title={emailCodeForEmail ? 'Надіслати код' : undefined}
                                            >
                                                {emailLoading
                                                    ? 'НАДСИЛАННЯ...'
                                                    : cooldownActive
                                                        ? `НАДІСЛАНО ${formatCooldown(cooldownLeftMs)}`
                                                        : emailCodeForEmail
                                                            ? 'НАДІСЛАТИ КОД'
                                                            : 'ОТРИМАТИ КОД'}
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <p className="profile-retro__modal-text">
                                            Ми надіслали код на: <strong>{emailForm.newEmail}</strong>
                                        </p>

                                        <div className="profile-retro__field">
                                            <label htmlFor="email-code">КОД</label>
                                            <input
                                                id="email-code"
                                                className="profile-retro__input"
                                                placeholder="Введи код"
                                                value={emailForm.code}
                                                onChange={(e) => setEmailForm((prev) => ({ ...prev, code: e.target.value }))}
                                            />
                                        </div>

                                        <div className="profile-retro__modal-actions">
                                            <button className="profile-retro__secondary" type="button" onClick={closeModal}>
                                                СКАСУВАТИ
                                            </button>

                                            <button
                                                className="profile-retro__submit"
                                                type="button"
                                                onClick={handleConfirmEmailChange}
                                                disabled={emailLoading}
                                            >
                                                {emailLoading ? 'ПІДТВЕРДЖЕННЯ...' : 'ПІДТВЕРДИТИ'}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </>
                        )}

                        {modalType === 'phone' && canEditData && (
                            <>
                                <h2 className="profile-retro__modal-title">ЗМІНА ТЕЛЕФОНУ</h2>

                                {!waitingTelegram ? (
                                    <>
                                        <div className="profile-retro__field">
                                            <label htmlFor="phone-new">НОВИЙ ТЕЛЕФОН</label>
                                            <input
                                                id="phone-new"
                                                className="profile-retro__input"
                                                placeholder="+380..."
                                                value={phoneForm.phone}
                                                onChange={(e) => setPhoneForm((prev) => ({ ...prev, phone: e.target.value }))}
                                            />
                                        </div>

                                        <div className="profile-retro__field">
                                            <label htmlFor="phone-password">ПАРОЛЬ</label>
                                            <input
                                                id="phone-password"
                                                className="profile-retro__input"
                                                type="password"
                                                placeholder="Поточний пароль"
                                                value={phoneForm.password}
                                                onChange={(e) => setPhoneForm((prev) => ({ ...prev, password: e.target.value }))}
                                            />
                                        </div>

                                        <div className="profile-retro__modal-actions">
                                            <button className="profile-retro__secondary" type="button" onClick={closeModal}>
                                                СКАСУВАТИ
                                            </button>

                                            <button
                                                className="profile-retro__submit"
                                                type="button"
                                                onClick={handleStartPhoneChange}
                                                disabled={phoneLoading}
                                            >
                                                {phoneLoading ? 'ПІДГОТОВКА...' : 'ПОКАЗАТИ QR-КОД'}
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <p className="profile-retro__modal-text">
                                            Підтвердь номер телефону в Telegram. Після цього зміна завершиться автоматично.
                                        </p>

                                        {telegramBotUrl && (
                                            <TelegramQrCard
                                                telegramBotUrl={telegramBotUrl}
                                                title="QR ДЛЯ ПІДТВЕРДЖЕННЯ НОВОГО ТЕЛЕФОНУ"
                                                subtitle="Скануй QR через Telegram або натисни кнопку переходу."
                                            />
                                        )}

                                        <div className="profile-retro__loading">
                                            <div className="profile-retro__spinner" />
                                            <span>Очікуємо підтвердження...</span>
                                        </div>

                                        <div className="profile-retro__modal-actions">
                                            <button className="profile-retro__secondary" type="button" onClick={closeModal}>
                                                ЗАКРИТИ
                                            </button>
                                        </div>
                                    </>
                                )}
                            </>
                        )}

                        {modalType === 'password' && canChangePassword && (
                            <>
                                <h2 className="profile-retro__modal-title">ЗМІНА ПАРОЛЮ</h2>

                                <form className="profile-retro__modal-form" onSubmit={handleChangePassword}>
                                    <div className="profile-retro__field">
                                        <label htmlFor="current-password">ПОТОЧНИЙ ПАРОЛЬ</label>
                                        <input
                                            id="current-password"
                                            className="profile-retro__input"
                                            type="password"
                                            value={passwordForm.currentPassword}
                                            onChange={(e) =>
                                                setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))
                                            }
                                        />
                                    </div>

                                    <div className="profile-retro__field">
                                        <label htmlFor="new-password">НОВИЙ ПАРОЛЬ</label>
                                        <input
                                            id="new-password"
                                            className="profile-retro__input"
                                            type="password"
                                            value={passwordForm.newPassword}
                                            onChange={(e) =>
                                                setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))
                                            }
                                        />
                                    </div>

                                    <div className="profile-retro__field">
                                        <label htmlFor="confirm-password">ПІДТВЕРДИ НОВИЙ ПАРОЛЬ</label>
                                        <input
                                            id="confirm-password"
                                            className="profile-retro__input"
                                            type="password"
                                            value={passwordForm.confirmPassword}
                                            onChange={(e) =>
                                                setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))
                                            }
                                        />
                                    </div>

                                    <div className="profile-retro__modal-actions">
                                        <button className="profile-retro__secondary" type="button" onClick={closeModal}>
                                            СКАСУВАТИ
                                        </button>

                                        <button className="profile-retro__submit" type="submit" disabled={passwordLoading}>
                                            {passwordLoading ? 'ЗМІНА...' : 'ЗМІНИТИ ПАРОЛЬ'}
                                        </button>
                                    </div>
                                </form>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
