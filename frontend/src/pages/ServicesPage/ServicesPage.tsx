import { useEffect, useMemo, useState } from 'react';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    createService,
    getAllServices,
    getDoctorsOptions,
    toggleServiceActive,
    updateService,
} from '../../shared/api/servicesApi';
import type { ClinicService, ServiceDoctor } from '../../shared/api/servicesApi';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import './ServicesPage.scss';

type DoctorOption = ServiceDoctor & {
    isPlaceholder?: boolean;
};

const PLACEHOLDER_DOCTORS: DoctorOption[] = [
    { id: 'placeholder-1', email: 'Лікар #1 (заглушка)', isPlaceholder: true },
    { id: 'placeholder-2', email: 'Лікар #2 (заглушка)', isPlaceholder: true },
    { id: 'placeholder-3', email: 'Лікар #3 (заглушка)', isPlaceholder: true },
];

const UUID_V4_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeText(value: string) {
    return value.trim();
}

function sanitizeDoctorIds(ids: string[]) {
    return ids.filter((id) => UUID_V4_REGEX.test(id));
}

export default function ServicesPage() {
    const token = getToken();
    const role = getUserRole();
    const isAllowed = role === 'ADMIN' || role === 'SUPER_ADMIN';

    const [services, setServices] = useState<ClinicService[]>([]);
    const [doctors, setDoctors] = useState<DoctorOption[]>([]);
    const [doctorHint, setDoctorHint] = useState('');

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [togglingId, setTogglingId] = useState<string | null>(null);

    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const [form, setForm] = useState({
        name: '',
        description: '',
        durationMinutes: '30',
        isActive: true,
        doctorIds: [] as string[],
    });

    const [editing, setEditing] = useState<ClinicService | null>(null);
    const [editSaving, setEditSaving] = useState(false);
    const [editForm, setEditForm] = useState({
        name: '',
        description: '',
        durationMinutes: '30',
        isActive: true,
        doctorIds: [] as string[],
    });

    useEffect(() => {
        void loadData();
    }, []);

    async function loadData() {
        if (!token || !isAllowed) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError('');

        try {
            const [servicesRes, doctorsRes] = await Promise.all([
                getAllServices(token),
                getDoctorsOptions(token).catch(() => null),
            ]);

            setServices(servicesRes.services);

            if (doctorsRes && doctorsRes.doctors.length > 0) {
                setDoctors(doctorsRes.doctors);
                setDoctorHint('');
            } else {
                setDoctors(PLACEHOLDER_DOCTORS);
                setDoctorHint('Лікарі ще не додані. Поки працюють заглушки.');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося завантажити послуги');
        } finally {
            setLoading(false);
        }
    }

    const sortedServices = useMemo(
        () =>
            [...services].sort((a, b) =>
                a.name.localeCompare(b.name, 'uk', { sensitivity: 'base' }),
            ),
        [services],
    );

    function toggleDoctorSelection(id: string, fromEdit = false) {
        const isPlaceholder = doctors.some((d) => d.id === id && d.isPlaceholder);
        if (isPlaceholder) return;

        if (fromEdit) {
            setEditForm((prev) => ({
                ...prev,
                doctorIds: prev.doctorIds.includes(id)
                    ? prev.doctorIds.filter((x) => x !== id)
                    : [...prev.doctorIds, id],
            }));
            return;
        }

        setForm((prev) => ({
            ...prev,
            doctorIds: prev.doctorIds.includes(id)
                ? prev.doctorIds.filter((x) => x !== id)
                : [...prev.doctorIds, id],
        }));
    }

    async function handleCreateService(e: React.FormEvent) {
        e.preventDefault();
        if (!token) return;

        const name = normalizeText(form.name);
        const description = normalizeText(form.description);
        const durationMinutes = Number(form.durationMinutes);

        if (!name) {
            setError('Вкажи назву послуги');
            return;
        }

        if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) {
            setError('Тривалість має бути від 5 до 480 хв');
            return;
        }

        setSaving(true);
        setError('');
        setMessage('');

        try {
            const result = await createService(token, {
                name,
                description: description || undefined,
                durationMinutes,
                isActive: form.isActive,
                doctorIds: sanitizeDoctorIds(form.doctorIds),
            });

            setServices((prev) => [result.service, ...prev]);
            setForm({
                name: '',
                description: '',
                durationMinutes: '30',
                isActive: true,
                doctorIds: [],
            });
            setMessage(result.message || 'Послугу створено');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося створити послугу');
        } finally {
            setSaving(false);
        }
    }

    function openEditModal(service: ClinicService) {
        setEditing(service);
        setEditForm({
            name: service.name,
            description: service.description || '',
            durationMinutes: String(service.durationMinutes),
            isActive: service.isActive,
            doctorIds: service.doctorIds,
        });
        setError('');
        setMessage('');
    }

    function closeEditModal() {
        setEditing(null);
    }

    async function handleSaveEdit(e: React.FormEvent) {
        e.preventDefault();
        if (!token || !editing) return;

        const name = normalizeText(editForm.name);
        const description = normalizeText(editForm.description);
        const durationMinutes = Number(editForm.durationMinutes);

        if (!name) {
            setError('Вкажи назву послуги');
            return;
        }

        if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) {
            setError('Тривалість має бути від 5 до 480 хв');
            return;
        }

        setEditSaving(true);
        setError('');
        setMessage('');

        try {
            const result = await updateService(token, editing.id, {
                name,
                description: description || undefined,
                durationMinutes,
                isActive: editForm.isActive,
                doctorIds: sanitizeDoctorIds(editForm.doctorIds),
            });

            setServices((prev) =>
                prev.map((item) => (item.id === editing.id ? result.service : item)),
            );
            setMessage(result.message || 'Послугу оновлено');
            setEditing(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося оновити послугу');
        } finally {
            setEditSaving(false);
        }
    }

    async function handleToggleService(serviceId: string) {
        if (!token) return;

        setTogglingId(serviceId);
        setError('');
        setMessage('');

        try {
            const result = await toggleServiceActive(token, serviceId);
            setServices((prev) =>
                prev.map((item) => (item.id === serviceId ? result.service : item)),
            );
            setMessage(result.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося змінити статус послуги');
        } finally {
            setTogglingId(null);
        }
    }

    return (
        <div className="page-shell services-page">
            <div className="container services-page__container">
                <div className="services-page__content">
                    {error && (
                        <div className="services-page__top-alert">
                            <AlertToast message={error} variant="error" onClose={() => setError('')} />
                        </div>
                    )}
                    {message && (
                        <div className="services-page__top-alert">
                            <AlertToast message={message} variant="success" onClose={() => setMessage('')} />
                        </div>
                    )}

                    <section className="services-page__card">
                        <h1 className="services-page__title">ПОСЛУГИ</h1>
                        <p className="services-page__subtitle">
                            Створення, редагування, активація та призначення лікарів для послуг.
                        </p>

                        {!isAllowed ? (
                            <div className="services-page__blocked">Доступно лише для ADMIN та SUPER_ADMIN.</div>
                        ) : loading ? (
                            <div className="services-page__loading">Завантаження...</div>
                        ) : (
                            <>
                                <form className="services-page__form" onSubmit={handleCreateService}>
                                    <div className="services-page__grid">
                                        <label className="services-page__field">
                                            <span>НАЗВА ПОСЛУГИ</span>
                                            <input
                                                value={form.name}
                                                onChange={(e) =>
                                                    setForm((prev) => ({ ...prev, name: e.target.value }))
                                                }
                                            />
                                        </label>

                                        <label className="services-page__field">
                                            <span>ТРИВАЛІСТЬ (ХВ)</span>
                                            <input
                                                type="number"
                                                min={5}
                                                max={480}
                                                value={form.durationMinutes}
                                                onChange={(e) =>
                                                    setForm((prev) => ({
                                                        ...prev,
                                                        durationMinutes: e.target.value,
                                                    }))
                                                }
                                            />
                                        </label>
                                    </div>

                                    <label className="services-page__field">
                                        <span>ОПИС</span>
                                        <textarea
                                            rows={4}
                                            value={form.description}
                                            onChange={(e) =>
                                                setForm((prev) => ({ ...prev, description: e.target.value }))
                                            }
                                        />
                                    </label>

                                    <div className="services-page__doctors">
                                        <div className="services-page__doctors-title">ПРИЗНАЧЕНІ ЛІКАРІ</div>
                                        {doctorHint && (
                                            <div className="services-page__doctor-hint">{doctorHint}</div>
                                        )}

                                        <div className="services-page__doctor-list">
                                            {doctors.map((doctor) => (
                                                <label
                                                    key={doctor.id}
                                                    className={`services-page__doctor-item ${
                                                        doctor.isPlaceholder ? 'is-placeholder' : ''
                                                    }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={form.doctorIds.includes(doctor.id)}
                                                        onChange={() => toggleDoctorSelection(doctor.id)}
                                                        disabled={Boolean(doctor.isPlaceholder)}
                                                    />
                                                    <span>{doctor.email}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    <label className="services-page__switch">
                                        <input
                                            type="checkbox"
                                            checked={form.isActive}
                                            onChange={(e) =>
                                                setForm((prev) => ({ ...prev, isActive: e.target.checked }))
                                            }
                                        />
                                        <span>АКТИВНА ПОСЛУГА</span>
                                    </label>

                                    <button className="services-page__submit" type="submit" disabled={saving}>
                                        {saving ? 'СТВОРЕННЯ...' : 'СТВОРИТИ ПОСЛУГУ'}
                                    </button>
                                </form>

                                <div className="services-page__list">
                                    {sortedServices.map((service) => (
                                        <article key={service.id} className="services-page__item">
                                            <div className="services-page__item-main">
                                                <h3>
                                                    {service.name}
                                                    <span
                                                        className={`services-page__status-dot ${
                                                            service.isActive ? 'is-active' : 'is-inactive'
                                                        }`}
                                                    />
                                                </h3>
                                                <p>{service.description || 'Опис не вказано'}</p>
                                                <p>Тривалість: {service.durationMinutes} хв</p>
                                                <p>
                                                    Лікарів призначено: {service.doctorIds.length}
                                                </p>
                                            </div>

                                            <div className="services-page__item-actions">
                                                <button
                                                    type="button"
                                                    onClick={() => handleToggleService(service.id)}
                                                    disabled={togglingId === service.id}
                                                >
                                                    {togglingId === service.id
                                                        ? 'ОБРОБКА...'
                                                        : service.isActive
                                                            ? 'ДЕАКТИВУВАТИ'
                                                            : 'АКТИВУВАТИ'}
                                                </button>

                                                <button type="button" onClick={() => openEditModal(service)}>
                                                </button>
                                            </div>
                                        </article>
                                    ))}

                                    {!sortedServices.length && (
                                        <div className="services-page__empty">Послуг ще немає.</div>
                                    )}
                                </div>
                            </>
                        )}
                    </section>
                </div>
            </div>

            {editing && (
                <div className="services-page__modal-backdrop">
                    <form className="services-page__modal" onSubmit={handleSaveEdit}>
                        <h2>Редагування послуги</h2>

                        <label className="services-page__field">
                            <span>НАЗВА ПОСЛУГИ</span>
                            <input
                                value={editForm.name}
                                onChange={(e) =>
                                    setEditForm((prev) => ({ ...prev, name: e.target.value }))
                                }
                            />
                        </label>

                        <label className="services-page__field">
                            <span>ТРИВАЛІСТЬ (ХВ)</span>
                            <input
                                type="number"
                                min={5}
                                max={480}
                                value={editForm.durationMinutes}
                                onChange={(e) =>
                                    setEditForm((prev) => ({
                                        ...prev,
                                        durationMinutes: e.target.value,
                                    }))
                                }
                            />
                        </label>

                        <label className="services-page__field">
                            <span>ОПИС</span>
                            <textarea
                                rows={4}
                                value={editForm.description}
                                onChange={(e) =>
                                    setEditForm((prev) => ({ ...prev, description: e.target.value }))
                                }
                            />
                        </label>

                        <div className="services-page__doctors">
                            <div className="services-page__doctors-title">ПРИЗНАЧЕНІ ЛІКАРІ</div>
                            {doctorHint && <div className="services-page__doctor-hint">{doctorHint}</div>}
                            <div className="services-page__doctor-list">
                                {doctors.map((doctor) => (
                                    <label
                                        key={doctor.id}
                                        className={`services-page__doctor-item ${
                                            doctor.isPlaceholder ? 'is-placeholder' : ''
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={editForm.doctorIds.includes(doctor.id)}
                                            onChange={() => toggleDoctorSelection(doctor.id, true)}
                                            disabled={Boolean(doctor.isPlaceholder)}
                                        />
                                        <span>{doctor.email}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <label className="services-page__switch">
                            <input
                                type="checkbox"
                                checked={editForm.isActive}
                                onChange={(e) =>
                                    setEditForm((prev) => ({ ...prev, isActive: e.target.checked }))
                                }
                            />
                            <span>АКТИВНА ПОСЛУГА</span>
                        </label>

                        <div className="services-page__modal-actions">
                            <button type="button" onClick={closeEditModal}>
                                СКАСУВАТИ
                            </button>
                            <button type="submit" disabled={editSaving}>
                                {editSaving ? 'ЗБЕРЕЖЕННЯ...' : 'ЗБЕРЕГТИ'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}
