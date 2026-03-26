import { useEffect, useMemo, useRef, useState } from 'react';
import {
    createAuthenticatedAppointment,
    createGuestAppointment,
} from '../../shared/api/appointmentApi';
import {
    getPhoneVerificationStatus,
    startPhoneVerification,
} from '../../shared/api/phoneVerificationApi';
import { getMyPatient, verifyAndLinkPhone } from '../../shared/api/patientApi';
import { getToken } from '../../shared/utils/authStorage';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import TelegramQrCard from '../../shared/ui/TelegramQrCard/TelegramQrCard';
import './AppointmentPage.scss';

type Mode = 'guest' | 'authenticated';

export default function AppointmentPage() {
    const token = getToken();

    const [mode, setMode] = useState<Mode>(token ? 'authenticated' : 'guest');
    const [patient, setPatient] = useState<any>(null);

    const [guestForm, setGuestForm] = useState({
        lastName: '',
        firstName: '',
        middleName: '',
        phone: '',
        doctorId: '',
        serviceId: '',
        appointmentDate: '',
    });

    const [authForm, setAuthForm] = useState({
        phone: '',
        doctorId: '',
        serviceId: '',
        appointmentDate: '',
    });

    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
    const [verificationLoadingText, setVerificationLoadingText] = useState('');
    const [, setSessionId] = useState('');
    const [telegramBotUrl, setTelegramBotUrl] = useState('');
    const [, setVerificationMode] = useState<Mode | null>(null);

    const pendingGuestFormRef = useRef<typeof guestForm | null>(null);
    const pendingAuthFormRef = useRef<typeof authForm | null>(null);
    const pollingRef = useRef<number | null>(null);
    const completeRef = useRef(false);

    const authNeedsPhone = useMemo(() => {
        return !!token && patient && !patient.phoneVerified;
    }, [token, patient]);

    useEffect(() => {
        async function loadPatient() {
            if (!token) return;

            try {
                const result = await getMyPatient(token);
                setPatient(result.patient);
            } catch {
                // ignore
            }
        }

        void loadPatient();
    }, [token]);

    useEffect(() => {
        return () => {
            if (pollingRef.current) {
                window.clearInterval(pollingRef.current);
            }
        };
    }, []);

    function resetVerificationState() {
        if (pollingRef.current) {
            window.clearInterval(pollingRef.current);
            pollingRef.current = null;
        }

        setIsVerificationModalOpen(false);
        setVerificationLoadingText('');
        setSessionId('');
        setTelegramBotUrl('');
        setVerificationMode(null);
    }

    function clearGuestForm() {
        setGuestForm({
            lastName: '',
            firstName: '',
            middleName: '',
            phone: '',
            doctorId: '',
            serviceId: '',
            appointmentDate: '',
        });
    }

    function clearAuthForm() {
        setAuthForm({
            phone: '',
            doctorId: '',
            serviceId: '',
            appointmentDate: '',
        });
    }

    async function startAutomaticVerificationFlow(phone: string, currentMode: Mode) {
        completeRef.current = false;

        const verification = await startPhoneVerification(phone);

        setSessionId(verification.sessionId);
        setTelegramBotUrl(verification.telegramBotUrl);
        setVerificationMode(currentMode);
        setIsVerificationModalOpen(true);
        setVerificationLoadingText('Очікуємо підтвердження номера телефону в Telegram...');

        if (pollingRef.current) {
            window.clearInterval(pollingRef.current);
        }

        pollingRef.current = window.setInterval(async () => {
            try {
                const statusResult = await getPhoneVerificationStatus(verification.sessionId);

                if (statusResult.status === 'VERIFIED') {
                    if (pollingRef.current) {
                        window.clearInterval(pollingRef.current);
                        pollingRef.current = null;
                    }

                    setVerificationLoadingText('Номер підтверджено. Завершуємо запис...');

                    if (currentMode === 'guest' && pendingGuestFormRef.current) {
                        const form = pendingGuestFormRef.current;

                        await createGuestAppointment({
                            lastName: form.lastName,
                            firstName: form.firstName,
                            middleName: form.middleName || undefined,
                            phone: form.phone,
                            phoneVerificationSessionId: verification.sessionId,
                            doctorId: form.doctorId || undefined,
                            serviceId: form.serviceId || undefined,
                            appointmentDate: form.appointmentDate || undefined,
                        });

                        clearGuestForm();
                        pendingGuestFormRef.current = null;
                        setMessage('Гостьовий запис успішно створено');
                    }

                    if (currentMode === 'authenticated' && pendingAuthFormRef.current && token) {
                        const form = pendingAuthFormRef.current;

                        await verifyAndLinkPhone(token, form.phone, verification.sessionId);

                        const appointmentResult = await createAuthenticatedAppointment(token, {
                            doctorId: form.doctorId || undefined,
                            serviceId: form.serviceId || undefined,
                            appointmentDate: form.appointmentDate || undefined,
                        });

                        const me = await getMyPatient(token);
                        setPatient(me.patient);

                        clearAuthForm();
                        pendingAuthFormRef.current = null;
                        setMessage((appointmentResult as any).message || 'Запис успішно створено');
                    }

                    completeRef.current = true;
                    resetVerificationState();
                    setIsSubmitting(false);
                    return;
                }

                if (statusResult.status === 'FAILED' || statusResult.status === 'EXPIRED') {
                    if (pollingRef.current) {
                        window.clearInterval(pollingRef.current);
                        pollingRef.current = null;
                    }

                    resetVerificationState();
                    setIsSubmitting(false);
                    setError('Підтвердження телефону не завершено');
                }
            } catch (err) {
                if (completeRef.current) return;

                if (pollingRef.current) {
                    window.clearInterval(pollingRef.current);
                    pollingRef.current = null;
                }

                resetVerificationState();
                setIsSubmitting(false);
                setError(err instanceof Error ? err.message : 'Помилка під час підтвердження');
            }
        }, 2000);
    }

    async function handleGuestSubmit(e: React.FormEvent) {
        e.preventDefault();
        setMessage('');
        setError('');
        setIsSubmitting(true);

        try {
            pendingGuestFormRef.current = guestForm;
            await startAutomaticVerificationFlow(guestForm.phone, 'guest');
        } catch (err) {
            setIsSubmitting(false);
            setError(err instanceof Error ? err.message : 'Помилка створення запису');
        }
    }

    async function handleAuthenticatedSubmit(e: React.FormEvent) {
        e.preventDefault();
        setMessage('');
        setError('');
        setIsSubmitting(true);

        try {
            if (!token) {
                throw new Error('Спочатку увійди в систему');
            }

            if (patient?.phoneVerified) {
                const result = await createAuthenticatedAppointment(token, {
                    doctorId: authForm.doctorId || undefined,
                    serviceId: authForm.serviceId || undefined,
                    appointmentDate: authForm.appointmentDate || undefined,
                });

                clearAuthForm();
                setMessage((result as any).message || 'Запис успішно створено');
                setIsSubmitting(false);
                return;
            }

            pendingAuthFormRef.current = authForm;
            await startAutomaticVerificationFlow(authForm.phone, 'authenticated');
        } catch (err) {
            setIsSubmitting(false);
            setError(err instanceof Error ? err.message : 'Помилка створення запису');
        }
    }

    return (
        <div className="page-shell appointment-retro">
            <div className="container appointment-retro__container">
                <div className="appointment-retro__card">
                    <div className="appointment-retro__header">
                        <h1 className="appointment-retro__title">ЗАПИС НА ПРИЙОМ</h1>

                        <div className="appointment-retro__modes">
                            <button
                                className={`appointment-retro__mode ${
                                    mode === 'guest' ? 'appointment-retro__mode--active' : ''
                                }`}
                                onClick={() => setMode('guest')}
                                type="button"
                            >
                                ГІСТЬ
                            </button>

                            <button
                                className={`appointment-retro__mode ${
                                    mode === 'authenticated' ? 'appointment-retro__mode--active' : ''
                                }`}
                                onClick={() => setMode('authenticated')}
                                type="button"
                            >
                                АВТОРИЗОВАНИЙ
                            </button>
                        </div>
                    </div>

                    <p className="appointment-retro__subtitle">
                        Гість підтверджує номер кожного разу. Авторизований користувач — тільки під час першого запису.
                    </p>

                    {error && (
                        <AlertToast
                            message={error}
                            variant="error"
                            onClose={() => setError('')}
                        />
                    )}

                    {message && (
                        <AlertToast
                            message={message}
                            variant="success"
                            onClose={() => setMessage('')}
                        />
                    )}

                    {mode === 'guest' ? (
                        <form
                            className="appointment-retro__form appointment-retro__form--guest"
                            onSubmit={handleGuestSubmit}
                        >
                            <div className="appointment-retro__field">
                                <label htmlFor="guest-lastName">ПРІЗВИЩЕ</label>
                                <input
                                    id="guest-lastName"
                                    className="appointment-retro__input"
                                    placeholder="Прізвище"
                                    value={guestForm.lastName}
                                    onChange={(e) =>
                                        setGuestForm((prev) => ({ ...prev, lastName: e.target.value }))
                                    }
                                />
                            </div>

                            <div className="appointment-retro__field">
                                <label htmlFor="guest-firstName">ІМ&apos;Я</label>
                                <input
                                    id="guest-firstName"
                                    className="appointment-retro__input"
                                    placeholder="Ім&apos;я"
                                    value={guestForm.firstName}
                                    onChange={(e) =>
                                        setGuestForm((prev) => ({ ...prev, firstName: e.target.value }))
                                    }
                                />
                            </div>

                            <div className="appointment-retro__field appointment-retro__field--full">
                                <label htmlFor="guest-middleName">ПО БАТЬКОВІ</label>
                                <input
                                    id="guest-middleName"
                                    className="appointment-retro__input"
                                    placeholder="По батькові"
                                    value={guestForm.middleName}
                                    onChange={(e) =>
                                        setGuestForm((prev) => ({ ...prev, middleName: e.target.value }))
                                    }
                                />
                            </div>

                            <div className="appointment-retro__field appointment-retro__field--full">
                                <label htmlFor="guest-phone">ТЕЛЕФОН</label>
                                <input
                                    id="guest-phone"
                                    className="appointment-retro__input"
                                    placeholder="+380..."
                                    value={guestForm.phone}
                                    onChange={(e) =>
                                        setGuestForm((prev) => ({ ...prev, phone: e.target.value }))
                                    }
                                />
                            </div>

                            <div className="appointment-retro__field">
                                <label htmlFor="guest-doctorId">DOCTOR ID</label>
                                <input
                                    id="guest-doctorId"
                                    className="appointment-retro__input"
                                    placeholder="doctorId"
                                    value={guestForm.doctorId}
                                    onChange={(e) =>
                                        setGuestForm((prev) => ({ ...prev, doctorId: e.target.value }))
                                    }
                                />
                            </div>

                            <div className="appointment-retro__field">
                                <label htmlFor="guest-serviceId">SERVICE ID</label>
                                <input
                                    id="guest-serviceId"
                                    className="appointment-retro__input"
                                    placeholder="serviceId"
                                    value={guestForm.serviceId}
                                    onChange={(e) =>
                                        setGuestForm((prev) => ({ ...prev, serviceId: e.target.value }))
                                    }
                                />
                            </div>

                            <div className="appointment-retro__field appointment-retro__field--full">
                                <label htmlFor="guest-date">ДАТА ТА ЧАС</label>
                                <input
                                    id="guest-date"
                                    className="appointment-retro__input"
                                    type="datetime-local"
                                    value={guestForm.appointmentDate}
                                    onChange={(e) =>
                                        setGuestForm((prev) => ({
                                            ...prev,
                                            appointmentDate: e.target.value,
                                        }))
                                    }
                                />
                            </div>

                            <button
                                className="appointment-retro__submit appointment-retro__submit--full"
                                type="submit"
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? 'ОБРОБКА...' : 'ЗАПИСАТИСЯ НА ПРИЙОМ'}
                            </button>
                        </form>
                    ) : (
                        <form
                            className="appointment-retro__form appointment-retro__form--auth"
                            onSubmit={handleAuthenticatedSubmit}
                        >
                            {!token && (
                                <div className="status-box status-box--error appointment-retro__full-row">
                                    Для авторизованого запису потрібно спочатку увійти в систему.
                                </div>
                            )}

                            {!!token && authNeedsPhone && (
                                <div className="appointment-retro__field appointment-retro__field--full">
                                    <label htmlFor="auth-phone">ТЕЛЕФОН</label>
                                    <input
                                        id="auth-phone"
                                        className="appointment-retro__input"
                                        placeholder="Номер телефону"
                                        value={authForm.phone}
                                        onChange={(e) =>
                                            setAuthForm((prev) => ({ ...prev, phone: e.target.value }))
                                        }
                                    />
                                </div>
                            )}

                            <div className="appointment-retro__field">
                                <label htmlFor="auth-doctorId">DOCTOR ID</label>
                                <input
                                    id="auth-doctorId"
                                    className="appointment-retro__input"
                                    placeholder="doctorId"
                                    value={authForm.doctorId}
                                    onChange={(e) =>
                                        setAuthForm((prev) => ({ ...prev, doctorId: e.target.value }))
                                    }
                                />
                            </div>

                            <div className="appointment-retro__field">
                                <label htmlFor="auth-serviceId">SERVICE ID</label>
                                <input
                                    id="auth-serviceId"
                                    className="appointment-retro__input"
                                    placeholder="serviceId"
                                    value={authForm.serviceId}
                                    onChange={(e) =>
                                        setAuthForm((prev) => ({ ...prev, serviceId: e.target.value }))
                                    }
                                />
                            </div>

                            <div className="appointment-retro__field appointment-retro__field--full">
                                <label htmlFor="auth-date">ДАТА ТА ЧАС</label>
                                <input
                                    id="auth-date"
                                    className="appointment-retro__input"
                                    type="datetime-local"
                                    value={authForm.appointmentDate}
                                    onChange={(e) =>
                                        setAuthForm((prev) => ({
                                            ...prev,
                                            appointmentDate: e.target.value,
                                        }))
                                    }
                                />
                            </div>

                            <button
                                className="appointment-retro__submit appointment-retro__submit--full"
                                type="submit"
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? 'ОБРОБКА...' : 'ЗАПИСАТИСЯ НА ПРИЙОМ'}
                            </button>
                        </form>
                    )}
                </div>
            </div>

            {isVerificationModalOpen && (
                <div className="appointment-retro__modal-backdrop">
                    <div className="appointment-retro__modal">
                        <h2 className="appointment-retro__modal-title">ПІДТВЕРДЖЕННЯ ТЕЛЕФОНУ</h2>

                        <p className="appointment-retro__modal-text">
                            Потрібно один раз підтвердити номер у Telegram. Після цього запис на прийом завершиться автоматично.
                        </p>

                        {telegramBotUrl && (
                            <TelegramQrCard
                                telegramBotUrl={telegramBotUrl}
                                title="QR ДЛЯ ПІДТВЕРДЖЕННЯ ТЕЛЕФОНУ"
                                subtitle="Скануй QR через Telegram або натисни кнопку для переходу в Telegram."
                            />
                        )}

                        <div className="appointment-retro__loader-block">
                            <div className="appointment-retro__spinner" />
                            <span>{verificationLoadingText}</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
