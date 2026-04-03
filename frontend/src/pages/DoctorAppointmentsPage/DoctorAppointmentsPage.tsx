import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import { getAllAppointments } from '../../shared/api/appointmentApi';
import type { AppointmentItem } from '../../shared/api/appointmentApi';
import { getTokenPayload, getUserRole } from '../../shared/utils/authStorage';
import './DoctorAppointmentsPage.scss';

function fullName(a: AppointmentItem) {
    if (!a.patient) return 'Пацієнт не вказаний';
    return `${a.patient.lastName} ${a.patient.firstName}${a.patient.middleName ? ` ${a.patient.middleName}` : ''}`;
}

function formatDate(value: string | null) {
    if (!value) return 'Дата не вказана';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString('ua-UA');
}

function statusLabel(status: string) {
    const normalized = status.trim().toUpperCase();
    if (normalized === 'BOOKED') return 'Заплановано';
    if (normalized === 'CONFIRMED') return 'Підтверджено';
    if (normalized === 'DONE') return 'Завершено';
    if (normalized === 'CANCELLED') return 'Скасовано';
    return status;
}

export default function DoctorAppointmentsPage() {
    const role = getUserRole();
    const payload = getTokenPayload();
    const doctorUserId = payload?.sub || null;
    const isDoctor = role === 'DOCTOR';

    const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [error, setError] = useState('');

    const navigate = useNavigate();

    useEffect(() => {
        async function load() {
            if (!isDoctor || !doctorUserId) {
                setLoading(false);
                return;
            }

            try {
                const all = await getAllAppointments();
                const mine = all
                    .filter((a) => a.doctorId === doctorUserId)
                    .sort((a, b) => {
                        const ad = a.appointmentDate ? new Date(a.appointmentDate).getTime() : 0;
                        const bd = b.appointmentDate ? new Date(b.appointmentDate).getTime() : 0;
                        return bd - ad;
                    });

                setAppointments(mine);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Не вдалося завантажити записи');
            } finally {
                setLoading(false);
            }
        }

        void load();
    }, [isDoctor, doctorUserId]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return appointments;

        return appointments.filter((a) => {
            const name = fullName(a).toLowerCase();
            const phone = a.patient?.phone?.toLowerCase() || '';
            const date = formatDate(a.appointmentDate).toLowerCase();
            const recording = a.recordingCompleted ? 'запис завершено' : 'запис не завершено';
            return name.includes(q) || phone.includes(q) || date.includes(q) || recording.includes(q);
        });
    }, [appointments, search]);

    if (!isDoctor) {
        return (
            <div className="page-shell doctor-appointments-page">
                <div className="container doctor-appointments-page__container">
                    <section className="doctor-appointments-page__card">
                        <h1 className="doctor-appointments-page__title">МОЇ ЗАПИСИ</h1>
                        <div className="doctor-appointments-page__blocked">Ця сторінка доступна тільки для лікаря.</div>
                    </section>
                </div>
            </div>
        );
    }

    return (
        <div className="page-shell doctor-appointments-page">
            <div className="container doctor-appointments-page__container">
                <section className="doctor-appointments-page__card">
                    <h1 className="doctor-appointments-page__title">МОЇ ЗАПИСИ</h1>
                    <p className="doctor-appointments-page__subtitle">
                        Натисни на запис, щоб відкрити картку прийому та керувати відеофіксацією.
                    </p>

                    {error && (
                        <div className="doctor-appointments-page__top-alert">
                            <AlertToast message={error} variant="error" onClose={() => setError('')} />
                        </div>
                    )}

                    <input
                        className="doctor-appointments-page__search"
                        placeholder="Пошук по ПІБ, телефону, даті..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />

                    {loading ? (
                        <div className="doctor-appointments-page__state">Завантаження...</div>
                    ) : filtered.length === 0 ? (
                        <div className="doctor-appointments-page__state">Записів не знайдено.</div>
                    ) : (
                        <div className="doctor-appointments-page__list">
                            {filtered.map((a) => (
                                <button
                                    key={a.id}
                                    className="doctor-appointments-page__item"
                                    type="button"
                                    onClick={() => navigate(`/doctor/appointments/${a.id}`)}
                                >
                                    <div className="doctor-appointments-page__item-main">
                                        <h3>{fullName(a)}</h3>
                                        <p>{a.patient?.phone || 'Телефон не вказано'}</p>
                                        <p>{formatDate(a.appointmentDate)}</p>
                                    </div>

                                    <div className="doctor-appointments-page__item-status">
                                        <span className="doctor-appointments-page__status-pill">{statusLabel(a.status)}</span>
                                        <strong className={a.recordingCompleted ? 'is-done' : ''}>
                                            {a.recordingCompleted ? 'Запис завершено' : 'Запис не завершено'}
                                        </strong>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
