import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    createAuthenticatedAppointment,
    createGuestAppointment,
} from '../../shared/api/appointmentApi';
import {
    getPublicDoctors,
    type PublicDoctorItem,
} from '../../shared/api/doctorApi';
import {
    getActivePublicServices,
    type ClinicService,
} from '../../shared/api/servicesApi';
import { getToken } from '../../shared/utils/authStorage';
import { useI18n } from '../../shared/i18n/I18nProvider';
import './AppointmentPage.scss';

type Mode = 'guest' | 'authenticated';

type AlertState = {
    variant: 'success' | 'error' | 'info';
    message: string;
} | null;

function fullDoctorName(d: PublicDoctorItem | null): string {
    if (!d) return '';
    const name = `${d.lastName ?? ''} ${d.firstName ?? ''} ${d.middleName ?? ''}`
        .replace(/\s+/g, ' ')
        .trim();

    return name || d.userId || d.id;
}

function normalizeScheduleDateTime(date: string, time: string): string {
    if (!date || !time) return '';
    return `${date}T${time.slice(0, 5)}`;
}

function toIso(dateTimeLocal: string): string {
    if (!dateTimeLocal) return '';
    return new Date(dateTimeLocal).toISOString();
}

function resolveDoctorByAnyId(
    id: string,
    doctors: PublicDoctorItem[],
): PublicDoctorItem | null {
    if (!id) return null;
    return doctors.find((d) => d.id === id || d.userId === id) ?? null;
}

function parseDbI18nValue(raw: unknown, language: string): string {
    if (!raw) return '';

    if (typeof raw === 'object' && raw !== null) {
        const record = raw as Record<string, any>;

        if ('ua' in record || 'en' in record || 'de' in record || 'fr' in record) {
            return record[language] || record.ua || record.en || record.de || record.fr || '';
        }

        if ('i18n' in record && record.i18n && typeof record.i18n === 'object') {
            const map = record.i18n as Record<string, string>;
            return map[language] || map.ua || map.en || map.de || map.fr || '';
        }

        if ('value' in record && typeof record.value === 'string') {
            return record.value;
        }

        if ('name' in record) {
            return parseDbI18nValue(record.name, language);
        }

        if ('data' in record && record.data && typeof record.data === 'object') {
            return (
                record.data[language] ||
                record.data.ua ||
                record.data.en ||
                record.data.de ||
                record.data.fr ||
                ''
            );
        }

        return '';
    }

    if (typeof raw === 'string') {
        if (!raw.includes('__ORADENT_I18N__')) {
            return raw;
        }

        try {
            const start = raw.indexOf('{');
            if (start === -1) return raw;

            const parsed = JSON.parse(raw.slice(start));
            const data = parsed?.data;

            if (data && typeof data === 'object') {
                return data[language] || data.ua || data.en || data.de || data.fr || raw;
            }

            return raw;
        } catch {
            return raw;
        }
    }

    return String(raw);
}

function serviceLabel(service: ClinicService, language: string): string {
    const name = parseDbI18nValue((service as any).name, language) || 'Послуга';
    const minutes = Number((service as any).durationMinutes || 0);
    return `${name} (${minutes} хв)`;
}

export default function AppointmentPage() {
    const token = getToken();
    const location = useLocation();
    const { language } = useI18n();

    const params = new URLSearchParams(location.search);

    const paramDoctorId = (params.get('doctorId') || '').trim();
    const paramDoctorUserId = (params.get('doctorUserId') || '').trim();
    const paramDate = (params.get('date') || '').trim();
    const paramTime = (params.get('time') || '').trim();
    const paramDoctorName = (params.get('doctorName') || '').trim();

    const isFromSchedule = Boolean(
        (paramDoctorId || paramDoctorUserId) && paramDate && paramTime,
    );

    const [mode, setMode] = useState<Mode>(token ? 'authenticated' : 'guest');

    const [lastName, setLastName] = useState('');
    const [firstName, setFirstName] = useState('');
    const [middleName, setMiddleName] = useState('');
    const [phone, setPhone] = useState('');

    const [doctorId, setDoctorId] = useState(paramDoctorUserId || paramDoctorId);
    const [serviceId, setServiceId] = useState('');
    const [dateTime, setDateTime] = useState('');

    const [doctors, setDoctors] = useState<PublicDoctorItem[]>([]);
    const [services, setServices] = useState<ClinicService[]>([]);

    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [alert, setAlert] = useState<AlertState>(null);

    const selectedDoctor = useMemo(() => {
        const ref = isFromSchedule ? paramDoctorUserId || paramDoctorId : doctorId;
        if (!ref) return null;
        return resolveDoctorByAnyId(ref, doctors);
    }, [doctors, doctorId, isFromSchedule, paramDoctorId, paramDoctorUserId]);

    const bookingDoctorUserId = useMemo(() => {
        if (selectedDoctor?.userId) return selectedDoctor.userId;

        const byParam = resolveDoctorByAnyId(paramDoctorUserId || paramDoctorId, doctors);
        if (byParam?.userId) return byParam.userId;

        const bySelect = resolveDoctorByAnyId(doctorId, doctors);
        return bySelect?.userId || '';
    }, [selectedDoctor, paramDoctorId, paramDoctorUserId, doctorId, doctors]);

    const filteredServices = useMemo(() => {
        if (!services.length) return [];
        if (!bookingDoctorUserId) return services;

        const byDoctor = services.filter((service) => {
            const fromDoctorIds = Array.isArray((service as any).doctorIds)
                ? ((service as any).doctorIds as string[]).filter(Boolean)
                : [];

            const fromDoctors = Array.isArray((service as any).doctors)
                ? ((service as any).doctors as Array<Record<string, any>>)
                    .map((doctor) => doctor?.userId || doctor?.id || '')
                    .filter(Boolean)
                : [];

            const allRefs = [...fromDoctorIds, ...fromDoctors];
            if (!allRefs.length) return true;

            return allRefs.includes(bookingDoctorUserId);
        });

        return byDoctor.length ? byDoctor : services;
    }, [services, bookingDoctorUserId]);

    const lockedDoctorLabel = useMemo(() => {
        if (selectedDoctor) return fullDoctorName(selectedDoctor);
        if (paramDoctorName) return paramDoctorName;
        if (paramDoctorUserId) return paramDoctorUserId;
        if (paramDoctorId) return paramDoctorId;
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

            const doctorsList = Array.isArray((doctorsRes as any)?.doctors)
                ? (doctorsRes as any).doctors
                : Array.isArray(doctorsRes)
                    ? (doctorsRes as any)
                    : [];

            const servicesList = Array.isArray((servicesRes as any)?.services)
                ? (servicesRes as any).services
                : Array.isArray(servicesRes)
                    ? (servicesRes as any)
                    : [];

            setDoctors(doctorsList);
            setServices(servicesList);

            if (isFromSchedule) {
                const match = resolveDoctorByAnyId(
                    paramDoctorUserId || paramDoctorId,
                    doctorsList,
                );
                setDoctorId(match?.userId || paramDoctorUserId || paramDoctorId);
                setDateTime(normalizeScheduleDateTime(paramDate, paramTime));
            } else if (!doctorId && doctorsList.length) {
                setDoctorId(doctorsList[0].userId || doctorsList[0].id);
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
        if (!filteredServices.some((service) => service.id === serviceId)) {
            setServiceId('');
        }
    }, [filteredServices, serviceId]);

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();

        const finalDateTime = isFromSchedule
            ? normalizeScheduleDateTime(paramDate, paramTime)
            : dateTime;

        if (!bookingDoctorUserId) {
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
                    doctorId: bookingDoctorUserId,
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
                    doctorId: bookingDoctorUserId,
                    serviceId,
                    appointmentDate: toIso(finalDateTime),
                    phoneVerificationSessionId: undefined,
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
                            Гість підтверджує номер кожного разу. Авторизований користувач — тільки під час першого запису.
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
                                <input
                                    className="appointment-page__input"
                                    value={lastName}
                                    onChange={(e) => setLastName(e.target.value)}
                                    placeholder="Прізвище"
                                />
                            </label>

                            <label className="appointment-page__field">
                                <span>ІМ'Я</span>
                                <input
                                    className="appointment-page__input"
                                    value={firstName}
                                    onChange={(e) => setFirstName(e.target.value)}
                                    placeholder="Ім'я"
                                />
                            </label>

                            <label className="appointment-page__field appointment-page__field--full">
                                <span>ПО БАТЬКОВІ</span>
                                <input
                                    className="appointment-page__input"
                                    value={middleName}
                                    onChange={(e) => setMiddleName(e.target.value)}
                                    placeholder="По батькові"
                                />
                            </label>

                            <label className="appointment-page__field appointment-page__field--full">
                                <span>ТЕЛЕФОН</span>
                                <input
                                    className="appointment-page__input"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    placeholder="+380..."
                                />
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
                                    {doctors.map((doctor) => (
                                        <option key={doctor.id} value={doctor.userId || doctor.id}>
                                            {fullDoctorName(doctor)}
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
                                {filteredServices.map((service) => (
                                    <option key={service.id} value={service.id}>
                                        {serviceLabel(service, language)}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <button
                        className="appointment-page__submit"
                        type="submit"
                        disabled={submitting || loading}
>
                        {submitting ? <span className="appointment-page__spinner" /> : null}
                        {submitting ? 'ЗАПИС...' : 'ЗАПИСАТИСЯ НА ПРИЙОМ'}
                    </button>
                </form>
            </div>
        </section>
    );
}