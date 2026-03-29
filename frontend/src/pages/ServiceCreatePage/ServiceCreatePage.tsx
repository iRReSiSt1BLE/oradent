import { useEffect, useMemo, useState } from 'react';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    createService,
    createServiceCategory,
    getAdminCategories,
    getDoctorsOptions,
    getPricingMeta,
} from '../../shared/api/servicesApi';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import { buildDoctorAvatarUrl } from '../../shared/api/doctorApi';
import './ServiceCreatePage.scss';

type DoctorOption = {
    id: string;
    email: string;
    fullName?: string;
    hasAvatar?: boolean;
    avatarVersion?: number;
};

const UUID_V4_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export default function ServiceCreatePage() {
    const token = getToken();
    const role = getUserRole();
    const isAllowed = role === 'ADMIN' || role === 'SUPER_ADMIN';

    const [categories, setCategories] = useState<
        Array<{ id: string; name: string; description: string | null; isActive: boolean; sortOrder: number }>
    >([]);
    const [doctors, setDoctors] = useState<DoctorOption[]>([]);

    const [pricing, setPricing] = useState<{ usdBuyRate: number; source: string; roundedTo: number } | null>(null);

    const [loading, setLoading] = useState(true);
    const [savingService, setSavingService] = useState(false);
    const [savingCategory, setSavingCategory] = useState(false);

    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const [preferredSize, setPreferredSize] = useState<'sm' | 'md' | 'lg'>('md');

    const [categoryForm, setCategoryForm] = useState({
        name: '',
        description: '',
        sortOrder: '0',
        isActive: true,
    });

    const [serviceForm, setServiceForm] = useState({
        name: '',
        description: '',
        durationMinutes: '30',
        priceUsd: '50',
        categoryId: '',
        isActive: true,
        doctorIds: [] as string[],
    });

    const previewUah = useMemo(() => {
        if (!pricing) return null;
        const usd = Number(serviceForm.priceUsd);
        if (!Number.isFinite(usd) || usd <= 0) return null;
        return Math.round((usd * pricing.usdBuyRate) / 10) * 10;
    }, [pricing, serviceForm.priceUsd]);

    useEffect(() => {
        setPreferredSize(detectPreferredSize());
        const onResize = () => setPreferredSize(detectPreferredSize());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    useEffect(() => {
        void bootstrap();
    }, []);

    async function bootstrap() {
        if (!token || !isAllowed) {
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const [categoriesRes, doctorsRes, pricingRes] = await Promise.all([
                getAdminCategories(token),
                getDoctorsOptions(token).catch(() => null),
                getPricingMeta(token).catch(() => null),
            ]);

            setCategories(categoriesRes.categories);

            if (doctorsRes && doctorsRes.doctors.length > 0) {
                setDoctors(doctorsRes.doctors);
            } else {
                setDoctors([]);
            }

            if (pricingRes?.pricing) {
                setPricing(pricingRes.pricing);
            }

            if (categoriesRes.categories.length > 0) {
                const firstActive = categoriesRes.categories.find((c) => c.isActive) || categoriesRes.categories[0];
                setServiceForm((prev) => ({ ...prev, categoryId: firstActive.id }));
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося завантажити дані');
        } finally {
            setLoading(false);
        }
    }

    function toggleDoctor(id: string) {
        setServiceForm((prev) => ({
            ...prev,
            doctorIds: prev.doctorIds.includes(id)
                ? prev.doctorIds.filter((x) => x !== id)
                : [...prev.doctorIds, id],
        }));
    }

    async function handleCreateCategory(e: React.FormEvent) {
        e.preventDefault();
        if (!token) return;

        const name = categoryForm.name.trim();
        const sortOrder = Number(categoryForm.sortOrder);

        if (!name) {
            setError('Вкажи назву категорії');
            return;
        }

        setSavingCategory(true);
        setError('');
        setMessage('');

        try {
            const result = await createServiceCategory(token, {
                name,
                description: categoryForm.description.trim() || undefined,
                sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
                isActive: categoryForm.isActive,
            });

            setCategories((prev) =>
                [...prev, result.category].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'uk')),
            );
            setCategoryForm({
                name: '',
                description: '',
                sortOrder: '0',
                isActive: true,
            });

            setServiceForm((prev) => ({
                ...prev,
                categoryId: prev.categoryId || result.category.id,
            }));

            setMessage(result.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося створити категорію');
        } finally {
            setSavingCategory(false);
        }
    }

    async function handleCreateService(e: React.FormEvent) {
        e.preventDefault();
        if (!token) return;

        const name = serviceForm.name.trim();
        const description = serviceForm.description.trim();
        const durationMinutes = Number(serviceForm.durationMinutes);
        const priceUsd = Number(serviceForm.priceUsd);

        if (!name) {
            setError('Вкажи назву послуги');
            return;
        }

        if (!serviceForm.categoryId) {
            setError('Обери категорію');
            return;
        }

        if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) {
            setError('Тривалість має бути від 5 до 480 хв');
            return;
        }

        if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
            setError('Ціна в USD має бути більшою за 0');
            return;
        }

        setSavingService(true);
        setError('');
        setMessage('');

        try {
            const result = await createService(token, {
                name,
                description: description || undefined,
                durationMinutes,
                priceUsd,
                categoryId: serviceForm.categoryId,
                isActive: serviceForm.isActive,
                doctorIds: serviceForm.doctorIds.filter((id) => UUID_V4_REGEX.test(id)),
            });

            setServiceForm({
                name: '',
                description: '',
                durationMinutes: '30',
                priceUsd: '50',
                categoryId: serviceForm.categoryId,
                isActive: true,
                doctorIds: [],
            });

            setMessage(
                `${result.message}. Ціна: $${result.service.priceUsd.toFixed(2)} ≈ ${Math.round(result.service.priceUah)} грн`,
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося створити послугу');
        } finally {
            setSavingService(false);
        }
    }

    return (
        <div className="page-shell service-create-page">
            <div className="container service-create-page__container">
                <div className="service-create-page__content">
                    {error && (
                        <div className="service-create-page__top-alert">
                            <AlertToast message={error} variant="error" onClose={() => setError('')} />
                        </div>
                    )}
                    {message && (
                        <div className="service-create-page__top-alert">
                            <AlertToast message={message} variant="success" onClose={() => setMessage('')} />
                        </div>
                    )}

                    {!isAllowed ? (
                        <section className="service-create-page__card">
                            <h1 className="service-create-page__title">ПОСЛУГИ</h1>
                            <div className="service-create-page__blocked">Доступно лише для ADMIN та SUPER_ADMIN.</div>
                        </section>
                    ) : loading ? (
                        <section className="service-create-page__card">
                            <div className="service-create-page__blocked">Завантаження...</div>
                        </section>
                    ) : (
                        <div className="service-create-page__stack">
                            <section className="service-create-page__card">
                                <h1 className="service-create-page__title">СТВОРЕННЯ КАТЕГОРІЇ</h1>

                                <form className="service-create-page__form" onSubmit={handleCreateCategory}>
                                    <div className="service-create-page__grid">
                                        <label className="service-create-page__field">
                                            <span>НАЗВА КАТЕГОРІЇ</span>
                                            <input
                                                value={categoryForm.name}
                                                onChange={(e) =>
                                                    setCategoryForm((prev) => ({ ...prev, name: e.target.value }))
                                                }
                                            />
                                        </label>

                                        <label className="service-create-page__field">
                                            <span>ПОРЯДОК</span>
                                            <input
                                                type="number"
                                                value={categoryForm.sortOrder}
                                                onChange={(e) =>
                                                    setCategoryForm((prev) => ({ ...prev, sortOrder: e.target.value }))
                                                }
                                            />
                                        </label>
                                    </div>

                                    <label className="service-create-page__field">
                                        <span>ОПИС КАТЕГОРІЇ</span>
                                        <textarea
                                            rows={3}
                                            value={categoryForm.description}
                                            onChange={(e) =>
                                                setCategoryForm((prev) => ({ ...prev, description: e.target.value }))
                                            }
                                        />
                                    </label>

                                    <label className="service-create-page__switch">
                                        <input
                                            type="checkbox"
                                            checked={categoryForm.isActive}
                                            onChange={(e) =>
                                                setCategoryForm((prev) => ({ ...prev, isActive: e.target.checked }))
                                            }
                                        />
                                        <span>АКТИВНА КАТЕГОРІЯ</span>
                                    </label>

                                    <button type="submit" className="service-create-page__submit" disabled={savingCategory}>
                                        {savingCategory ? 'СТВОРЕННЯ...' : 'СТВОРИТИ КАТЕГОРІЮ'}
                                    </button>
                                </form>
                            </section>

                            <section className="service-create-page__card">
                                <h2 className="service-create-page__title">СТВОРЕННЯ ПОСЛУГИ</h2>

                                <form className="service-create-page__form" onSubmit={handleCreateService}>
                                    <div className="service-create-page__grid">
                                        <label className="service-create-page__field">
                                            <span>НАЗВА ПОСЛУГИ</span>
                                            <input
                                                value={serviceForm.name}
                                                onChange={(e) =>
                                                    setServiceForm((prev) => ({ ...prev, name: e.target.value }))
                                                }
                                            />
                                        </label>

                                        <label className="service-create-page__field">
                                            <span>КАТЕГОРІЯ</span>
                                            <select
                                                value={serviceForm.categoryId}
                                                onChange={(e) =>
                                                    setServiceForm((prev) => ({ ...prev, categoryId: e.target.value }))
                                                }
                                            >
                                                <option value="">Оберіть категорію</option>
                                                {categories.map((category) => (
                                                    <option key={category.id} value={category.id}>
                                                        {category.name} {category.isActive ? '' : '(неактивна)'}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>

                                        <label className="service-create-page__field">
                                            <span>ТРИВАЛІСТЬ (ХВ)</span>
                                            <input
                                                type="number"
                                                min={5}
                                                max={480}
                                                value={serviceForm.durationMinutes}
                                                onChange={(e) =>
                                                    setServiceForm((prev) => ({
                                                        ...prev,
                                                        durationMinutes: e.target.value,
                                                    }))
                                                }
                                            />
                                        </label>

                                        <label className="service-create-page__field">
                                            <span>ЦІНА (USD)</span>
                                            <input
                                                type="number"
                                                min={1}
                                                step={0.01}
                                                value={serviceForm.priceUsd}
                                                onChange={(e) =>
                                                    setServiceForm((prev) => ({ ...prev, priceUsd: e.target.value }))
                                                }
                                            />
                                        </label>
                                    </div>

                                    {pricing && (
                                        <div className="service-create-page__pricing">
                                            Курс Monobank (buy): {pricing.usdBuyRate.toFixed(2)} грн за $1.
                                            Округлення: до {pricing.roundedTo} грн.
                                            {previewUah !== null && ` Попередня ціна: ~ ${previewUah} грн.`}
                                        </div>
                                    )}

                                    <label className="service-create-page__field">
                                        <span>ОПИС ПОСЛУГИ</span>
                                        <textarea
                                            rows={4}
                                            value={serviceForm.description}
                                            onChange={(e) =>
                                                setServiceForm((prev) => ({ ...prev, description: e.target.value }))
                                            }
                                        />
                                    </label>

                                    <div className="service-create-page__doctors">
                                        <div className="service-create-page__doctors-title">ПРИЗНАЧЕНІ ЛІКАРІ</div>

                                        <div className="service-create-page__doctor-list">
                                            {doctors.length === 0 ? (
                                                <div className="service-create-page__doctor-empty">
                                                    Активних лікарів ще немає. Спочатку створи лікарів.
                                                </div>
                                            ) : (
                                                doctors.map((doctor) => {
                                                    const checked = serviceForm.doctorIds.includes(doctor.id);
                                                    const hasAvatar = Boolean(doctor.hasAvatar);

                                                    const src = hasAvatar
                                                        ? buildDoctorAvatarUrl(doctor.id, preferredSize, doctor.avatarVersion)
                                                        : '';
                                                    const srcSet = hasAvatar
                                                        ? buildAvatarSrcSet(doctor.id, doctor.avatarVersion)
                                                        : '';

                                                    return (
                                                        <label
                                                            key={doctor.id}
                                                            className={`service-create-page__doctor-item ${checked ? 'is-checked' : ''}`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={() => toggleDoctor(doctor.id)}
                                                            />

                                                            <div className="service-create-page__doctor-avatar-wrap">
                                                                {hasAvatar ? (
                                                                    <img
                                                                        className="service-create-page__doctor-avatar"
                                                                        src={src}
                                                                        srcSet={srcSet}
                                                                        sizes="44px"
                                                                        alt=""
                                                                        loading="lazy"
                                                                        decoding="async"
                                                                    />
                                                                ) : (
                                                                    <div className="service-create-page__doctor-avatar-placeholder">
                                                                        {doctor.fullName?.trim()?.[0]?.toUpperCase() || 'L'}
                                                                    </div>
                                                                )}
                                                            </div>

                                                            <div className="service-create-page__doctor-text">
                                                                <span className="service-create-page__doctor-name">
                                                                    {doctor.fullName || doctor.email}
                                                                </span>
                                                                <span className="service-create-page__doctor-email">{doctor.email}</span>
                                                            </div>
                                                        </label>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>

                                    <label className="service-create-page__switch">
                                        <input
                                            type="checkbox"
                                            checked={serviceForm.isActive}
                                            onChange={(e) =>
                                                setServiceForm((prev) => ({ ...prev, isActive: e.target.checked }))
                                            }
                                        />
                                        <span>АКТИВНА ПОСЛУГА</span>
                                    </label>

                                    <button type="submit" className="service-create-page__submit" disabled={savingService}>
                                        {savingService ? 'СТВОРЕННЯ...' : 'СТВОРИТИ ПОСЛУГУ'}
                                    </button>
                                </form>
                            </section>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
