import { useEffect, useMemo, useState } from 'react';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import { getToken } from '../../shared/utils/authStorage';
import {
    createService,
    createServiceCategory,
    getAdminCategories,
    getAdminServices,
    getSpecialtiesOptions,
    toggleCategoryActive,
    toggleServiceActive,
    type ClinicService,
    type ServiceCategory,
    type ServiceSpecialty,
} from '../../shared/api/servicesApi';
import { useI18n } from '../../shared/i18n/I18nProvider';
import './ServiceCreatePage.scss';

type AlertState = {
    variant: 'success' | 'error' | 'info';
    message: string;
} | null;

function parseDbI18nValue(raw: any, language: string): string {
    if (!raw) return '';

    if (typeof raw === 'object' && raw !== null) {
        if ('ua' in raw || 'en' in raw || 'de' in raw || 'fr' in raw) {
            return raw[language] || raw.ua || raw.en || raw.de || raw.fr || '';
        }

        if ('i18n' in raw && raw.i18n) {
            const map = raw.i18n as Record<string, string>;
            return map[language] || map.ua || map.en || map.de || map.fr || '';
        }

        if ('value' in raw && typeof raw.value === 'string') {
            return raw.value;
        }

        return '';
    }

    if (typeof raw === 'string') {
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

export default function ServiceCreatePage() {
    const token = getToken();
    const { language, t } = useI18n();

    const tx = (key: string, fallback: string) => {
        const value = t(key);
        return !value || value === key ? fallback : value;
    };

    const [categoryName, setCategoryName] = useState('');
    const [categoryDescription, setCategoryDescription] = useState('');
    const [categorySortOrder, setCategorySortOrder] = useState('1');
    const [categoryIsActive, setCategoryIsActive] = useState(true);

    const [serviceName, setServiceName] = useState('');
    const [serviceDescription, setServiceDescription] = useState('');
    const [durationMinutes, setDurationMinutes] = useState('30');
    const [priceUah, setPriceUah] = useState('1000');
    const [categoryId, setCategoryId] = useState('');
    const [serviceIsActive, setServiceIsActive] = useState(true);
    const [selectedSpecialtyIds, setSelectedSpecialtyIds] = useState<string[]>([]);

    const [categories, setCategories] = useState<ServiceCategory[]>([]);
    const [services, setServices] = useState<ClinicService[]>([]);
    const [specialties, setSpecialties] = useState<ServiceSpecialty[]>([]);

    const [loading, setLoading] = useState(true);
    const [submittingCategory, setSubmittingCategory] = useState(false);
    const [submittingService, setSubmittingService] = useState(false);
    const [alert, setAlert] = useState<AlertState>(null);

    const sortedCategories = useMemo(
        () => [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
        [categories],
    );

    async function loadData() {
        if (!token) return;

        try {
            setLoading(true);

            const [categoriesRes, servicesRes, specialtiesRes] = await Promise.all([
                getAdminCategories(token),
                getAdminServices(token),
                getSpecialtiesOptions(token),
            ]);

            const loadedCategories = categoriesRes?.categories ?? [];
            const loadedServices = servicesRes?.services ?? [];
            const loadedSpecialties = specialtiesRes?.specialties ?? [];

            setCategories(loadedCategories);
            setServices(loadedServices);
            setSpecialties(loadedSpecialties);

            if (!categoryId && loadedCategories.length > 0) {
                const firstCategory = [...loadedCategories].sort(
                    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
                )[0];

                if (firstCategory) {
                    setCategoryId(firstCategory.id);
                }
            }

            const nextSortOrder =
                loadedCategories.length > 0
                    ? Math.max(...loadedCategories.map((c) => c.sortOrder || 1)) + 1
                    : 1;

            setCategorySortOrder(String(nextSortOrder));
        } catch (error: any) {
            setAlert({
                variant: 'error',
                message: error?.message || tx('serviceCreate.loadError', 'Не вдалося завантажити дані'),
            });
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadData();
    }, [token]);

    function resetCategoryForm(nextSortOrder?: number) {
        setCategoryName('');
        setCategoryDescription('');
        setCategoryIsActive(true);

        if (nextSortOrder !== undefined) {
            setCategorySortOrder(String(nextSortOrder));
        }
    }

    function resetServiceForm(nextCategoryId?: string) {
        setServiceName('');
        setServiceDescription('');
        setDurationMinutes('30');
        setPriceUah('1000');
        setServiceIsActive(true);
        setSelectedSpecialtyIds([]);

        if (nextCategoryId) {
            setCategoryId(nextCategoryId);
        }
    }

    async function handleCreateCategory(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!token) return;

        try {
            setSubmittingCategory(true);

            const res = await createServiceCategory(token, {
                name: categoryName.trim(),
                description: categoryDescription.trim() || undefined,
                sortOrder: Number(categorySortOrder),
                isActive: categoryIsActive,
            });

            const nextCategories = [...categories, res.category].sort(
                (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
            );

            setCategories(nextCategories);
            setCategoryId(res.category.id);

            const nextSortOrder =
                nextCategories.length > 0
                    ? Math.max(...nextCategories.map((c) => c.sortOrder || 1)) + 1
                    : 1;

            resetCategoryForm(nextSortOrder);
            setAlert({ variant: 'success', message: tx('serviceCreate.categoryCreated', 'Категорію створено') });
        } catch (error: any) {
            setAlert({
                variant: 'error',
                message: error?.message || tx('serviceCreate.categoryCreateError', 'Не вдалося створити категорію'),
            });
        } finally {
            setSubmittingCategory(false);
        }
    }

    async function handleCreateService(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!token) return;

        try {
            setSubmittingService(true);

            const res = await createService(token, {
                name: serviceName.trim(),
                description: serviceDescription.trim() || undefined,
                durationMinutes: Number(durationMinutes),
                priceUah: Number(priceUah),
                categoryId,
                isActive: serviceIsActive,
                specialtyIds: selectedSpecialtyIds,
            });

            setServices((prev) => [...prev, res.service].sort((a, b) => a.name.localeCompare(b.name)));
            resetServiceForm(categoryId);
            setAlert({ variant: 'success', message: tx('serviceCreate.serviceCreated', 'Послугу створено') });
        } catch (error: any) {
            setAlert({
                variant: 'error',
                message: error?.message || tx('serviceCreate.serviceCreateError', 'Не вдалося створити послугу'),
            });
        } finally {
            setSubmittingService(false);
        }
    }

    async function handleToggleCategory(category: ServiceCategory) {
        if (!token) return;

        try {
            const res = await toggleCategoryActive(token, category.id);
            setCategories((prev) =>
                prev.map((item) => (item.id === category.id ? res.category : item)),
            );
            setAlert({ variant: 'success', message: res.message });
        } catch (error: any) {
            setAlert({
                variant: 'error',
                message: error?.message || tx('serviceCreate.categoryToggleError', 'Не вдалося змінити статус категорії'),
            });
        }
    }

    async function handleToggleService(service: ClinicService) {
        if (!token) return;

        try {
            const res = await toggleServiceActive(token, service.id);
            setServices((prev) =>
                prev.map((item) => (item.id === service.id ? res.service : item)),
            );
            setAlert({ variant: 'success', message: res.message });
        } catch (error: any) {
            setAlert({
                variant: 'error',
                message: error?.message || tx('serviceCreate.serviceToggleError', 'Не вдалося змінити статус послуги'),
            });
        }
    }

    function toggleSpecialty(id: string) {
        setSelectedSpecialtyIds((prev) =>
            prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
        );
    }

    if (loading) {
        return <div className="service-create-page__loading">{tx('serviceCreate.loading', 'Завантаження...')}</div>;
    }

    return (
        <section className="service-create-page">
            {alert && (
                <AlertToast
                    variant={alert.variant}
                    message={alert.message}
                    onClose={() => setAlert(null)}
                />
            )}

            <div className="service-create-page__layout">
                <article className="service-create-page__card">
                    <h1>{tx('serviceCreate.categoryTitle', 'СТВОРЕННЯ КАТЕГОРІЇ')}</h1>

                    <form className="service-create-page__form" onSubmit={handleCreateCategory}>
                        <div className="service-create-page__grid service-create-page__grid--two">
                            <label className="service-create-page__field">
                                <span>{tx('serviceCreate.categoryName', 'НАЗВА КАТЕГОРІЇ')}</span>
                                <input
                                    value={categoryName}
                                    onChange={(e) => setCategoryName(e.target.value)}
                                    required
                                />
                            </label>

                            <label className="service-create-page__field">
                                <span>{tx('serviceCreate.categoryOrder', 'ПОРЯДОК')}</span>
                                <input
                                    type="number"
                                    min="1"
                                    value={categorySortOrder}
                                    onChange={(e) => setCategorySortOrder(e.target.value)}
                                    required
                                />
                            </label>
                        </div>

                        <label className="service-create-page__field">
                            <span>{tx('serviceCreate.categoryDescription', 'ОПИС КАТЕГОРІЇ')}</span>
                            <textarea
                                value={categoryDescription}
                                onChange={(e) => setCategoryDescription(e.target.value)}
                                rows={5}
                            />
                        </label>

                        <label className="service-create-page__checkbox">
                            <input
                                type="checkbox"
                                checked={categoryIsActive}
                                onChange={(e) => setCategoryIsActive(e.target.checked)}
                            />
                            <span>{tx('serviceCreate.activeCategory', 'АКТИВНА КАТЕГОРІЯ')}</span>
                        </label>

                        <button type="submit" disabled={submittingCategory}>
                            {submittingCategory
                                ? tx('serviceCreate.creating', 'СТВОРЕННЯ...')
                                : tx('serviceCreate.createCategory', 'СТВОРИТИ КАТЕГОРІЮ')}
                        </button>
                    </form>
                </article>

                <article className="service-create-page__card">
                    <h1>{tx('serviceCreate.serviceTitle', 'СТВОРЕННЯ ПОСЛУГИ')}</h1>

                    <form className="service-create-page__form" onSubmit={handleCreateService}>
                        <div className="service-create-page__grid service-create-page__grid--two">
                            <label className="service-create-page__field">
                                <span>{tx('serviceCreate.serviceName', 'НАЗВА ПОСЛУГИ')}</span>
                                <input
                                    value={serviceName}
                                    onChange={(e) => setServiceName(e.target.value)}
                                    required
                                />
                            </label>

                            <label className="service-create-page__field">
                                <span>{tx('serviceCreate.category', 'КАТЕГОРІЯ')}</span>
                                <select
                                    value={categoryId}
                                    onChange={(e) => setCategoryId(e.target.value)}
                                    required
                                >
                                    <option value="">{tx('serviceCreate.selectCategory', 'Оберіть категорію')}</option>
                                    {sortedCategories.map((category) => (
                                        <option key={category.id} value={category.id}>
                                            {category.sortOrder}. {category.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>

                        <div className="service-create-page__grid service-create-page__grid--two">
                            <label className="service-create-page__field">
                                <span>{tx('serviceCreate.duration', 'ТРИВАЛІСТЬ (ХВ)')}</span>
                                <input
                                    type="number"
                                    min="5"
                                    step="5"
                                    value={durationMinutes}
                                    onChange={(e) => setDurationMinutes(e.target.value)}
                                    required
                                />
                            </label>

                            <label className="service-create-page__field">
                                <span>{tx('serviceCreate.priceUah', 'ЦІНА (ГРН)')}</span>
                                <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={priceUah}
                                    onChange={(e) => setPriceUah(e.target.value)}
                                    required
                                />
                            </label>
                        </div>

                        <label className="service-create-page__field">
                            <span>{tx('serviceCreate.serviceDescription', 'ОПИС ПОСЛУГИ')}</span>
                            <textarea
                                value={serviceDescription}
                                onChange={(e) => setServiceDescription(e.target.value)}
                                rows={5}
                            />
                        </label>

                        <div className="service-create-page__specialties">
                            <div className="service-create-page__specialties-title">
                                {tx('serviceCreate.assignedSpecialties', 'ПРИЗНАЧЕНІ СПЕЦІАЛЬНОСТІ')}
                            </div>

                            <div className="service-create-page__specialties-list">
                                {specialties.map((specialty) => {
                                    const checked = selectedSpecialtyIds.includes(specialty.id);
                                    const label =
                                        parseDbI18nValue((specialty as any).nameI18n, language) ||
                                        parseDbI18nValue(specialty.name, language);

                                    return (
                                        <label
                                            key={specialty.id}
                                            className={`service-create-page__specialty-item ${checked ? 'is-selected' : ''}`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleSpecialty(specialty.id)}
                                            />
                                            <div>
                                                <strong>{label}</strong>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>

                        <label className="service-create-page__checkbox">
                            <input
                                type="checkbox"
                                checked={serviceIsActive}
                                onChange={(e) => setServiceIsActive(e.target.checked)}
                            />
                            <span>{tx('serviceCreate.activeService', 'АКТИВНА ПОСЛУГА')}</span>
                        </label>

                        <button type="submit" disabled={submittingService}>
                            {submittingService
                                ? tx('serviceCreate.creating', 'СТВОРЕННЯ...')
                                : tx('serviceCreate.createService', 'СТВОРИТИ ПОСЛУГУ')}
                        </button>
                    </form>
                </article>

                <article className="service-create-page__card">
                    <h2>{tx('serviceCreate.categoriesList', 'КАТЕГОРІЇ')}</h2>

                    <div className="service-create-page__list">
                        {sortedCategories.map((category) => (
                            <div key={category.id} className="service-create-page__list-item">
                                <div>
                                    <strong>{category.sortOrder}. {category.name}</strong>
                                    {category.description && <p>{category.description}</p>}
                                </div>

                                <button
                                    type="button"
                                    onClick={() => handleToggleCategory(category)}
                                >
                                    {category.isActive
                                        ? tx('serviceCreate.deactivate', 'ДЕАКТИВУВАТИ')
                                        : tx('serviceCreate.activate', 'АКТИВУВАТИ')}
                                </button>
                            </div>
                        ))}
                    </div>
                </article>

                <article className="service-create-page__card">
                    <h2>{tx('serviceCreate.servicesList', 'ПОСЛУГИ')}</h2>

                    <div className="service-create-page__list">
                        {services.map((service) => (
                            <div key={service.id} className="service-create-page__list-item">
                                <div>
                                    <strong>{service.name}</strong>
                                    <p>
                                        {service.priceUah} грн · {service.durationMinutes} хв
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => handleToggleService(service)}
                                >
                                    {service.isActive
                                        ? tx('serviceCreate.deactivate', 'ДЕАКТИВУВАТИ')
                                        : tx('serviceCreate.activate', 'АКТИВУВАТИ')}
                                </button>
                            </div>
                        ))}
                    </div>
                </article>
            </div>
        </section>
    );
}