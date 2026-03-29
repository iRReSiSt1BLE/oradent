import { useEffect, useMemo, useRef, useState } from 'react';
import { createAuthenticatedAppointment, createGuestAppointment } from '../../shared/api/appointmentApi';
import { getPhoneVerificationStatus, startPhoneVerification } from '../../shared/api/phoneVerificationApi';
import { getMyPatient, verifyAndLinkPhone } from '../../shared/api/patientApi';
import { getToken } from '../../shared/utils/authStorage';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import TelegramQrCard from '../../shared/ui/TelegramQrCard/TelegramQrCard';
import { getActivePublicServices } from '../../shared/api/servicesApi';
import type { ClinicService, ServiceDoctor } from '../../shared/api/servicesApi';
import { buildDoctorAvatarUrl } from '../../shared/api/doctorApi';
import './AppointmentPage.scss';

type Mode = 'guest' | 'authenticated';

type Patient = {
    id: string;
    lastName: string;
    firstName: string;
    middleName: string | null;
    phone: string | null;
    email: string | null;
    phoneVerified: boolean;
} | null;

type GuestForm = {
    lastName: string;
    firstName: string;
    middleName: string;
    phone: string;
    doctorId: string;
    serviceId: string;
    appointmentDate: string;
};

type AuthForm = {
    phone: string;
    doctorId: string;
    serviceId: string;
    appointmentDate: string;
};

const EMPTY_GUEST_FORM: GuestForm = {
    lastName: '',
    firstName: '',
    middleName: '',
    phone: '',
    doctorId: '',
    serviceId: '',
    appointmentDate: '',
};

const EMPTY_AUTH_FORM: AuthForm = {
    phone: '',
    doctorId: '',
    serviceId: '',
    appointmentDate: '',
};

function detectPreferredSize(): 'sm' | 'md' | 'lg' {
    const dpr = window.devicePixelRatio || 1;
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    const effectiveType = connection?.effectiveType || '';

    if (effectiveType === 'slow-2g' || effectiveType === '2g') return 'sm';
    if (effectiveType === '3g') return 'md';
    if (dpr >= 2) return 'lg';
    return 'md';
}

function buildAvatarSrcSet(doctorId: string, avatarVersion?: number) {
    const sm = buildDoctorAvatarUrl(doctorId, 'sm', avatarVersion);
    const md = buildDoctorAvatarUrl(doctorId, 'md', avatarVersion);
    const lg = buildDoctorAvatarUrl(doctorId, 'lg', avatarVersion);
    return `${sm} 160w, ${md} 320w, ${lg} 640w`;
}

function doctorDisplayName(doctor: ServiceDoctor) {
    if (doctor.fullName?.trim()) return doctor.fullName.trim();
    const fallback = [doctor.lastName, doctor.firstName, doctor.middleName].filter(Boolean).join(' ').trim();
    if (fallback) return fallback;
    return doctor.email;
}

export default function AppointmentPage() {
    const token = getToken();

    const [mode, setMode] = useState<Mode>(token ? 'authenticated' : 'guest');
    const [patient, setPatient] = useState<Patient>(null);

    const [guestForm, setGuestForm] = useState<GuestForm>(EMPTY_GUEST_FORM);
    const [authForm, setAuthForm] = useState<AuthForm>(EMPTY_AUTH_FORM);

    const [services, setServices] = useState<ClinicService[]>([]);
    const [servicesLoading, setServicesLoading] = useState(true);

    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
    const [verificationLoadingText, setVerificationLoadingText] = useState('');
    const [telegramBotUrl, setTelegramBotUrl] = useState('');

    const [preferredSize, setPreferredSize] = useState<'sm' | 'md' | 'lg'>('md');

    const pendingGuestFormRef = useRef<GuestForm | null>(null);
    const pendingAuthFormRef = useRef<AuthForm | null>(null);
    const pollingRef = useRef<number | null>(null);
    const completeRef = useRef(false);

    const authNeedsPhone = useMemo(() => !!token && patient && !patient.phoneVerified, [token, patient]);

    const guestSelectedService = useMemo(
        () => services.find((s) => s.id === guestForm.serviceId) || null,
        [services, guestForm.serviceId],
    );

    const authSelectedService = useMemo(
        () => services.find((s) => s.id === authForm.serviceId) || null,
        [services, authForm.serviceId],
    );

    const guestDoctors: ServiceDoctor[] = guestSelectedService?.doctors || [];
    const authDoctors: ServiceDoctor[] = authSelectedService?.doctors || [];

    const hasBookableServices = useMemo(() => services.some((service) => service.doctors.length > 0), [services]);

    useEffect(() => {
        setPreferredSize(detectPreferredSize());
        const onResize = () => setPreferredSize(detectPreferredSize());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    useEffect(() => {
        async function loadPatient() {
            if (!token) return;
            try {
                const result = await getMyPatient(token);
                setPatient(result.patient);
            } catch {}
        }

        async function loadServices() {
            setServicesLoading(true);
            try {
                const result = await getActivePublicServices();
                setServices(result.services);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Не вдалося завантажити послуги');
            } finally {
                setServicesLoading(false);
            }
        }

        void loadPatient();
        void loadServices();
    }, [token]);

    useEffect(() => {
        return () => {
            if (pollingRef.current) window.clearInterval(pollingRef.current);
        };
    }, []);

    function resetVerificationState() {
        if (pollingRef.current) {
            window.clearInterval(pollingRef.current);
            pollingRef.current = null;
        }
        setIsVerificationModalOpen(false);
        setVerificationLoadingText('');
        setTelegramBotUrl('');
    }

    function clearGuestForm() {
        setGuestForm(EMPTY_GUEST_FORM);
    }

    function clearAuthForm() {
        setAuthForm(EMPTY_AUTH_FORM);
    }

    function validateBookingPayload(serviceId: string, doctorId: string, appointmentDate: string) {
        if (!serviceId) throw new Error('Оберіть послугу');
        if (!doctorId) throw new Error('Оберіть лікаря');
        if (!appointmentDate) throw new Error('Оберіть дату та час');
    }

    async function startAutomaticVerificationFlow(phone: string, currentMode: Mode) {
        completeRef.current = false;
        const verification = await startPhoneVerification(phone);

        setTelegramBotUrl(verification.telegramBotUrl);
        setIsVerificationModalOpen(true);
        setVerificationLoadingText('Очікуємо підтвердження номера телефону в Telegram...');

        if (pollingRef.current) window.clearInterval(pollingRef.current);

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

                        validateBookingPayload(form.serviceId, form.doctorId, form.appointmentDate);

                        await createGuestAppointment({
                            lastName: form.lastName,
                            firstName: form.firstName,
                            middleName: form.middleName || undefined,
                            phone: form.phone,
                            phoneVerificationSessionId: verification.sessionId,
                            doctorId: form.doctorId,
                            serviceId: form.serviceId,
                            appointmentDate: form.appointmentDate,
                        });

                        clearGuestForm();
                        pendingGuestFormRef.current = null;
                        setMessage('Гостьовий запис успішно створено');
                    }

                    if (currentMode === 'authenticated' && pendingAuthFormRef.current && token) {
                        const form = pendingAuthFormRef.current;

                        validateBookingPayload(form.serviceId, form.doctorId, form.appointmentDate);

                        await verifyAndLinkPhone(token, form.phone, verification.sessionId);

                        const appointmentResult = await createAuthenticatedAppointment(token, {
                            doctorId: form.doctorId,
                            serviceId: form.serviceId,
                            appointmentDate: form.appointmentDate,
                        });

                        const me = await getMyPatient(token);
                        setPatient(me.patient);

                        clearAuthForm();
                        pendingAuthFormRef.current = null;
                        setMessage((appointmentResult as { message?: string }).message || 'Запис успішно створено');
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

        if (!hasBookableServices) {
            setError('Поки немає лікарів для активних послуг. Звернись до адміністратора.');
            return;
        }

        try {
            validateBookingPayload(guestForm.serviceId, guestForm.doctorId, guestForm.appointmentDate);

            if (!guestForm.lastName.trim() || !guestForm.firstName.trim() || !guestForm.middleName.trim()) {
                throw new Error('Заповни ПІБ повністю');
            }

            if (!guestForm.phone.trim()) throw new Error('Вкажи телефон');

            setIsSubmitting(true);
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

        if (!hasBookableServices) {
            setError('Поки немає лікарів для активних послуг. Звернись до адміністратора.');
            return;
        }

        try {
            if (!token) throw new Error('Спочатку увійди в систему');

            validateBookingPayload(authForm.serviceId, authForm.doctorId, authForm.appointmentDate);

            setIsSubmitting(true);

            if (patient?.phoneVerified) {
                const result = await createAuthenticatedAppointment(token, {
                    doctorId: authForm.doctorId,
                    serviceId: authForm.serviceId,
                    appointmentDate: authForm.appointmentDate,
                });

                clearAuthForm();
                setMessage((result as { message?: string }).message || 'Запис успішно створено');
                setIsSubmitting(false);
                return;
            }

            if (!authForm.phone.trim()) throw new Error('Вкажи телефон для підтвердження');

            pendingAuthFormRef.current = authForm;
            await startAutomaticVerificationFlow(authForm.phone, 'authenticated');
        } catch (err) {
            setIsSubmitting(false);
            setError(err instanceof Error ? err.message : 'Помилка створення запису');
        }
    }

    function onGuestServiceChange(serviceId: string) {
        const service = services.find((s) => s.id === serviceId) || null;
        setGuestForm((prev) => ({
            ...prev,
            serviceId,
            doctorId: service && service.doctors.some((d) => d.id === prev.doctorId) ? prev.doctorId : '',
        }));
    }

    function onAuthServiceChange(serviceId: string) {
        const service = services.find((s) => s.id === serviceId) || null;
        setAuthForm((prev) => ({
            ...prev,
            serviceId,
            doctorId: service && service.doctors.some((d) => d.id === prev.doctorId) ? prev.doctorId : '',
        }));
    }

    function renderDoctorPicker(
        doctors: ServiceDoctor[],
        selectedDoctorId: string,
        onSelect: (doctorId: string) => void,
        disabled: boolean,
        emptyLabel: string,
    ) {
        if (disabled) {
            return <div className="appointment-retro__doctor-empty">{emptyLabel}</div>;
        }

        return (
            <div className="appointment-retro__doctor-list">
                {doctors.map((doctor) => {
                    const isActive = selectedDoctorId === doctor.id;
                    const hasAvatar = Boolean(doctor.hasAvatar || doctor.avatarVersion);
                    const src = buildDoctorAvatarUrl(doctor.id, preferredSize, doctor.avatarVersion);
                    const srcSet = buildAvatarSrcSet(doctor.id, doctor.avatarVersion);

                    return (
                        <button
                            key={doctor.id}
                            type="button"
                            className={`appointment-retro__doctor-item ${isActive ? 'is-active' : ''}`}
                            onClick={() => onSelect(doctor.id)}
                        >
                            <div className="appointment-retro__doctor-avatar-wrap">
                                {hasAvatar ? (
                                    <img
                                        className="appointment-retro__doctor-avatar"
                                        src={src}
                                        srcSet={srcSet}
                                        sizes="44px"
                                        alt=""
                                        loading="lazy"
                                        decoding="async"
                                    />
                                ) : (
                                    <div className="appointment-retro__doctor-avatar-placeholder">
                                        {doctorDisplayName(doctor).trim().charAt(0).toUpperCase() || 'Л'}
                                    </div>
                                )}
                            </div>

                            <div className="appointment-retro__doctor-text">
                                <strong>{doctorDisplayName(doctor)}</strong>
                                <span>{doctor.email}</span>
                            </div>
                        </button>
                    );
                })}
            </div>
        );
    }

    return (
        <div className="page-shell appointment-retro">
            <div className="container appointment-retro__container">
                <div className="appointment-retro__card">
                    <div className="appointment-retro__header">
                        <h1 className="appointment-retro__title">ЗАПИС НА ПРИЙОМ</h1>

                        <div className="appointment-retro__modes">
                            <button
                                className={`appointment-retro__mode ${mode === 'guest' ? 'appointment-retro__mode--active' : ''}`}
                                onClick={() => setMode('guest')}
                                type="button"
                            >
                                ГІСТЬ
                            </button>

                            <button
                                className={`appointment-retro__mode ${mode === 'authenticated' ? 'appointment-retro__mode--active' : ''}`}
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

                    {servicesLoading && <div className="status-box appointment-retro__full-row">Завантаження послуг...</div>}

                    {!servicesLoading && services.length === 0 && (
                        <div className="status-box status-box--error appointment-retro__full-row">
                            Поки немає активних послуг для запису.
                        </div>
                    )}

                    {!servicesLoading && services.length > 0 && !hasBookableServices && (
                        <div className="status-box status-box--error appointment-retro__full-row">
                            Активні послуги є, але лікарів ще не призначено.
                        </div>
                    )}

                    {error && <AlertToast message={error} variant="error" onClose={() => setError('')} />}
                    {message && <AlertToast message={message} variant="success" onClose={() => setMessage('')} />}

                    {mode === 'guest' ? (
                        <form className="appointment-retro__form appointment-retro__form--guest" onSubmit={handleGuestSubmit}>
                            <div className="appointment-retro__field">
                                <label htmlFor="guest-lastName">ПРІЗВИЩЕ</label>
                                <input
                                    id="guest-lastName"
                                    className="appointment-retro__input"
                                    placeholder="Прізвище"
                                    value={guestForm.lastName}
                                    onChange={(e) => setGuestForm((prev) => ({ ...prev, lastName: e.target.value }))}
                                />
                            </div>

                            <div className="appointment-retro__field">
                                <label htmlFor="guest-firstName">ІМ&apos;Я</label>
                                <input
                                    id="guest-firstName"
                                    className="appointment-retro__input"
                                    placeholder="Ім&apos;я"
                                    value={guestForm.firstName}
                                    onChange={(e) => setGuestForm((prev) => ({ ...prev, firstName: e.target.value }))}
                                />
                            </div>

                            <div className="appointment-retro__field appointment-retro__field--full">
                                <label htmlFor="guest-middleName">ПО БАТЬКОВІ</label>
                                <input
                                    id="guest-middleName"
                                    className="appointment-retro__input"
                                    placeholder="По батькові"
                                    value={guestForm.middleName}
                                    onChange={(e) => setGuestForm((prev) => ({ ...prev, middleName: e.target.value }))}
                                />
                            </div>

                            <div className="appointment-retro__field appointment-retro__field--full">
                                <label htmlFor="guest-phone">ТЕЛЕФОН</label>
                                <input
                                    id="guest-phone"
                                    className="appointment-retro__input"
                                    placeholder="+380..."
                                    value={guestForm.phone}
                                    onChange={(e) => setGuestForm((prev) => ({ ...prev, phone: e.target.value }))}
                                />
                            </div>

                            <div className="appointment-retro__field">
                                <label htmlFor="guest-serviceId">ПОСЛУГА</label>
                                <select
                                    id="guest-serviceId"
                                    className="appointment-retro__select"
                                    value={guestForm.serviceId}
                                    onChange={(e) => onGuestServiceChange(e.target.value)}
                                >
                                    <option value="">Оберіть послугу</option>
                                    {services.map((service) => (
                                        <option key={service.id} value={service.id}>
                                            {service.name} ({service.durationMinutes} хв)
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="appointment-retro__field">
                                <label>ЛІКАР</label>
                                {renderDoctorPicker(
                                    guestDoctors,
                                    guestForm.doctorId,
                                    (doctorId) => setGuestForm((prev) => ({ ...prev, doctorId })),
                                    !guestForm.serviceId || guestDoctors.length === 0,
                                    !guestForm.serviceId
                                        ? 'Спочатку обери послугу'
                                        : 'Для цієї послуги лікарі не призначені',
                                )}
                            </div>

                            <div className="appointment-retro__field appointment-retro__field--full">
                                <label htmlFor="guest-date">ДАТА ТА ЧАС</label>
                                <input
                                    id="guest-date"
                                    className="appointment-retro__input"
                                    type="datetime-local"
                                    value={guestForm.appointmentDate}
                                    onChange={(e) => setGuestForm((prev) => ({ ...prev, appointmentDate: e.target.value }))}
                                />
                            </div>

                            <button
                                className="appointment-retro__submit appointment-retro__submit--full"
                                type="submit"
                                disabled={isSubmitting || servicesLoading || !hasBookableServices}
                            >
                                {isSubmitting ? 'ОБРОБКА...' : 'ЗАПИСАТИСЯ НА ПРИЙОМ'}
                            </button>
                        </form>
                    ) : (
                        <form className="appointment-retro__form appointment-retro__form--auth" onSubmit={handleAuthenticatedSubmit}>
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
                                        onChange={(e) => setAuthForm((prev) => ({ ...prev, phone: e.target.value }))}
                                    />
                                </div>
                            )}

                            <div className="appointment-retro__field">
                                <label htmlFor="auth-serviceId">ПОСЛУГА</label>
                                <select
                                    id="auth-serviceId"
                                    className="appointment-retro__select"
                                    value={authForm.serviceId}
                                    onChange={(e) => onAuthServiceChange(e.target.value)}
                                >
                                    <option value="">Оберіть послугу</option>
                                    {services.map((service) => (
                                        <option key={service.id} value={service.id}>
                                            {service.name} ({service.durationMinutes} хв)
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="appointment-retro__field">
                                <label>ЛІКАР</label>
                                {renderDoctorPicker(
                                    authDoctors,
                                    authForm.doctorId,
                                    (doctorId) => setAuthForm((prev) => ({ ...prev, doctorId })),
                                    !authForm.serviceId || authDoctors.length === 0,
                                    !authForm.serviceId
                                        ? 'Спочатку обери послугу'
                                        : 'Для цієї послуги лікарі не призначені',
                                )}
                            </div>

                            <div className="appointment-retro__field appointment-retro__field--full">
                                <label htmlFor="auth-date">ДАТА ТА ЧАС</label>
                                <input
                                    id="auth-date"
                                    className="appointment-retro__input"
                                    type="datetime-local"
                                    value={authForm.appointmentDate}
                                    onChange={(e) => setAuthForm((prev) => ({ ...prev, appointmentDate: e.target.value }))}
                                />
                            </div>

                            <button
                                className="appointment-retro__submit appointment-retro__submit--full"
                                type="submit"
                                disabled={isSubmitting || !token || servicesLoading || !hasBookableServices}
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
                            Потрібно один раз підтвердити номер у Telegram. Після цього запис завершиться автоматично.
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
