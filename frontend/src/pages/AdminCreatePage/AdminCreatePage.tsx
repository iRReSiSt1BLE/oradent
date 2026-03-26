import { useEffect, useMemo, useRef, useState } from 'react';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import { createAdmin, requestAdminEmailVerification } from '../../shared/api/adminApi';
import { getPhoneVerificationStatus, startPhoneVerification } from '../../shared/api/phoneVerificationApi';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import TelegramQrCard from '../../shared/ui/TelegramQrCard/TelegramQrCard';
import './AdminCreatePage.scss';

function generateStrongPassword(length = 14) {
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
    const digits = '23456789';
    const symbols = '!@#$%^&*';
    const all = lower + upper + digits + symbols;

    const chars = [
        lower[Math.floor(Math.random() * lower.length)],
        upper[Math.floor(Math.random() * upper.length)],
        digits[Math.floor(Math.random() * digits.length)],
        symbols[Math.floor(Math.random() * symbols.length)],
    ];

    while (chars.length < length) {
        chars.push(all[Math.floor(Math.random() * all.length)]);
    }

    for (let i = chars.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.join('');
}

const EMAIL_COOLDOWN_MS = 3 * 60 * 1000;
const EMAIL_COOLDOWN_KEY = 'adminCreate.emailCooldown.v1';

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
    });

    const [generatedPassword, setGeneratedPassword] = useState(() => generateStrongPassword());
    const [copiedPassword, setCopiedPassword] = useState(false);

    const [emailCode, setEmailCode] = useState('');
    const [emailCodeRequested, setEmailCodeRequested] = useState(false);
    const [emailCodeForEmail, setEmailCodeForEmail] = useState('');

    const [emailCooldownUntil, setEmailCooldownUntil] = useState(0);
    const [nowTs, setNowTs] = useState(Date.now());

    const [phoneVerificationSessionId, setPhoneVerificationSessionId] = useState('');
    const [phoneVerified, setPhoneVerified] = useState(false);
    const [phoneVerifiedForPhone, setPhoneVerifiedForPhone] = useState('');
    const [telegramBotUrl, setTelegramBotUrl] = useState('');
    const [isPhoneModalOpen, setIsPhoneModalOpen] = useState(false);

    const pollingRef = useRef<number | null>(null);
    const copiedTimerRef = useRef<number | null>(null);

    const normalizedEmail = useMemo(() => normalizeEmail(form.email), [form.email]);
    const normalizedPhone = useMemo(() => normalizePhone(form.phone), [form.phone]);

    const cooldownLeftMs = Math.max(0, emailCooldownUntil - nowTs);
    const cooldownActive = cooldownLeftMs > 0;

    useEffect(() => {
        const timer = window.setInterval(() => setNowTs(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        const raw = window.localStorage.getItem(EMAIL_COOLDOWN_KEY);
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw) as { email: string; until: number };
            if (parsed?.email && parsed?.until && normalizeEmail(parsed.email) === normalizedEmail) {
                setEmailCooldownUntil(parsed.until);
            }
        } catch {}
    }, [normalizedEmail]);

    useEffect(() => {
        if (!emailCodeForEmail) return;
        if (normalizedEmail !== emailCodeForEmail) {
            setEmailCodeRequested(false);
            setEmailCode('');
            setEmailCooldownUntil(0);
        }
    }, [normalizedEmail, emailCodeForEmail]);

    useEffect(() => {
        if (!phoneVerifiedForPhone) return;
        if (normalizedPhone !== phoneVerifiedForPhone) {
            setPhoneVerified(false);
            setPhoneVerificationSessionId('');
            setTelegramBotUrl('');
            setIsPhoneModalOpen(false);
        }
    }, [normalizedPhone, phoneVerifiedForPhone]);

    useEffect(() => {
        return () => {
            if (pollingRef.current) {
                window.clearInterval(pollingRef.current);
            }
            if (copiedTimerRef.current) {
                window.clearTimeout(copiedTimerRef.current);
            }
        };
    }, []);

    async function handleCopyPassword() {
        try {
            await navigator.clipboard.writeText(generatedPassword);
            setCopiedPassword(true);
            if (copiedTimerRef.current) {
                window.clearTimeout(copiedTimerRef.current);
            }
            copiedTimerRef.current = window.setTimeout(() => {
                setCopiedPassword(false);
                copiedTimerRef.current = null;
            }, 1800);
        } catch {
            setError('Не вдалося скопіювати пароль');
        }
    }

    function handleRegeneratePassword() {
        setGeneratedPassword(generateStrongPassword());
        setCopiedPassword(false);
    }

    async function handleRequestEmailCode() {
        if (!token) return;
        if (!normalizedEmail) return setError('Вкажи email для підтвердження');
        if (cooldownActive) return;

        setSendingEmailCode(true);
        setMessage('');
        setError('');

        try {
            const result = await requestAdminEmailVerification(token, normalizedEmail);
            const until = Date.now() + EMAIL_COOLDOWN_MS;

            setEmailCodeRequested(true);
            setEmailCodeForEmail(normalizedEmail);
            setEmailCooldownUntil(until);

            window.localStorage.setItem(
                EMAIL_COOLDOWN_KEY,
                JSON.stringify({ email: normalizedEmail, until }),
            );

            setMessage(result.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося надіслати код');
        } finally {
            setSendingEmailCode(false);
        }
    }

    async function handleStartPhoneVerification() {
        if (!normalizedPhone) return setError('Вкажи телефон');

        setStartingPhoneVerification(true);
        setMessage('');
        setError('');

        try {
            const result = await startPhoneVerification(normalizedPhone);

            setPhoneVerificationSessionId(result.sessionId);
            setTelegramBotUrl(result.telegramBotUrl);
            setPhoneVerified(false);
            setIsPhoneModalOpen(true);

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
                        setPhoneVerifiedForPhone(normalizedPhone);
                        setTelegramBotUrl('');
                        setIsPhoneModalOpen(false);
                        setMessage('Телефон підтверджено');
                    }

                    if (status.status === 'FAILED' || status.status === 'EXPIRED') {
                        if (pollingRef.current) {
                            window.clearInterval(pollingRef.current);
                            pollingRef.current = null;
                        }
                        setPhoneVerified(false);
                        setError('Підтвердження телефону не завершено');
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
                email: normalizedEmail,
                phone: normalizedPhone,
                password: generatedPassword,
                emailCode: emailCode.trim(),
                phoneVerificationSessionId,
            });

            setForm({
                lastName: '',
                firstName: '',
                middleName: '',
                phone: '',
                email: '',
            });
            setGeneratedPassword(generateStrongPassword());
            setCopiedPassword(false);
            setEmailCode('');
            setEmailCodeRequested(false);
            setEmailCodeForEmail('');
            setEmailCooldownUntil(0);
            setPhoneVerificationSessionId('');
            setPhoneVerified(false);
            setPhoneVerifiedForPhone('');
            setTelegramBotUrl('');
            setIsPhoneModalOpen(false);

            window.localStorage.removeItem(EMAIL_COOLDOWN_KEY);

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
                                    <label className="admin-create-page__field">
                                        <span>ПРІЗВИЩЕ</span>
                                        <input
                                            value={form.lastName}
                                            onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))}
                                        />
                                    </label>

                                    <label className="admin-create-page__field">
                                        <span>ІМ'Я</span>
                                        <input
                                            value={form.firstName}
                                            onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))}
                                        />
                                    </label>

                                    <label className="admin-create-page__field">
                                        <span>ПО БАТЬКОВІ</span>
                                        <input
                                            value={form.middleName}
                                            onChange={(e) => setForm((p) => ({ ...p, middleName: e.target.value }))}
                                        />
                                    </label>

                                    <label className="admin-create-page__field">
                                        <span>ТЕЛЕФОН</span>
                                        <input
                                            value={form.phone}
                                            onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                                        />
                                    </label>

                                    <label className="admin-create-page__field">
                                        <span>EMAIL</span>
                                        <input
                                            type="email"
                                            value={form.email}
                                            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                                        />
                                    </label>

                                    <label className="admin-create-page__field">
                                        <span>ЗГЕНЕРОВАНИЙ ПАРОЛЬ</span>
                                        <div className="admin-create-page__password-wrap">
                                            <input value={generatedPassword} readOnly />
                                            <button
                                                type="button"
                                                className="admin-create-page__password-icon"
                                                onClick={handleRegeneratePassword}
                                                title="Згенерувати пароль"
                                                aria-label="Згенерувати пароль"
                                            >
                                                ↻
                                            </button>
                                            <button
                                                type="button"
                                                className="admin-create-page__password-icon admin-create-page__password-icon--copy"
                                                onClick={handleCopyPassword}
                                                title="Скопіювати пароль"
                                                aria-label="Скопіювати пароль"
                                            >
                                                {copiedPassword ? '✓' : '⧉'}
                                            </button>
                                        </div>
                                    </label>
                                </div>

                                <div className="admin-create-page__verify-row">
                                    <button
                                        type="button"
                                        onClick={handleRequestEmailCode}
                                        disabled={sendingEmailCode || cooldownActive}
                                        title={emailCodeRequested ? 'Надіслати код' : undefined}
                                    >
                                        {sendingEmailCode
                                            ? 'НАДСИЛАННЯ...'
                                            : cooldownActive
                                                ? `НАДІСЛАНО ${formatCooldown(cooldownLeftMs)}`
                                                : emailCodeRequested
                                                    ? 'НАДІСЛАТИ КОД'
                                                    : 'НАДІСЛАТИ КОД НА ПОШТУ'}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={handleStartPhoneVerification}
                                        disabled={
                                            startingPhoneVerification ||
                                            !normalizedPhone ||
                                            (phoneVerified && normalizedPhone === phoneVerifiedForPhone)
                                        }
                                    >
                                        {startingPhoneVerification
                                            ? 'ПІДГОТОВКА...'
                                            : phoneVerified && normalizedPhone === phoneVerifiedForPhone
                                                ? 'ТЕЛЕФОН ПІДТВЕРДЖЕНО'
                                                : 'ПІДТВЕРДИТИ ТЕЛЕФОН (TELEGRAM)'}
                                    </button>
                                </div>

                                <label className="admin-create-page__field">
                                    <span>КОД ПІДТВЕРДЖЕННЯ EMAIL</span>
                                    <input
                                        value={emailCode}
                                        onChange={(e) => setEmailCode(e.target.value)}
                                        placeholder="Введи код із листа"
                                    />
                                </label>

                                <div className="admin-create-page__verify-status">
                                    <span className={emailCodeRequested ? 'ok' : 'pending'}>
                                        Email: {emailCodeRequested ? 'код надіслано' : 'код не надіслано'}
                                    </span>
                                    <span className={phoneVerified ? 'ok' : 'pending'}>
                                        Телефон: {phoneVerified ? 'підтверджено' : 'не підтверджено'}
                                    </span>
                                </div>

                                <button className="admin-create-page__submit" type="submit" disabled={saving}>
                                    {saving ? 'СТВОРЕННЯ...' : 'СТВОРИТИ АДМІНА'}
                                </button>
                            </form>
                        )}
                    </section>
                </div>
            </div>

            {isPhoneModalOpen && telegramBotUrl && (
                <div className="admin-create-page__modal-backdrop">
                    <div className="admin-create-page__modal">
                        <h2 className="admin-create-page__modal-title">ПІДТВЕРДЖЕННЯ ТЕЛЕФОНУ</h2>
                        <TelegramQrCard
                            telegramBotUrl={telegramBotUrl}
                            title="QR ДЛЯ ПІДТВЕРДЖЕННЯ ТЕЛЕФОНУ АДМІНА"
                            subtitle="Скануй QR через Telegram або натисни кнопку переходу. Вікно закриється після підтвердження."
                        />
                        <div className="admin-create-page__modal-loader">
                            <div className="admin-create-page__spinner" />
                            <span>Очікуємо підтвердження...</span>
                        </div>
                        <button
                            type="button"
                            className="admin-create-page__modal-close"
                            onClick={() => setIsPhoneModalOpen(false)}
                        >
                            ЗГОРНУТИ
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
