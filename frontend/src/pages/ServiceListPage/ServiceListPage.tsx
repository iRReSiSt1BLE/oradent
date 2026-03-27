import { useEffect, useMemo, useState } from 'react';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    getAdminCategories,
    getAdminServices,
    refreshServicesPricing,
    toggleCategoryActive,
    toggleServiceActive,
    updateService,
    updateServiceCategory,
} from '../../shared/api/servicesApi';
import type { ClinicService, ServiceCategory } from '../../shared/api/servicesApi';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import './ServiceListPage.scss';

export default function ServiceListPage() {
    const token = getToken();
    const role = getUserRole();
    const isAllowed = role === 'ADMIN' || role === 'SUPER_ADMIN';

    const [services, setServices] = useState<ClinicService[]>([]);
    const [categories, setCategories] = useState<ServiceCategory[]>([]);
    const [pricingRate, setPricingRate] = useState<number | null>(null);

    const [loading, setLoading] = useState(true);
    const [togglingServiceId, setTogglingServiceId] = useState<string | null>(null);
    const [togglingCategoryId, setTogglingCategoryId] = useState<string | null>(null);
    const [repriceLoading, setRepriceLoading] = useState(false);
    const [savingEdit, setSavingEdit] = useState(false);

    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const [editingService, setEditingService] = useState<ClinicService | null>(null);
    const [editForm, setEditForm] = useState({
        name: '',
        description: '',
        durationMinutes: '30',
        priceUsd: '0',
        categoryId: '',
        isActive: true,
    });

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
            const [servicesRes, categoriesRes] = await Promise.all([
                getAdminServices(token),
                getAdminCategories(token),
            ]);

            setServices(servicesRes.services);
            setCategories(categoriesRes.categories);
            setPricingRate(servicesRes.pricing?.usdBuyRate ?? null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося завантажити послуги');
        } finally {
            setLoading(false);
        }
    }

    const grouped = useMemo(() => {
        const sortedCategories = [...categories].sort(
            (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'uk'),
        );

        return sortedCategories.map((category) => ({
            category,
            services: services
                .filter((service) => service.categoryId === category.id)
                .sort((a, b) => a.name.localeCompare(b.name, 'uk')),
        }));
    }, [categories, services]);

    function openEdit(service: ClinicService) {
        setEditingService(service);
        setEditForm({
            name: service.name,
            description: service.description || '',
            durationMinutes: String(service.durationMinutes),
            priceUsd: String(service.priceUsd),
            categoryId: service.categoryId,
            isActive: service.isActive,
        });
    }

    async function handleSaveEdit(e: React.FormEvent) {
        e.preventDefault();
        if (!token || !editingService) return;

        const name = editForm.name.trim();
        const description = editForm.description.trim();
        const durationMinutes = Number(editForm.durationMinutes);
        const priceUsd = Number(editForm.priceUsd);

        if (!name) {
            setError('Вкажи назву');
            return;
        }
        if (!editForm.categoryId) {
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

        setSavingEdit(true);
        setError('');
        setMessage('');

        try {
            const result = await updateService(token, editingService.id, {
                name,
                description: description || undefined,
                durationMinutes,
                priceUsd,
                categoryId: editForm.categoryId,
                isActive: editForm.isActive,
            });

            setServices((prev) => prev.map((s) => (s.id === editingService.id ? result.service : s)));
            setEditingService(null);
            setMessage(result.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося оновити послугу');
        } finally {
            setSavingEdit(false);
        }
    }

    async function handleToggleService(serviceId: string) {
        if (!token) return;
        setTogglingServiceId(serviceId);
        setError('');
        setMessage('');

        try {
            const result = await toggleServiceActive(token, serviceId);
            setServices((prev) => prev.map((s) => (s.id === serviceId ? result.service : s)));
            setMessage(result.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося змінити статус послуги');
        } finally {
            setTogglingServiceId(null);
        }
    }

    async function handleToggleCategory(categoryId: string) {
        if (!token) return;
        setTogglingCategoryId(categoryId);
        setError('');
        setMessage('');

        try {
            const result = await toggleCategoryActive(token, categoryId);
            setCategories((prev) => prev.map((c) => (c.id === categoryId ? result.category : c)));
            setMessage(result.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося змінити статус категорії');
        } finally {
            setTogglingCategoryId(null);
        }
    }

    async function handleRenameCategory(category: ServiceCategory) {
        if (!token) return;
        const name = window.prompt('Нова назва категорії', category.name);
        if (!name || !name.trim()) return;

        setError('');
        setMessage('');

        try {
            const result = await updateServiceCategory(token, category.id, { name: name.trim() });
            setCategories((prev) => prev.map((c) => (c.id === category.id ? result.category : c)));
            setMessage(result.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося оновити категорію');
        }
    }

    async function handleRefreshPrices() {
        if (!token) return;

        setRepriceLoading(true);
        setError('');
        setMessage('');

        try {
            const result = await refreshServicesPricing(token);
            setPricingRate(result.pricing.usdBuyRate);
            const servicesRes = await getAdminServices(token);
            setServices(servicesRes.services);
            setMessage(result.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося оновити ціни');
        } finally {
            setRepriceLoading(false);
        }
    }

    return (
        <div className="page-shell service-list-page">
            <div className="container service-list-page__container">
                <div className="service-list-page__content">
                    {error && (
                        <div className="service-list-page__top-alert">
                            <AlertToast message={error} variant="error" onClose={() => setError('')} />
                        </div>
                    )}
                    {message && (
                        <div className="service-list-page__top-alert">
                            <AlertToast message={message} variant="success" onClose={() => setMessage('')} />
                        </div>
                    )}

                    {!isAllowed ? (
                        <section className="service-list-page__card">
                            <h1 className="service-list-page__title">ПОСЛУГИ</h1>
                            <div className="service-list-page__blocked">Доступно лише для ADMIN та SUPER_ADMIN.</div>
                        </section>
                    ) : loading ? (
                        <section className="service-list-page__card">
                            <div className="service-list-page__blocked">Завантаження...</div>
                        </section>
                    ) : (
                        <section className="service-list-page__card">
                            <div className="service-list-page__head">
                                <div>
                                    <h1 className="service-list-page__title">ПОСЛУГИ</h1>
                                    <p className="service-list-page__subtitle">
                                        Перегляд, редагування, активація та категорії послуг.
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    className="service-list-page__reprice-btn"
                                    onClick={handleRefreshPrices}
                                    disabled={repriceLoading}
                                >
                                    {repriceLoading ? 'ОНОВЛЕННЯ...' : 'ОНОВИТИ ЦІНИ ПО КУРСУ'}
                                </button>
                            </div>

                            {pricingRate !== null && (
                                <div className="service-list-page__pricing-info">
                                    Поточний курс buy: {pricingRate.toFixed(2)} грн / $1, округлення до 10 грн.
                                </div>
                            )}

                            <div className="service-list-page__categories">
                                {grouped.map(({ category, services: categoryServices }) => (
                                    <div className="service-list-page__category" key={category.id}>
                                        <div className="service-list-page__category-head">
                                            <h2>
                                                {category.name}
                                                <span className={`service-list-page__dot ${category.isActive ? 'is-active' : 'is-inactive'}`} />
                                            </h2>
                                            <div className="service-list-page__category-actions">
                                                <button
                                                    type="button"
                                                    onClick={() => handleRenameCategory(category)}
                                                >
                                                    РЕДАГУВАТИ
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleToggleCategory(category.id)}
                                                    disabled={togglingCategoryId === category.id}
                                                >
                                                    {togglingCategoryId === category.id
                                                        ? 'ОБРОБКА...'
                                                        : category.isActive
                                                            ? 'ДЕАКТИВУВАТИ'
                                                            : 'АКТИВУВАТИ'}
                                                </button>
                                            </div>
                                        </div>

                                        {category.description && (
                                            <p className="service-list-page__category-description">{category.description}</p>
                                        )}

                                        <div className="service-list-page__service-list">
                                            {categoryServices.map((service) => (
                                                <article className="service-list-page__service-item" key={service.id}>
                                                    <div className="service-list-page__service-main">
                                                        <h3>
                                                            {service.name}
                                                            <span className={`service-list-page__dot ${service.isActive ? 'is-active' : 'is-inactive'}`} />
                                                        </h3>
                                                        <p>{service.description || 'Опис не вказано'}</p>
                                                        <p>
                                                            {service.durationMinutes} хв · ${service.priceUsd.toFixed(2)} · {Math.round(service.priceUah)} грн
                                                        </p>
                                                    </div>

                                                    <div className="service-list-page__service-actions">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleToggleService(service.id)}
                                                            disabled={togglingServiceId === service.id}
                                                        >
                                                            {togglingServiceId === service.id
                                                                ? 'ОБРОБКА...'
                                                                : service.isActive
                                                                    ? 'ДЕАКТИВУВАТИ'
                                                                    : 'АКТИВУВАТИ'}
                                                        </button>
                                                        <button type="button" onClick={() => openEdit(service)}>
                                                            РЕДАГУВАТИ
                                                        </button>
                                                    </div>
                                                </article>
                                            ))}

                                            {categoryServices.length === 0 && (
                                                <div className="service-list-page__empty">У категорії поки немає послуг.</div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </div>
            </div>

            {editingService && (
                <div className="service-list-page__modal-backdrop">
                    <form className="service-list-page__modal" onSubmit={handleSaveEdit}>
                        <h2>Редагування послуги</h2>

                        <label className="service-list-page__field">
                            <span>НАЗВА</span>
                            <input
                                value={editForm.name}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                            />
                        </label>

                        <label className="service-list-page__field">
                            <span>КАТЕГОРІЯ</span>
                            <select
                                value={editForm.categoryId}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, categoryId: e.target.value }))}
                            >
                                {categories.map((category) => (
                                    <option key={category.id} value={category.id}>
                                        {category.name}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <div className="service-list-page__grid">
                            <label className="service-list-page__field">
                                <span>ТРИВАЛІСТЬ (ХВ)</span>
                                <input
                                    type="number"
                                    min={5}
                                    max={480}
                                    value={editForm.durationMinutes}
                                    onChange={(e) =>
                                        setEditForm((prev) => ({ ...prev, durationMinutes: e.target.value }))
                                    }
                                />
                            </label>

                            <label className="service-list-page__field">
                                <span>ЦІНА (USD)</span>
                                <input
                                    type="number"
                                    min={1}
                                    step={0.01}
                                    value={editForm.priceUsd}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, priceUsd: e.target.value }))}
                                />
                            </label>
                        </div>

                        <label className="service-list-page__field">
                            <span>ОПИС</span>
                            <textarea
                                rows={4}
                                value={editForm.description}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                            />
                        </label>

                        <label className="service-list-page__switch">
                            <input
                                type="checkbox"
                                checked={editForm.isActive}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                            />
                            <span>АКТИВНА ПОСЛУГА</span>
                        </label>

                        <div className="service-list-page__modal-actions">
                            <button type="button" onClick={() => setEditingService(null)}>
                                СКАСУВАТИ
                            </button>
                            <button type="submit" disabled={savingEdit}>
                                {savingEdit ? 'ЗБЕРЕЖЕННЯ...' : 'ЗБЕРЕГТИ'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}
