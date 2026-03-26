import { useEffect, useRef, useState } from 'react';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import { createAdmin, requestAdminEmailVerification } from '../../shared/api/adminApi';
import { getPhoneVerificationStatus, startPhoneVerification } from '../../shared/api/phoneVerificationApi';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import './AdminCreatePage.scss';

export default function AdminCreatePage() {
    const token = getToken();
    const role = getUserRole();
    const isAllowed = role === 'SUPER_ADMIN';

    const [saving, setSaving] = useState(false);
    const [sendingEmailCode, setSendingEmailCode] = useState(false);
    const [startingPhoneVerification, setStartingPhoneVerification] = useState(false);

    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const [form, setForm] = useState({
        lastName: '',
        firstName: '',
        middleName: '',
        phone: '',
        email: '',
        password: '',
    });

    const [emailCode, setEmailCode] = useState('');
    const [emailCodeRequested, setEmailCodeRequested] = useState(false);

    const [phoneVerificationSessionId, setPhoneVerificationSessionId] = useState('');
    const [phoneVerified, setPhoneVerified] = useState(false);
    const [telegramBotUrl, setTelegramBotUrl] = useState('');

    const pollingRef = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (pollingRef.current) {
                window.clearInterval(pollingRef.current);
            }
        };
    }, []);

    async function handleRequestEmailCode() {
        if (!token) return;
        if (!form.email.trim()) return setError('Вкажи email для підтвердження');

        setSendingEmailCode(true);
        setMessage('');
        setError('');

        try {
            const result = await requestAdminEmailVerification(token, form.email.trim().toLowerCase());
            setEmailCodeRequested(true);
            setMessage(result.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося надіслати код');
        } finally {
            setSendingEmailCode(false);
        }
    }

    async function handleStartPhoneVerification() {
        if (!form.phone.trim()) return setError('Вкажи телефон');

        setStartingPhoneVerification(true);
        setMessage('');
        setError('');

        try {
            const result = await startPhoneVerification(form.phone.trim());

            setPhoneVerificationSessionId(result.sessionId);
            setTelegramBotUrl(result.telegramBotUrl);
            setPhoneVerified(false);

            window.open(result.telegramBotUrl, '_blank', 'noopener,noreferrer');

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
                        setPhoneVerified(true);
                        setMessage('Телефон підтверджено');
                    }
                } catch {
                    if (pollingRef.current) {
                        window.clearInterval(pollingRef.current);
                        pollingRef.current = null;
                    }
                }
            }, 2000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося запустити підтвердження телефону');
        } finally {
            setStartingPhoneVerification(false);
        }
    }

    async function handleCreateAdmin(e: React.FormEvent) {
        e.preventDefault();

        if (!token) return;
        if (!emailCodeRequested || !emailCode.trim()) return setError('Підтверди email');
        if (!phoneVerificationSessionId || !phoneVerified) return setError('Підтверди телефон');

        setSaving(true);
        setMessage('');
        setError('');

        try {
            const result = await createAdmin(token, {
                ...form,
                middleName: form.middleName || undefined,
                email: form.email.trim().toLowerCase(),
                phone: form.phone.trim(),
                emailCode: emailCode.trim(),
                phoneVerificationSessionId,
            });

            setForm({
                lastName: '',
                firstName: '',
                middleName: '',
                phone: '',
                email: '',
                password: '',
            });
            setEmailCode('');
            setEmailCodeRequested(false);
            setPhoneVerificationSessionId('');
            setPhoneVerified(false);
            setTelegramBotUrl('');

            setMessage(result.message || 'Адміністратора створено');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося створити адміністратора');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="page-shell admin-create-page">
            <div className="container admin-create-page__container">
                <div className="admin-create-page__content">
                    {error && (
                        <div className="admin-create-page__top-alert">
                            <AlertToast message={error} variant="error" onClose={() => setError('')} />
                        </div>
                    )}
                    {message && (
                        <div className="admin-create-page__top-alert">
                            <AlertToast message={message} variant="success" onClose={() => setMessage('')} />
                        </div>
                    )}

                    <section className="admin-create-page__card">
                        <h1 className="admin-create-page__title">СТВОРЕННЯ АДМІНІСТРАТОРА</h1>
                        <p className="admin-create-page__subtitle">Доступно лише для SUPER_ADMIN.</p>

                        {!isAllowed ? (
                            <div className="admin-create-page__blocked">Недостатньо прав.</div>
                        ) : (
                            <form className="admin-create-page__form" onSubmit={handleCreateAdmin}>
                                <div className="admin-create-page__grid">
                                    <label className="admin-create-page__field"><span>ПРІЗВИЩЕ</span><input value={form.lastName} onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))} /></label>
                                    <label className="admin-create-page__field"><span>ІМ'Я</span><input value={form.firstName} onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))} /></label>
                                    <label className="admin-create-page__field"><span>ПО БАТЬКОВІ</span><input value={form.middleName} onChange={(e) => setForm((p) => ({ ...p, middleName: e.target.value }))} /></label>
                                    <label className="admin-create-page__field"><span>ТЕЛЕФОН</span><input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} /></label>
                                    <label className="admin-create-page__field"><span>EMAIL</span><input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} /></label>
                                    <label className="admin-create-page__field"><span>ПАРОЛЬ</span><input type="password" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} /></label>
                                </div>

                                <div className="admin-create-page__verify-row">
                                    <button type="button" onClick={handleRequestEmailCode} disabled={sendingEmailCode}>
                                        {sendingEmailCode ? 'НАДСИЛАННЯ...' : 'НАДІСЛАТИ КОД НА ПОШТУ'}
                                    </button>
                                    <button type="button" onClick={handleStartPhoneVerification} disabled={startingPhoneVerification}>
                                        {startingPhoneVerification ? 'ПІДГОТОВКА...' : 'ПІДТВЕРДИТИ ТЕЛЕФОН (TELEGRAM)'}
                                    </button>
                                </div>

                                <label className="admin-create-page__field">
                                    <span>КОД ПІДТВЕРДЖЕННЯ EMAIL</span>
                                    <input value={emailCode} onChange={(e) => setEmailCode(e.target.value)} placeholder="Введи код із листа" />
                                </label>

                                <div className="admin-create-page__verify-status">
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

                                <button className="admin-create-page__submit" type="submit" disabled={saving}>
                                    {saving ? 'СТВОРЕННЯ...' : 'СТВОРИТИ АДМІНА'}
                                </button>
                            </form>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}
