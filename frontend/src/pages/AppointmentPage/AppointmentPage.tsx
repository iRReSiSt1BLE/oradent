import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import { createAuthenticatedAppointment, createGuestAppointment } from '../../shared/api/appointmentApi';
import { getPublicDoctors, type PublicDoctorItem } from '../../shared/api/doctorApi';
import { getActivePublicServices, type ClinicService } from '../../shared/api/servicesApi';
import { getToken } from '../../shared/utils/authStorage';
import './AppointmentPage.scss';

type Mode = 'guest' | 'authenticated';

type AlertState = {
    variant: 'success' | 'error' | 'info';
    message: string;
} | null;

function fullDoctorName(d: PublicDoctorItem | null): string {
    if (!d) return '';
    return `${d.lastName ?? ''} ${d.firstName ?? ''} ${d.middleName ?? ''}`.replace(/\s+/g, ' ').trim();
}

function normalizeScheduleDateTime(date: string, time: string): string {
    if (!date || !time) return '';
    return `${date}T${time.slice(0, 5)}`;
}

function toIso(dateTimeLocal: string): string {
    if (!dateTimeLocal) return '';
    return new Date(dateTimeLocal).toISOString();
}

function resolveDoctorByAnyId(id: string, doctors: PublicDoctorItem[]): PublicDoctorItem | null {
    if (!id) return null;
    return doctors.find((d) => d.id === id || d.userId === id) ?? null;
}

export default function AppointmentPage() {
    const token = getToken();
    const location = useLocation();
    const params = new URLSearchParams(location.search);

    const paramDoctorId = (params.get('doctorId') || '').trim();
    const paramDoctorUserId = (params.get('doctorUserId') || '').trim();
    const paramDate = (params.get('date') || '').trim();
    const paramTime = (params.get('time') || '').trim();
    const paramDoctorName = (params.get('doctorName') || '').trim();

    const isFromSchedule = Boolean((paramDoctorId || paramDoctorUserId) && paramDate && paramTime);

    const [mode, setMode] = useState<Mode>(token ? 'authenticated' : 'guest');

    const [lastName, setLastName] = useState('');
    const [firstName, setFirstName] = useState('');
    const [middleName, setMiddleName] = useState('');
    const [phone, setPhone] = useState('');

    const [doctorId, setDoctorId] = useState(paramDoctorId || paramDoctorUserId);
    const [serviceId, setServiceId] = useState('');
    const [dateTime, setDateTime] = useState('');

    const [doctors, setDoctors] = useState<PublicDoctorItem[]>([]);
    const [services, setServices] = useState<ClinicService[]>([]);

    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [alert, setAlert] = useState<AlertState>(null);

    const selectedDoctor = useMemo(() => {
        const ref = isFromSchedule ? (paramDoctorId || paramDoctorUserId) : doctorId;
        return resolveDoctorByAnyId(ref, doctors);
    }, [doctors, doctorId, isFromSchedule, paramDoctorId, paramDoctorUserId]);

    const bookingDoctorId = useMemo(() => {
        if (selectedDoctor?.id) return selectedDoctor.id;
        return paramDoctorId || doctorId || '';
    }, [selectedDoctor, paramDoctorId, doctorId]);

    const filteredServices = useMemo(() => {
        if (!selectedDoctor) return services;

        const doctorSpecialties = Array.isArray(selectedDoctor.specialties)
            ? selectedDoctor.specialties.map((s) => s.trim().toLowerCase())
            : selectedDoctor.specialty
                ? [selectedDoctor.specialty.trim().toLowerCase()]
                : [];

        if (!doctorSpecialties.length) return services;

        const matched = services.filter((service) => {
            if (!service.specialties?.length) return true;

            return service.specialties.some((specialty) =>
                doctorSpecialties.includes(specialty.name.trim().toLowerCase()),
            );
        });

        return matched.length > 0 ? matched : services;
    }, [services, selectedDoctor]);

    const lockedDoctorLabel = useMemo(() => {
        if (selectedDoctor) return fullDoctorName(selectedDoctor);
        if (paramDoctorName) return paramDoctorName;
        if (paramDoctorId) return paramDoctorId;
        if (paramDoctorUserId) return paramDoctorUserId;
        return 'Обраний лікар';
    }, [selectedDoctor, paramDoctorName, paramDoctorId, paramDoctorUserId]);

    function showError(message: string) {
        setAlert({ variant: 'error', message });
    }

    function showSuccess(message: string) {
        setAlert({ variant: 'success', message });
    }

    async function loadInitialData() {
        try {
            setLoading(true);

            const [doctorsRes, servicesRes] = await Promise.all([
                getPublicDoctors(),
                getActivePublicServices(),
            ]);

            const doctorsList = Array.isArray(doctorsRes?.doctors) ? doctorsRes.doctors : [];
            const servicesList = Array.isArray(servicesRes?.services) ? servicesRes.services : [];

            setDoctors(doctorsList);
            setServices(servicesList);

            if (isFromSchedule) {
                const match = resolveDoctorByAnyId(paramDoctorId || paramDoctorUserId, doctorsList);
                setDoctorId(match?.id || paramDoctorId || paramDoctorUserId);
                setDateTime(normalizeScheduleDateTime(paramDate, paramTime));
            } else if (!doctorId && doctorsList.length > 0) {
                setDoctorId(doctorsList[0].id);
            }
        } catch {
            showError('Не вдалося завантажити дані для запису');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadInitialData();
    }, []);

    useEffect(() => {
        if (!serviceId) return;
        if (!filteredServices.some((s) => s.id === serviceId)) {
            setServiceId('');
        }
    }, [filteredServices, serviceId]);

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();

        const finalDateTime = isFromSchedule
            ? normalizeScheduleDateTime(paramDate, paramTime)
            : dateTime;

        if (!bookingDoctorId) {
            showError('Оберіть лікаря');
            return;
        }

        if (!serviceId) {
            showError('Оберіть послугу');
            return;
        }

        if (!finalDateTime) {
            showError('Оберіть дату та час');
            return;
        }

        try {
            setSubmitting(true);

            if (mode === 'authenticated') {
                if (!token) {
                    showError('Потрібна авторизація');
                    return;
                }

                await createAuthenticatedAppointment(token, {
                    doctorId: bookingDoctorId,
                    serviceId,
                    appointmentDate: toIso(finalDateTime),
                });
            } else {
                if (!lastName.trim() || !firstName.trim() || !phone.trim()) {
                    showError('Заповніть ПІБ і телефон');
                    return;
                }

                await createGuestAppointment({
                    lastName: lastName.trim(),
                    firstName: firstName.trim(),
                    middleName: middleName.trim() || undefined,
                    phone: phone.trim(),
                    doctorId: bookingDoctorId,
                    serviceId,
                    appointmentDate: toIso(finalDateTime),
                    phoneVerificationSessionId: undefined as unknown as string,
                });
            }

            showSuccess('Ви успішно записались на прийом');
        } catch (err: any) {
            showError(err?.message || 'Не вдалося створити запис');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <section className="appointment-page">
            {alert && (
                <AlertToast
                    variant={alert.variant}
                    message={alert.message}
                    onClose={() => setAlert(null)}
                />
            )}

            <div className="appointment-page__card">
                <div className="appointment-page__header">
                    <div>
                        <h1 className="appointment-page__title">ЗАПИС НА ПРИЙОМ</h1>
                        <p className="appointment-page__subtitle">
                            Оберіть послугу та час. Якщо Ви прийшли зі сторінки графіка, лікар і дата вже будуть підставлені.
                        </p>
                    </div>

                    <div className="appointment-page__modes">
                        <button
                            type="button"
                            className={`appointment-page__mode ${mode === 'guest' ? 'is-active' : ''}`}
                            onClick={() => setMode('guest')}
                        >
                            ГІСТЬ
                        </button>
                        <button
                            type="button"
                            className={`appointment-page__mode ${mode === 'authenticated' ? 'is-active' : ''}`}
                            onClick={() => setMode('authenticated')}
                        >
                            АВТОРИЗОВАНИЙ
                        </button>
                    </div>
                </div>

                {isFromSchedule && (
                    <div className="appointment-page__locked">
                        <h3>ВИБРАНО ІЗ ГРАФІКА ЛІКАРЯ</h3>
                        <p><strong>Лікар:</strong> {lockedDoctorLabel}</p>
                        <p><strong>Дата та час:</strong> {paramDate} {paramTime.slice(0, 5)}</p>
                    </div>
                )}

                <form className="appointment-page__form" onSubmit={handleSubmit}>
                    {mode === 'guest' && (
                        <div className="appointment-page__grid">
                            <label className="appointment-page__field">
                                <span>ПРІЗВИЩЕ</span>
                                <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Прізвище" />
                            </label>

                            <label className="appointment-page__field">
                                <span>ІМ'Я</span>
                                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Ім'я" />
                            </label>

                            <label className="appointment-page__field appointment-page__field--full">
                                <span>ПО БАТЬКОВІ</span>
                                <input value={middleName} onChange={(e) => setMiddleName(e.target.value)} placeholder="По батькові" />
                            </label>

                            <label className="appointment-page__field appointment-page__field--full">
                                <span>ТЕЛЕФОН</span>
                                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+380..." />
                            </label>
                        </div>
                    )}

                    {!isFromSchedule && (
                        <div className="appointment-page__grid appointment-page__grid--selectors">
                            <label className="appointment-page__field">
                                <span>ЛІКАР</span>
                                <select
                                    className="appointment-page__select"
                                    value={doctorId}
                                    onChange={(e) => setDoctorId(e.target.value)}
                                    disabled={loading}
                                >
                                    <option value="">Оберіть лікаря</option>
                                    {doctors.map((d) => (
                                        <option key={d.id} value={d.id}>
                                            {fullDoctorName(d)}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="appointment-page__field">
                                <span>ДАТА ТА ЧАС</span>
                                <input
                                    className="appointment-page__input"
                                    type="datetime-local"
                                    value={dateTime}
                                    onChange={(e) => setDateTime(e.target.value)}
                                />
                            </label>
                        </div>
                    )}

                    <div className="appointment-page__grid appointment-page__grid--selectors">
                        <label className="appointment-page__field appointment-page__field--full">
                            <span>ПОСЛУГА</span>
                            <select
                                className="appointment-page__select"
                                value={serviceId}
                                onChange={(e) => setServiceId(e.target.value)}
                                disabled={loading}
                            >
                                <option value="">Оберіть послугу</option>
                                {filteredServices.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name} ({s.durationMinutes} хв, {s.priceUah} грн)
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <button className="appointment-page__submit" type="submit" disabled={submitting || loading}>
                        {submitting ? 'ЗАПИС...' : 'ЗАПИСАТИСЯ НА ПРИЙОМ'}
                    </button>
                </form>
            </div>
        </section>
    );
}