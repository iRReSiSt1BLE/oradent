import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import { buildDoctorAvatarUrl, getPublicDoctors, type PublicDoctorItem } from '../../shared/api/doctorApi';
import {
    getDoctorScheduleDay,
    getDoctorScheduleMonth,
    type DayScheduleResponse,
    type MonthDayCell,
} from '../../shared/api/doctorScheduleApi';
import { pickDoctorSpecialtyByLanguage } from '../../shared/i18n/doctorSpecialty';
import { useI18n } from '../../shared/i18n/I18nProvider';
import './DoctorSchedulePage.scss';

function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

type ViewDoctor = PublicDoctorItem & { fullName: string };

export default function DoctorSchedulePage() {
    const { doctorId } = useParams();
    const navigate = useNavigate();
    const { language } = useI18n();

    const [doctor, setDoctor] = useState<ViewDoctor | null>(null);
    const [month, setMonth] = useState(currentMonthKey());

    const [monthData, setMonthData] = useState<MonthDayCell[]>([]);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [dayData, setDayData] = useState<DayScheduleResponse | null>(null);

    const [loadingDoctor, setLoadingDoctor] = useState(true);
    const [loadingMonth, setLoadingMonth] = useState(false);
    const [loadingDay, setLoadingDay] = useState(false);

    const [error, setError] = useState('');

    useEffect(() => {
        async function initDoctor() {
            if (!doctorId) return;
            setLoadingDoctor(true);
            setError('');

            try {
                const doctorsRes = await getPublicDoctors();
                const d = doctorsRes.doctors.find((x) => x.id === doctorId || x.userId === doctorId) || null;

                if (!d) {
                    setError('Лікаря не знайдено');
                    setDoctor(null);
                    return;
                }

                setDoctor({
                    ...d,
                    fullName: `${d.lastName} ${d.firstName}${d.middleName ? ` ${d.middleName}` : ''}`,
                });
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Не вдалося завантажити лікаря');
            } finally {
                setLoadingDoctor(false);
            }
        }

        void initDoctor();
    }, [doctorId]);

    const scheduleDoctorId = doctor?.id || doctorId || '';

    useEffect(() => {
        async function loadMonth() {
            if (!scheduleDoctorId) return;
            setLoadingMonth(true);
            setError('');

            try {
                const m = await getDoctorScheduleMonth(scheduleDoctorId, month);
                setMonthData(m.days);

                if (selectedDate) {
                    const stillExists = m.days.some((d) => d.date === selectedDate);
                    if (!stillExists) {
                        setSelectedDate(null);
                        setDayData(null);
                    }
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Не вдалося оновити календар');
            } finally {
                setLoadingMonth(false);
            }
        }

        void loadMonth();
    }, [scheduleDoctorId, month]);

    useEffect(() => {
        async function loadDay() {
            if (!scheduleDoctorId || !selectedDate) return;
            setLoadingDay(true);
            setError('');

            try {
                const day = await getDoctorScheduleDay(scheduleDoctorId, selectedDate);
                setDayData(day);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Не вдалося завантажити день');
            } finally {
                setLoadingDay(false);
            }
        }

        void loadDay();
    }, [scheduleDoctorId, selectedDate]);

    const avatarSrc = useMemo(() => {
        if (!doctor?.hasAvatar) return '';
        return buildDoctorAvatarUrl(doctor.id, 'md', doctor.avatarVersion);
    }, [doctor]);

    const localizedSpecialties = useMemo(() => {
        if (!doctor) return [];
        return (doctor.specialties || [])
            .map((s) => pickDoctorSpecialtyByLanguage(s, language))
            .filter(Boolean);
    }, [doctor, language]);

    function goToAppointment(time: string) {
        if (!doctor || !selectedDate) return;
        navigate(
            `/appointment?doctorId=${encodeURIComponent(doctor.id)}&doctorUserId=${encodeURIComponent(
                doctor.userId || '',
            )}&doctorName=${encodeURIComponent(doctor.fullName)}&date=${encodeURIComponent(
                selectedDate,
            )}&time=${encodeURIComponent(time)}`,
        );
    }

    return (
        <div className="page-shell doctor-schedule-view">
            {error && (
                <div className="doctor-schedule-view__top-alert">
                    <AlertToast message={error} variant="error" onClose={() => setError('')} />
                </div>
            )}

            <div className="container doctor-schedule-view__container">
                <section className="doctor-schedule-view__card">
                    {loadingDoctor ? (
                        <div className="doctor-schedule-view__loading">Завантаження лікаря...</div>
                    ) : !doctor ? (
                        <div className="doctor-schedule-view__loading">Лікаря не знайдено</div>
                    ) : (
                        <>
                            <div className="doctor-schedule-view__doctor">
                                {doctor.hasAvatar ? (
                                    <img src={avatarSrc} alt={doctor.fullName} />
                                ) : (
                                    <div className="doctor-schedule-view__placeholder">
                                        {(doctor.lastName?.[0] || 'Л').toUpperCase()}
                                    </div>
                                )}

                                <div>
                                    <h1>{doctor.fullName}</h1>
                                    <p>
                                        {localizedSpecialties.length > 0
                                            ? localizedSpecialties.join(', ')
                                            : doctor.specialty || 'Лікар-стоматолог'}
                                    </p>
                                </div>
                            </div>

                            <div className="doctor-schedule-view__layout">
                                <div className="doctor-schedule-view__calendar">
                                    <div className="doctor-schedule-view__calendar-head">
                                        <h2>Календар</h2>
                                        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
                                    </div>

                                    {loadingMonth ? (
                                        <div className="doctor-schedule-view__state">Оновлення календаря...</div>
                                    ) : (
                                        <div className="doctor-schedule-view__month-grid">
                                            {monthData.map((d) => (
                                                <button
                                                    key={d.date}
                                                    type="button"
                                                    className={[
                                                        'doctor-schedule-view__day',
                                                        d.date === selectedDate ? 'is-selected' : '',
                                                        !d.isWorking ? 'is-off' : d.freeSlots > 0 ? 'is-free' : 'is-busy',
                                                    ].join(' ')}
                                                    onClick={() => setSelectedDate(d.date)}
                                                >
                                                    <span>{d.date.slice(-2)}</span>
                                                    <small>
                                                        {d.freeSlots}/{d.totalSlots}
                                                    </small>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="doctor-schedule-view__times">
                                    <div className="doctor-schedule-view__times-head">
                                        <h2>{selectedDate ? `Вільний час на ${selectedDate}` : 'Оберіть день'}</h2>
                                        {selectedDate && (
                                            <button
                                                type="button"
                                                className="doctor-schedule-view__back-day"
                                                onClick={() => {
                                                    setSelectedDate(null);
                                                    setDayData(null);
                                                }}
                                            >
                                                Повернутись до днів
                                            </button>
                                        )}
                                    </div>

                                    {!selectedDate ? (
                                        <div className="doctor-schedule-view__state">Оберіть дату в календарі, щоб побачити час</div>
                                    ) : loadingDay ? (
                                        <div className="doctor-schedule-view__state">Завантаження часу...</div>
                                    ) : !dayData?.isWorking ? (
                                        <div className="doctor-schedule-view__state">У цей день лікар не працює або день заблоковано</div>
                                    ) : (
                                        <div className="doctor-schedule-view__slots">
                                            {dayData.slots
                                                .filter((s) => s.state === 'FREE')
                                                .map((slot) => (
                                                    <button
                                                        key={slot.time}
                                                        type="button"
                                                        className="doctor-schedule-view__slot is-free"
                                                        onClick={() => goToAppointment(slot.time)}
                                                    >
                                                        {slot.time}
                                                    </button>
                                                ))}
                                        </div>
                                    )}

                                    {selectedDate && (
                                        <p className="doctor-schedule-view__hint">
                                            Після вибору часу Ви перейдете на запис із уже заповненими лікарем та датою.
                                        </p>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </section>
            </div>
        </div>
    );
}
