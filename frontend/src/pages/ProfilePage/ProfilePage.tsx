import { useEffect, useRef, useState } from 'react';
import { getToken, removeToken } from '../../shared/utils/authStorage';
import { getPhoneVerificationStatus } from '../../shared/api/phoneVerificationApi';
import {
    confirmEmailChange,
    confirmPhoneChange,
    getMyProfile,
    requestEmailChange,
    startPhoneChange,
    updateProfile,
} from '../../shared/api/profileApi';
import AlertToast from '../../widgets/AlertToast/AlertToast';
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

type ModalType = 'none' | 'name' | 'email' | 'phone';

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

    const [phoneForm, setPhoneForm] = useState({
        phone: '',
        password: '',
    });

    const [telegramBotUrl, setTelegramBotUrl] = useState('');
    const [waitingTelegram, setWaitingTelegram] = useState(false);

    const pollingRef = useRef<number | null>(null);

    const isAdminProfile = profile?.role === 'ADMIN' || profile?.role === 'SUPER_ADMIN';
    const canEditSelf = profile?.role !== 'ADMIN';

    useEffect(() => {
        void loadProfile();

        return () => {
            if (pollingRef.current) {
                window.clearInterval(pollingRef.current);
            }
        };
    }, []);

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

    function openModal(type: ModalType) {
        if (!canEditSelf) return;

        clearModalState();
        setModalType(type);

        if (type === 'name' && profile) {
            setNameForm({
                lastName: profile.lastName,
                firstName: profile.firstName,
                middleName: profile.middleName || '',
                password: '',
            });
        }

        if (type === 'email') {
            setEmailStep('request');
            setEmailForm({
                newEmail: '',
                password: '',
                code: '',
            });
        }

        if (type === 'phone') {
            setPhoneForm({
                phone: profile?.phone || '',
                password: '',
            });
            setTelegramBotUrl('');
            setWaitingTelegram(false);
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

        if (!token || !canEditSelf) return;

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
        if (!token || !canEditSelf) return;

        setEmailLoading(true);
        clearModalState();

        try {
            const result = await requestEmailChange(token, {
                newEmail: emailForm.newEmail,
                password: emailForm.password,
            });

            setEmailStep('confirm');
            setModalMessage(result.message);
        } catch (err) {
            setModalError(err instanceof Error ? err.message : 'Не вдалося надіслати код');
        } finally {
            setEmailLoading(false);
        }
    }

    async function handleConfirmEmailChange() {
        if (!token || !canEditSelf) return;

        setEmailLoading(true);
        clearModalState();

        try {
            const result = await confirmEmailChange(token, {
                newEmail: emailForm.newEmail,
                code: emailForm.code,
            });

            setProfile((prev) =>
                prev
                    ? {
                        ...prev,
                        email: result.email,
                    }
                    : prev,
            );

            setPageMessage(result.message);
            closeModal();
        } catch (err) {
            setModalError(err instanceof Error ? err.message : 'Не вдалося змінити пошту');
        } finally {
            setEmailLoading(false);
        }
    }

    async function handleStartPhoneChange() {
        if (!token || !canEditSelf) return;

        setPhoneLoading(true);
        clearModalState();

        try {
            const result = await startPhoneChange(token, {
                phone: phoneForm.phone,
                password: phoneForm.password,
            });

            setTelegramBotUrl(result.telegramBotUrl);
            setWaitingTelegram(true);

            window.open(result.telegramBotUrl, '_blank', 'noopener,noreferrer');

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
                                    {canEditSelf
                                        ? 'Тут можна змінити ПІБ, пошту та номер телефону.'
                                        : 'Редагування профілю доступне лише для SUPER_ADMIN.'}
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

                                {canEditSelf && (
                                    <div className="profile-retro__actions">
                                        <button className="profile-retro__secondary" type="button" onClick={() => openModal('name')}>
                                            ЗМІНИТИ ІМ’Я
                                        </button>

                                        <button className="profile-retro__secondary" type="button" onClick={() => openModal('email')}>
                                            ЗМІНИТИ ПОШТУ
                                        </button>

                                        <button className="profile-retro__secondary" type="button" onClick={() => openModal('phone')}>
                                            ЗМІНИТИ ТЕЛЕФОН
                                        </button>
                                    </div>
                                )}
                            </>
                        ) : null}
                    </div>
                </div>
            </div>

            {modalType !== 'none' && canEditSelf && (
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

                        {modalType === 'name' && (
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

                        {modalType === 'email' && (
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
                                                onChange={(e) => setEmailForm((prev) => ({ ...prev, newEmail: e.target.value }))}
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
                                                disabled={emailLoading}
                                            >
                                                {emailLoading ? 'НАДСИЛАННЯ...' : 'ОТРИМАТИ КОД'}
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

                        {modalType === 'phone' && (
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
                                                {phoneLoading ? 'ПІДГОТОВКА...' : 'ВІДКРИТИ TELEGRAM'}
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <p className="profile-retro__modal-text">
                                            Підтвердь номер телефону в Telegram. Після цього зміна завершиться автоматично.
                                        </p>

                                        {telegramBotUrl && (
                                            <a
                                                className="profile-retro__telegram-button"
                                                href={telegramBotUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                ВІДКРИТИ TELEGRAM
                                            </a>
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
                    </div>
                </div>
            )}
        </div>
    );
}

