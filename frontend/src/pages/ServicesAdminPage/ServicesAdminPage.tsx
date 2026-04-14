import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
    createService,
    createServiceCategory,
    getAdminCategories,
    getAdminServices,
    getSpecialtiesOptions,
    toggleCategoryActive,
    toggleServiceActive,
    updateService,
    updateServiceCategory,
    type ClinicService,
    type ServiceCategory,
    type ServiceSpecialty,
} from '../../shared/api/servicesApi.ts';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import { useI18n } from '../../shared/i18n/I18nProvider';
import type { AppLanguage } from '../../shared/i18n/translations';
import { pickDoctorSpecialtyByLanguage } from '../../shared/i18n/doctorSpecialty';
import './ServicesAdminPage.scss';

type Lang = 'ua' | 'en' | 'de' | 'fr';

type Localized = Record<Lang, string>;

type AlertState = {
    variant: 'success' | 'error' | 'info';
    message: string;
} | null;

type ModalMode = 'create' | 'edit';

type CategoryFormState = {
    name: Localized;
    description: Localized;
    sortOrder: string;
    isActive: boolean;
};

type ServiceFormState = {
    name: Localized;
    description: Localized;
    sortOrder: string;
    durationMinutes: string;
    priceUah: string;
    categoryId: string;
    isActive: boolean;
    specialtyIds: string[];
    requiredServiceIds: string[];
    prerequisiteServiceIds: string[];
    allowMultipleInCart: boolean;
    maxCartQuantity: string;
    minIntervalDays: string;
    maxIntervalDays: string;
};

const LANGS: Array<{ key: Lang; label: string }> = [
    { key: 'ua', label: 'Українська' },
    { key: 'en', label: 'English' },
    { key: 'de', label: 'Deutsch' },
    { key: 'fr', label: 'Français' },
];

function emptyLocalized(): Localized {
    return {
        ua: '',
        en: '',
        de: '',
        fr: '',
    };
}

function createEmptyCategoryForm(): CategoryFormState {
    return {
        name: emptyLocalized(),
        description: emptyLocalized(),
        sortOrder: '1',
        isActive: true,
    };
}

function createEmptyServiceForm(categoryId = ''): ServiceFormState {
    return {
        name: emptyLocalized(),
        description: emptyLocalized(),
        sortOrder: '1',
        durationMinutes: '30',
        priceUah: '1000',
        categoryId,
        isActive: true,
        specialtyIds: [],
        requiredServiceIds: [],
        prerequisiteServiceIds: [],
        allowMultipleInCart: false,
        maxCartQuantity: '1',
        minIntervalDays: '',
        maxIntervalDays: '',
    };
}

function normalizeLocalized(value: Partial<Localized> | null | undefined): Localized {
    return {
        ua: typeof value?.ua === 'string' ? value.ua : '',
        en: typeof value?.en === 'string' ? value.en : '',
        de: typeof value?.de === 'string' ? value.de : '',
        fr: typeof value?.fr === 'string' ? value.fr : '',
    };
}

function parseI18n(raw: unknown): Localized {
    if (!raw) return emptyLocalized();

    if (typeof raw === 'object' && raw !== null) {
        if ('data' in raw && typeof (raw as { data?: unknown }).data === 'object') {
            return normalizeLocalized((raw as { data?: Partial<Localized> }).data);
        }
        return normalizeLocalized(raw as Partial<Localized>);
    }

    if (typeof raw !== 'string') return emptyLocalized();

    if (!raw.includes('__ORADENT_I18N__')) {
        return {
            ua: raw,
            en: '',
            de: '',
            fr: '',
        };
    }

    try {
        const start = raw.indexOf('{');
        if (start === -1) return emptyLocalized();
        const parsed = JSON.parse(raw.slice(start)) as { data?: Partial<Localized> };
        return normalizeLocalized(parsed?.data);
    } catch {
        return emptyLocalized();
    }
}

function pickI18nText(raw: unknown, lang: Lang): string {
    const parsed = parseI18n(raw);
    return (
        parsed[lang]?.trim() ||
        parsed.ua?.trim() ||
        parsed.en?.trim() ||
        parsed.de?.trim() ||
        parsed.fr?.trim() ||
        ''
    );
}

function serializeI18n(
    type:
        | 'serviceNameI18n'
        | 'serviceDescriptionI18n'
        | 'serviceCategoryNameI18n'
        | 'serviceCategoryDescriptionI18n',
    data: Localized,
): string {
    return `__ORADENT_I18N__:${JSON.stringify({
        type,
        v: 1,
        data: normalizeLocalized(data),
    })}`;
}

async function translateText(text: string, from: AppLanguage, to: AppLanguage) {
    const source = text.trim();
    if (!source) return '';
    if (from === to) return source;

    const sourceLang = from === 'ua' ? 'uk' : from;
    const targetLang = to === 'ua' ? 'uk' : to;

    const endpoints = [
        'https://translate.argosopentech.com/translate',
        'https://libretranslate.de/translate',
    ];

    for (const url of endpoints) {
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    q: source,
                    source: sourceLang,
                    target: targetLang,
                    format: 'text',
                }),
            });

            if (!resp.ok) continue;
            const data = (await resp.json()) as { translatedText?: string };
            const translated = (data.translatedText || '').trim();
            if (translated) return translated;
        } catch {
            // ignore
        }
    }

    try {
        const query = new URLSearchParams({
            q: source,
            langpair: `${sourceLang}|${targetLang}`,
        });
        const resp = await fetch(`https://api.mymemory.translated.net/get?${query.toString()}`);
        if (resp.ok) {
            const data = (await resp.json()) as {
                responseData?: { translatedText?: string };
            };
            const translated = (data.responseData?.translatedText || '').trim();
            if (translated) return translated;
        }
    } catch {
        // ignore
    }

    try {
        const query = new URLSearchParams({
            client: 'gtx',
            sl: sourceLang,
            tl: targetLang,
            dt: 't',
            q: source,
        });
        const resp = await fetch(`https://translate.googleapis.com/translate_a/single?${query.toString()}`);
        if (resp.ok) {
            const data = (await resp.json()) as unknown;
            if (Array.isArray(data) && Array.isArray(data[0])) {
                const translated = data[0]
                    .map((part) => (Array.isArray(part) ? String(part[0] ?? '') : ''))
                    .join('')
                    .trim();
                if (translated) return translated;
            }
        }
    } catch {
        // ignore
    }

    throw new Error('Не вдалося виконати автопереклад');
}

function getServiceSpecialtyLabel(
    specialty: ServiceSpecialty | undefined,
    language: AppLanguage,
): string {
    if (!specialty) return '';

    const i18n = (specialty as any).nameI18n;
    if (i18n && typeof i18n === 'object') {
        return i18n[language] || i18n.ua || i18n.en || i18n.de || i18n.fr || specialty.name || '';
    }

    if (typeof specialty.name === 'string') {
        return pickDoctorSpecialtyByLanguage(specialty.name, language) || specialty.name;
    }

    return '';
}


function buildServiceRulesSummary(
    service: ClinicService,
    services: ClinicService[],
    lang: Lang,
    t: (key: string) => string,
) {
    const parts: string[] = [];

    const requiredNames = (service.requiredServiceIds || [])
        .map((id) => services.find((item) => item.id === id))
        .filter(Boolean)
        .map((item) => pickI18nText((item as ClinicService).name, lang));

    if (requiredNames.length) {
        parts.push(`${t('servicesAdmin.requiredWithLabel')}: ${requiredNames.join(', ')}`);
    }

    const prerequisiteNames = (service.prerequisiteServiceIds || [])
        .map((id) => services.find((item) => item.id === id))
        .filter(Boolean)
        .map((item) => pickI18nText((item as ClinicService).name, lang));

    if (prerequisiteNames.length) {
        parts.push(`${t('servicesAdmin.afterServiceLabel')}: ${prerequisiteNames.join(', ')}`);
    }

    if (service.allowMultipleInCart) {
        parts.push(`${t('servicesAdmin.cartMultiplicityLabel')}: ${service.maxCartQuantity || '∞'}`);
    }

    if (service.minIntervalDays !== null && service.minIntervalDays !== undefined) {
        parts.push(`${t('servicesAdmin.minIntervalLabel')}: ${service.minIntervalDays}`);
    }

    if (service.maxIntervalDays !== null && service.maxIntervalDays !== undefined) {
        parts.push(`${t('servicesAdmin.maxIntervalLabel')}: ${service.maxIntervalDays}`);
    }

    return parts.join(' · ');
}

function tt(
    t: (key: string) => string,
    key: string,
    fallback: string,
): string {
    const value = t(key);
    return !value || value === key ? fallback : value;
}

export default function ServicesAdminPage() {
    const token = getToken();
    const role = getUserRole();
    const isAllowed = role === 'ADMIN' || role === 'SUPER_ADMIN';
    const { t, language } = useI18n();

    const currentLang = (['ua', 'en', 'de', 'fr'].includes(language) ? language : 'ua') as Lang;

    const [loading, setLoading] = useState(true);
    const [alert, setAlert] = useState<AlertState>(null);

    const [categories, setCategories] = useState<ServiceCategory[]>([]);
    const [services, setServices] = useState<ClinicService[]>([]);
    const [specialties, setSpecialties] = useState<ServiceSpecialty[]>([]);

    const [search, setSearch] = useState('');
    const [activeOnly, setActiveOnly] = useState(false);
    const [categoryFilter, setCategoryFilter] = useState('');

    const [categoryModalOpen, setCategoryModalOpen] = useState(false);
    const [serviceModalOpen, setServiceModalOpen] = useState(false);

    const [categoryModalMode, setCategoryModalMode] = useState<ModalMode>('create');
    const [serviceModalMode, setServiceModalMode] = useState<ModalMode>('create');

    const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
    const [editingServiceId, setEditingServiceId] = useState<string | null>(null);

    const [categoryLang, setCategoryLang] = useState<Lang>('ua');
    const [serviceLang, setServiceLang] = useState<Lang>('ua');

    const [categoryForm, setCategoryForm] = useState<CategoryFormState>(createEmptyCategoryForm());
    const [serviceForm, setServiceForm] = useState<ServiceFormState>(createEmptyServiceForm());

    const [savingCategory, setSavingCategory] = useState(false);
    const [savingService, setSavingService] = useState(false);
    const [translatingCategory, setTranslatingCategory] = useState(false);
    const [translatingService, setTranslatingService] = useState(false);

    useEffect(() => {
        void bootstrap();
    }, []);

    async function bootstrap() {
        if (!token || !isAllowed) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);

            const [categoriesRes, servicesRes, specialtiesRes] = await Promise.all([
                getAdminCategories(token),
                getAdminServices(token),
                getSpecialtiesOptions(token),
            ]);

            setCategories(categoriesRes.categories);
            setServices(servicesRes.services);
            setSpecialties(specialtiesRes.specialties);
            setServiceForm(createEmptyServiceForm(categoriesRes.categories[0]?.id || ''));
        } catch (err) {
            setAlert({
                variant: 'error',
                message: err instanceof Error ? err.message : 'Не вдалося завантажити сторінку послуг',
            });
        } finally {
            setLoading(false);
        }
    }

    const filteredCategories = useMemo(() => {
        return categories.filter((item) => {
            const name = pickI18nText(item.name, currentLang);

            if (search && !name.toLowerCase().includes(search.toLowerCase())) return false;
            if (activeOnly && !item.isActive) return false;

            return true;
        });
    }, [categories, search, activeOnly, currentLang]);

    const filteredServices = useMemo(() => {
        return services.filter((item) => {
            const name = pickI18nText(item.name, currentLang);

            if (search && !name.toLowerCase().includes(search.toLowerCase())) return false;
            if (activeOnly && !item.isActive) return false;
            if (categoryFilter && item.categoryId !== categoryFilter) return false;

            return true;
        });
    }, [services, search, activeOnly, categoryFilter, currentLang]);

    const dependencyOptions = useMemo(() => {
        return services
            .filter((item) => item.id !== editingServiceId)
            .sort((a, b) => pickI18nText(a.name, currentLang).localeCompare(pickI18nText(b.name, currentLang), 'uk'));
    }, [services, editingServiceId, currentLang]);

    function openCreateCategoryModal() {
        setCategoryModalMode('create');
        setEditingCategoryId(null);
        setCategoryForm(createEmptyCategoryForm());
        setCategoryLang('ua');
        setCategoryModalOpen(true);
    }

    function openEditCategoryModal(item: ServiceCategory) {
        setCategoryModalMode('edit');
        setEditingCategoryId(item.id);
        setCategoryForm({
            name: parseI18n(item.name),
            description: parseI18n(item.description),
            sortOrder: String(item.sortOrder),
            isActive: item.isActive,
        });
        setCategoryLang('ua');
        setCategoryModalOpen(true);
    }

    function openCreateServiceModal() {
        setServiceModalMode('create');
        setEditingServiceId(null);
        setServiceForm(createEmptyServiceForm(categories[0]?.id || ''));
        setServiceLang('ua');
        setServiceModalOpen(true);
    }

    function openEditServiceModal(item: ClinicService) {
        setServiceModalMode('edit');
        setEditingServiceId(item.id);
        setServiceForm({
            name: parseI18n(item.name),
            description: parseI18n(item.description),
            sortOrder: String(item.sortOrder),
            durationMinutes: String(item.durationMinutes),
            priceUah: String(item.priceUah),
            categoryId: item.categoryId,
            isActive: item.isActive,
            specialtyIds: item.specialtyIds || [],
            requiredServiceIds: item.requiredServiceIds || [],
            prerequisiteServiceIds: item.prerequisiteServiceIds || [],
            allowMultipleInCart: Boolean(item.allowMultipleInCart),
            maxCartQuantity: item.maxCartQuantity !== null && item.maxCartQuantity !== undefined ? String(item.maxCartQuantity) : '1',
            minIntervalDays: item.minIntervalDays !== null && item.minIntervalDays !== undefined ? String(item.minIntervalDays) : '',
            maxIntervalDays: item.maxIntervalDays !== null && item.maxIntervalDays !== undefined ? String(item.maxIntervalDays) : '',
        });
        setServiceLang('ua');
        setServiceModalOpen(true);
    }

    function closeCategoryModal() {
        setCategoryModalOpen(false);
        setEditingCategoryId(null);
        setCategoryForm(createEmptyCategoryForm());
        setCategoryLang('ua');
    }

    function closeServiceModal() {
        setServiceModalOpen(false);
        setEditingServiceId(null);
        setServiceForm(createEmptyServiceForm(categories[0]?.id || ''));
        setServiceLang('ua');
    }

    async function handleAutoTranslateCategory() {
        const sourceName = categoryForm.name.ua.trim();
        const sourceDescription = categoryForm.description.ua.trim();

        if (!sourceName && !sourceDescription) {
            setAlert({
                variant: 'info',
                message: 'Спочатку заповни українську назву або опис категорії',
            });
            return;
        }

        try {
            setTranslatingCategory(true);

            const [nameEn, nameDe, nameFr, descEn, descDe, descFr] = await Promise.all([
                sourceName ? translateText(sourceName, 'ua', 'en') : Promise.resolve(''),
                sourceName ? translateText(sourceName, 'ua', 'de') : Promise.resolve(''),
                sourceName ? translateText(sourceName, 'ua', 'fr') : Promise.resolve(''),
                sourceDescription ? translateText(sourceDescription, 'ua', 'en') : Promise.resolve(''),
                sourceDescription ? translateText(sourceDescription, 'ua', 'de') : Promise.resolve(''),
                sourceDescription ? translateText(sourceDescription, 'ua', 'fr') : Promise.resolve(''),
            ]);

            setCategoryForm((prev) => ({
                ...prev,
                name: { ...prev.name, en: nameEn, de: nameDe, fr: nameFr },
                description: { ...prev.description, en: descEn, de: descDe, fr: descFr },
            }));
            setAlert({ variant: 'success', message: tt(t, 'servicesAdmin.translated', 'Успішно перекладено') });
        } catch (err) {
            setAlert({
                variant: 'error',
                message: err instanceof Error ? err.message : 'Помилка автоперекладу категорії',
            });
        } finally {
            setTranslatingCategory(false);
        }
    }

    async function handleAutoTranslateService() {
        const sourceName = serviceForm.name.ua.trim();
        const sourceDescription = serviceForm.description.ua.trim();

        if (!sourceName && !sourceDescription) {
            setAlert({
                variant: 'info',
                message: 'Спочатку заповни українську назву або опис послуги',
            });
            return;
        }

        try {
            setTranslatingService(true);

            const [nameEn, nameDe, nameFr, descEn, descDe, descFr] = await Promise.all([
                sourceName ? translateText(sourceName, 'ua', 'en') : Promise.resolve(''),
                sourceName ? translateText(sourceName, 'ua', 'de') : Promise.resolve(''),
                sourceName ? translateText(sourceName, 'ua', 'fr') : Promise.resolve(''),
                sourceDescription ? translateText(sourceDescription, 'ua', 'en') : Promise.resolve(''),
                sourceDescription ? translateText(sourceDescription, 'ua', 'de') : Promise.resolve(''),
                sourceDescription ? translateText(sourceDescription, 'ua', 'fr') : Promise.resolve(''),
            ]);

            setServiceForm((prev) => ({
                ...prev,
                name: { ...prev.name, en: nameEn, de: nameDe, fr: nameFr },
                description: { ...prev.description, en: descEn, de: descDe, fr: descFr },
            }));
            setAlert({ variant: 'success', message: tt(t, 'servicesAdmin.translated', 'Успішно перекладено') });
        } catch (err) {
            setAlert({
                variant: 'error',
                message: err instanceof Error ? err.message : 'Помилка автоперекладу послуги',
            });
        } finally {
            setTranslatingService(false);
        }
    }

    async function handleSaveCategory(e: FormEvent) {
        e.preventDefault();
        if (!token) return;

        try {
            setSavingCategory(true);

            const payload = {
                name: serializeI18n('serviceCategoryNameI18n', categoryForm.name),
                description: serializeI18n('serviceCategoryDescriptionI18n', categoryForm.description),
                sortOrder: Number(categoryForm.sortOrder),
                isActive: categoryForm.isActive,
            };

            if (categoryModalMode === 'edit' && editingCategoryId) {
                const res = await updateServiceCategory(token, editingCategoryId, payload);
                setCategories((prev) =>
                    prev.map((item) => (item.id === editingCategoryId ? res.category : item)),
                );
                setAlert({ variant: 'success', message: res.message });
            } else {
                const res = await createServiceCategory(token, payload);
                setCategories((prev) => [...prev, res.category]);
                setAlert({ variant: 'success', message: res.message });
            }

            closeCategoryModal();
        } catch (err) {
            setAlert({
                variant: 'error',
                message: err instanceof Error ? err.message : 'Не вдалося зберегти категорію',
            });
        } finally {
            setSavingCategory(false);
        }
    }

    async function handleSaveService(e: FormEvent) {
        e.preventDefault();
        if (!token) return;

        try {
            setSavingService(true);

            const payload = {
                name: serializeI18n('serviceNameI18n', serviceForm.name),
                description: serializeI18n('serviceDescriptionI18n', serviceForm.description),
                sortOrder: Number(serviceForm.sortOrder),
                durationMinutes: Number(serviceForm.durationMinutes),
                priceUah: Number(serviceForm.priceUah),
                categoryId: serviceForm.categoryId,
                isActive: serviceForm.isActive,
                specialtyIds: serviceForm.specialtyIds,
                requiredServiceIds: serviceForm.requiredServiceIds,
                prerequisiteServiceIds: serviceForm.prerequisiteServiceIds,
                allowMultipleInCart: serviceForm.allowMultipleInCart,
                maxCartQuantity: serviceForm.allowMultipleInCart ? Number(serviceForm.maxCartQuantity || '1') : 1,
                minIntervalDays: serviceForm.minIntervalDays !== '' ? Number(serviceForm.minIntervalDays) : null,
                maxIntervalDays: serviceForm.maxIntervalDays !== '' ? Number(serviceForm.maxIntervalDays) : null,
            };

            if (serviceModalMode === 'edit' && editingServiceId) {
                const res = await updateService(token, editingServiceId, payload);
                setServices((prev) =>
                    prev.map((item) => (item.id === editingServiceId ? res.service : item)),
                );
                setAlert({ variant: 'success', message: res.message });
            } else {
                const res = await createService(token, payload);
                setServices((prev) => [...prev, res.service]);
                setAlert({ variant: 'success', message: res.message });
            }

            closeServiceModal();
        } catch (err) {
            setAlert({
                variant: 'error',
                message: err instanceof Error ? err.message : 'Не вдалося зберегти послугу',
            });
        } finally {
            setSavingService(false);
        }
    }

    async function handleToggleCategory(id: string) {
        if (!token) return;

        try {
            const res = await toggleCategoryActive(token, id);
            setCategories((prev) => prev.map((item) => (item.id === id ? res.category : item)));
        } catch (err) {
            setAlert({
                variant: 'error',
                message: err instanceof Error ? err.message : 'Не вдалося змінити статус категорії',
            });
        }
    }

    async function handleToggleService(id: string) {
        if (!token) return;

        try {
            const res = await toggleServiceActive(token, id);
            setServices((prev) => prev.map((item) => (item.id === id ? res.service : item)));
        } catch (err) {
            setAlert({
                variant: 'error',
                message: err instanceof Error ? err.message : 'Не вдалося змінити статус послуги',
            });
        }
    }

    function toggleSpecialty(id: string) {
        setServiceForm((prev) => ({
            ...prev,
            specialtyIds: prev.specialtyIds.includes(id)
                ? prev.specialtyIds.filter((item) => item !== id)
                : [...prev.specialtyIds, id],
        }));
    }

    function toggleRequiredService(id: string) {
        setServiceForm((prev) => ({
            ...prev,
            requiredServiceIds: prev.requiredServiceIds.includes(id)
                ? prev.requiredServiceIds.filter((item) => item !== id)
                : [...prev.requiredServiceIds, id],
        }));
    }

    function togglePrerequisiteService(id: string) {
        setServiceForm((prev) => ({
            ...prev,
            prerequisiteServiceIds: prev.prerequisiteServiceIds.includes(id)
                ? prev.prerequisiteServiceIds.filter((item) => item !== id)
                : [...prev.prerequisiteServiceIds, id],
        }));
    }

    if (!isAllowed) {
        return <div className="services-admin-page__blocked">Доступно лише для ADMIN та SUPER_ADMIN.</div>;
    }

    if (loading) {
        return <div className="services-admin-page__loading">Завантаження...</div>;
    }

    return (
        <>
            {alert && (
                <div className="services-admin-page__global-alert">
                    <AlertToast
                        variant={alert.variant}
                        message={alert.message}
                        onClose={() => setAlert(null)}
                    />
                </div>
            )}

            <div className="services-admin-page">
                <div className="container">
                    <div className="services-admin-page__hero">
                        <div className="services-admin-page__hero-copy">
                            <h1>{tt(t, 'servicesAdmin.title', 'ПОСЛУГИ')}</h1>
                            <p>{tt(t, 'servicesAdmin.subtitle', 'Керування категоріями та послугами в одному місці.')}</p>
                        </div>

                        <div className="services-admin-page__hero-tools">
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={tt(t, 'servicesAdmin.search', 'Пошук...')}
                            />

                            <select
                                value={categoryFilter}
                                onChange={(e) => setCategoryFilter(e.target.value)}
                            >
                                <option value="">{tt(t, 'servicesAdmin.allCategories', 'Усі категорії')}</option>
                                {categories.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {pickI18nText(item.name, currentLang)}
                                    </option>
                                ))}
                            </select>

                            <label className="services-admin-page__only-active">
                                <input
                                    type="checkbox"
                                    checked={activeOnly}
                                    onChange={(e) => setActiveOnly(e.target.checked)}
                                />
                                <span>{tt(t, 'servicesAdmin.onlyActive', 'Тільки активні')}</span>
                            </label>
                        </div>
                    </div>

                    <div className="services-admin-page__top-actions">
                        <button type="button" onClick={openCreateCategoryModal}>
                            {tt(t, 'servicesAdmin.newCategory', 'Нова категорія')}
                        </button>
                        <button type="button" onClick={openCreateServiceModal}>
                            {tt(t, 'servicesAdmin.newService', 'Нова послуга')}
                        </button>
                    </div>

                    <section className="services-admin-page__section">
                        <div className="services-admin-page__section-head">
                            <h2>{tt(t, 'servicesAdmin.categories', 'Категорії')}</h2>
                        </div>

                        <div className="services-admin-page__list">
                            {filteredCategories.map((item) => (
                                <div key={item.id} className="services-admin-page__item">
                                    <div className="services-admin-page__item-dot">
                                        <span
                                            className={
                                                item.isActive
                                                    ? 'services-admin-page__signal services-admin-page__signal--green'
                                                    : 'services-admin-page__signal services-admin-page__signal--red'
                                            }
                                        />
                                    </div>

                                    <div className="services-admin-page__item-main">
                                        <strong>
                                            {item.sortOrder}. {pickI18nText(item.name, currentLang)}
                                        </strong>
                                        <p>{pickI18nText(item.description, currentLang) || tt(t, 'servicesAdmin.noDescription', 'Без опису')}</p>
                                    </div>

                                    <div className="services-admin-page__item-actions">
                                        <button type="button" onClick={() => openEditCategoryModal(item)}>
                                            {tt(t, 'servicesAdmin.edit', 'Редагувати')}
                                        </button>
                                        <button type="button" onClick={() => handleToggleCategory(item.id)}>
                                            {item.isActive
                                                ? tt(t, 'servicesAdmin.deactivate', 'Деактивувати')
                                                : tt(t, 'servicesAdmin.activate', 'Активувати')}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="services-admin-page__section">
                        <div className="services-admin-page__section-head">
                            <h2>{tt(t, 'servicesAdmin.services', 'Послуги')}</h2>
                        </div>

                        <div className="services-admin-page__list">
                            {filteredServices.map((item) => (
                                <div key={item.id} className="services-admin-page__item">
                                    <div className="services-admin-page__item-dot">
                                        <span
                                            className={
                                                item.isActive
                                                    ? 'services-admin-page__signal services-admin-page__signal--green'
                                                    : 'services-admin-page__signal services-admin-page__signal--red'
                                            }
                                        />
                                    </div>

                                    <div className="services-admin-page__item-main">
                                        <strong>
                                            {item.sortOrder}. {pickI18nText(item.name, currentLang)}
                                        </strong>
                                        <p>
                                            {pickI18nText(item.category?.name, currentLang) || '—'}
                                            {' · '}
                                            {Math.round(item.priceUah)} грн
                                            {' · '}
                                            {item.durationMinutes} хв
                                        </p>
                                        {buildServiceRulesSummary(item, services, currentLang, t) ? (
                                            <p>{buildServiceRulesSummary(item, services, currentLang, t)}</p>
                                        ) : null}
                                    </div>

                                    <div className="services-admin-page__item-actions">
                                        <button type="button" onClick={() => openEditServiceModal(item)}>
                                            {tt(t, 'servicesAdmin.edit', 'Редагувати')}
                                        </button>
                                        <button type="button" onClick={() => handleToggleService(item.id)}>
                                            {item.isActive
                                                ? tt(t, 'servicesAdmin.deactivate', 'Деактивувати')
                                                : tt(t, 'servicesAdmin.activate', 'Активувати')}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>

                {categoryModalOpen && (
                    <div className="services-admin-page__backdrop" onClick={closeCategoryModal}>
                        <div
                            className="services-admin-page__modal"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="services-admin-page__modal-head">
                                <h3>
                                    {categoryModalMode === 'edit'
                                        ? tt(t, 'servicesAdmin.editCategory', 'Редагування категорії')
                                        : tt(t, 'servicesAdmin.createCategory', 'Створення категорії')}
                                </h3>
                                <button type="button" onClick={closeCategoryModal}>×</button>
                            </div>

                            <form className="services-admin-page__form" onSubmit={handleSaveCategory}>
                                <div className="services-admin-page__lang-row">
                                    {LANGS.map((lang) => (
                                        <button
                                            key={lang.key}
                                            type="button"
                                            className={categoryLang === lang.key ? 'is-active' : ''}
                                            onClick={() => setCategoryLang(lang.key)}
                                        >
                                            {lang.label}
                                        </button>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={handleAutoTranslateCategory}
                                        disabled={translatingCategory}
                                    >
                                        {translatingCategory ? (
                                            <span className="services-admin-page__button-loading">
                                                <span className="services-admin-page__button-spinner" />
                                                {tt(t, 'common.translating', 'Перекладаємо...')}
                                            </span>
                                        ) : tt(t, 'common.autoTranslate', 'Автопереклад')}
                                    </button>
                                </div>

                                <div className="services-admin-page__form-grid">
                                    <label className="services-admin-page__field services-admin-page__field--full">
                                        <span>{tt(t, 'servicesAdmin.name', 'Назва')} ({categoryLang.toUpperCase()})</span>
                                        <input
                                            value={categoryForm.name[categoryLang]}
                                            onChange={(e) =>
                                                setCategoryForm((prev) => ({
                                                    ...prev,
                                                    name: { ...prev.name, [categoryLang]: e.target.value },
                                                }))
                                            }
                                        />
                                    </label>

                                    <label className="services-admin-page__field services-admin-page__field--full">
                                        <span>{tt(t, 'servicesAdmin.description', 'Опис')} ({categoryLang.toUpperCase()})</span>
                                        <textarea
                                            rows={5}
                                            value={categoryForm.description[categoryLang]}
                                            onChange={(e) =>
                                                setCategoryForm((prev) => ({
                                                    ...prev,
                                                    description: {
                                                        ...prev.description,
                                                        [categoryLang]: e.target.value,
                                                    },
                                                }))
                                            }
                                        />
                                    </label>

                                    <label className="services-admin-page__field">
                                        <span>{tt(t, 'servicesAdmin.order', 'Порядок')}</span>
                                        <input
                                            type="number"
                                            value={categoryForm.sortOrder}
                                            onChange={(e) =>
                                                setCategoryForm((prev) => ({
                                                    ...prev,
                                                    sortOrder: e.target.value,
                                                }))
                                            }
                                        />
                                    </label>

                                    <label className="services-admin-page__switch">
                                        <span>{tt(t, 'servicesAdmin.active', 'Активна')}</span>
                                        <input
                                            type="checkbox"
                                            checked={categoryForm.isActive}
                                            onChange={(e) =>
                                                setCategoryForm((prev) => ({
                                                    ...prev,
                                                    isActive: e.target.checked,
                                                }))
                                            }
                                        />
                                    </label>
                                </div>

                                <div className="services-admin-page__form-actions">
                                    <button type="submit" disabled={savingCategory}>
                                        {savingCategory
                                            ? tt(t, 'common.saving', 'Збереження...')
                                            : categoryModalMode === 'edit'
                                                ? tt(t, 'servicesAdmin.updateCategory', 'Оновити категорію')
                                                : tt(t, 'servicesAdmin.createCategory', 'Створити категорію')}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {serviceModalOpen && (
                    <div className="services-admin-page__backdrop" onClick={closeServiceModal}>
                        <div
                            className="services-admin-page__modal services-admin-page__modal--wide"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="services-admin-page__modal-head">
                                <h3>
                                    {serviceModalMode === 'edit'
                                        ? tt(t, 'servicesAdmin.editService', 'Редагування послуги')
                                        : tt(t, 'servicesAdmin.createService', 'Створення послуги')}
                                </h3>
                                <button type="button" onClick={closeServiceModal}>×</button>
                            </div>

                            <form className="services-admin-page__form" onSubmit={handleSaveService}>
                                <div className="services-admin-page__lang-row">
                                    {LANGS.map((lang) => (
                                        <button
                                            key={lang.key}
                                            type="button"
                                            className={serviceLang === lang.key ? 'is-active' : ''}
                                            onClick={() => setServiceLang(lang.key)}
                                        >
                                            {lang.label}
                                        </button>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={handleAutoTranslateService}
                                        disabled={translatingService}
                                    >
                                        {translatingService ? (
                                            <span className="services-admin-page__button-loading">
                                                <span className="services-admin-page__button-spinner" />
                                                {tt(t, 'common.translating', 'Перекладаємо...')}
                                            </span>
                                        ) : tt(t, 'common.autoTranslate', 'Автопереклад')}
                                    </button>
                                </div>

                                <div className="services-admin-page__form-grid">
                                    <label className="services-admin-page__field">
                                        <span>{tt(t, 'servicesAdmin.name', 'Назва')} ({serviceLang.toUpperCase()})</span>
                                        <input
                                            value={serviceForm.name[serviceLang]}
                                            onChange={(e) =>
                                                setServiceForm((prev) => ({
                                                    ...prev,
                                                    name: { ...prev.name, [serviceLang]: e.target.value },
                                                }))
                                            }
                                        />
                                    </label>

                                    <label className="services-admin-page__field">
                                        <span>{tt(t, 'servicesAdmin.category', 'Категорія')}</span>
                                        <select
                                            value={serviceForm.categoryId}
                                            onChange={(e) =>
                                                setServiceForm((prev) => ({
                                                    ...prev,
                                                    categoryId: e.target.value,
                                                }))
                                            }
                                        >
                                            <option value="">{tt(t, 'servicesAdmin.selectCategory', 'Оберіть категорію')}</option>
                                            {categories.map((item) => (
                                                <option key={item.id} value={item.id}>
                                                    {pickI18nText(item.name, currentLang)}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <label className="services-admin-page__field services-admin-page__field--full">
                                        <span>{tt(t, 'servicesAdmin.description', 'Опис')} ({serviceLang.toUpperCase()})</span>
                                        <textarea
                                            rows={5}
                                            value={serviceForm.description[serviceLang]}
                                            onChange={(e) =>
                                                setServiceForm((prev) => ({
                                                    ...prev,
                                                    description: {
                                                        ...prev.description,
                                                        [serviceLang]: e.target.value,
                                                    },
                                                }))
                                            }
                                        />
                                    </label>

                                    <label className="services-admin-page__field">
                                        <span>{tt(t, 'servicesAdmin.order', 'Порядок')}</span>
                                        <input
                                            type="number"
                                            value={serviceForm.sortOrder}
                                            onChange={(e) =>
                                                setServiceForm((prev) => ({
                                                    ...prev,
                                                    sortOrder: e.target.value,
                                                }))
                                            }
                                        />
                                    </label>

                                    <label className="services-admin-page__field">
                                        <span>{tt(t, 'servicesAdmin.duration', 'Тривалість (хв)')}</span>
                                        <input
                                            type="number"
                                            value={serviceForm.durationMinutes}
                                            onChange={(e) =>
                                                setServiceForm((prev) => ({
                                                    ...prev,
                                                    durationMinutes: e.target.value,
                                                }))
                                            }
                                        />
                                    </label>

                                    <label className="services-admin-page__field">
                                        <span>{tt(t, 'servicesAdmin.priceUah', 'Ціна (грн)')}</span>
                                        <input
                                            type="number"
                                            step="1"
                                            value={serviceForm.priceUah}
                                            onChange={(e) =>
                                                setServiceForm((prev) => ({
                                                    ...prev,
                                                    priceUah: e.target.value,
                                                }))
                                            }
                                        />
                                    </label>

                                    <label className="services-admin-page__switch">
                                        <span>{tt(t, 'servicesAdmin.active', 'Активна')}</span>
                                        <input
                                            type="checkbox"
                                            checked={serviceForm.isActive}
                                            onChange={(e) =>
                                                setServiceForm((prev) => ({
                                                    ...prev,
                                                    isActive: e.target.checked,
                                                }))
                                            }
                                        />
                                    </label>

                                    <div className="services-admin-page__field services-admin-page__field--full">
                                        <span>{tt(t, 'servicesAdmin.specialties', 'Спеціальності')}</span>
                                        <div className="services-admin-page__specialties">
                                            {specialties.map((specialty) => {
                                                const active = serviceForm.specialtyIds.includes(specialty.id);
                                                const title = getServiceSpecialtyLabel(specialty, language);

                                                return (
                                                    <button
                                                        key={specialty.id}
                                                        type="button"
                                                        className={active ? 'is-active' : ''}
                                                        onClick={() => toggleSpecialty(specialty.id)}
                                                    >
                                                        {title}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="services-admin-page__field services-admin-page__field--full">
                                        <span>{tt(t, 'servicesAdmin.requiredWith', 'Обов’язково разом')}</span>
                                        <div className="services-admin-page__specialties services-admin-page__specialties--scroll">
                                            {dependencyOptions.map((serviceOption) => {
                                                const active = serviceForm.requiredServiceIds.includes(serviceOption.id);
                                                return (
                                                    <button
                                                        key={serviceOption.id}
                                                        type="button"
                                                        className={active ? 'is-active' : ''}
                                                        onClick={() => toggleRequiredService(serviceOption.id)}
                                                    >
                                                        {pickI18nText(serviceOption.name, currentLang)}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="services-admin-page__field services-admin-page__field--full">
                                        <span>{tt(t, 'servicesAdmin.afterService', 'Виконується після послуги')}</span>
                                        <div className="services-admin-page__specialties services-admin-page__specialties--scroll">
                                            {dependencyOptions.map((serviceOption) => {
                                                const active = serviceForm.prerequisiteServiceIds.includes(serviceOption.id);
                                                return (
                                                    <button
                                                        key={serviceOption.id}
                                                        type="button"
                                                        className={active ? 'is-active' : ''}
                                                        onClick={() => togglePrerequisiteService(serviceOption.id)}
                                                    >
                                                        {pickI18nText(serviceOption.name, currentLang)}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <label className="services-admin-page__field services-admin-page__field--compact">
                                        <span>{tt(t, 'servicesAdmin.allowMultipleInCart', 'Можна обрати кілька разів')}</span>
                                        <div className="services-admin-page__switch services-admin-page__switch--compact">
                                            <span>{tt(t, 'servicesAdmin.allowMultipleInCart', 'Можна обрати кілька разів')}</span>
                                            <input
                                                type="checkbox"
                                                checked={serviceForm.allowMultipleInCart}
                                                onChange={(e) =>
                                                    setServiceForm((prev) => ({
                                                        ...prev,
                                                        allowMultipleInCart: e.target.checked,
                                                        maxCartQuantity: e.target.checked
                                                            ? (Number(prev.maxCartQuantity || '1') > 1 ? prev.maxCartQuantity : '2')
                                                            : '1',
                                                    }))
                                                }
                                            />
                                        </div>
                                    </label>

                                    <label className="services-admin-page__field services-admin-page__field--compact">
                                        <span>{tt(t, 'servicesAdmin.maxCartQuantity', 'Макс. кількість у кошику')}</span>
                                        <input
                                            type="number"
                                            min={serviceForm.allowMultipleInCart ? '2' : '1'}
                                            value={serviceForm.maxCartQuantity}
                                            disabled={!serviceForm.allowMultipleInCart}
                                            onChange={(e) =>
                                                setServiceForm((prev) => ({
                                                    ...prev,
                                                    maxCartQuantity: e.target.value,
                                                }))
                                            }
                                        />
                                    </label>

                                    <label className="services-admin-page__field">
                                        <span>{tt(t, 'servicesAdmin.minIntervalDays', 'Мін. інтервал (днів)')}</span>
                                        <input
                                            type="number"
                                            min="0"
                                            value={serviceForm.minIntervalDays}
                                            onChange={(e) =>
                                                setServiceForm((prev) => ({
                                                    ...prev,
                                                    minIntervalDays: e.target.value,
                                                }))
                                            }
                                        />
                                    </label>

                                    <label className="services-admin-page__field">
                                        <span>{tt(t, 'servicesAdmin.maxIntervalDays', 'Макс. інтервал (днів)')}</span>
                                        <input
                                            type="number"
                                            min="0"
                                            value={serviceForm.maxIntervalDays}
                                            onChange={(e) =>
                                                setServiceForm((prev) => ({
                                                    ...prev,
                                                    maxIntervalDays: e.target.value,
                                                }))
                                            }
                                        />
                                    </label>
                                </div>

                                <div className="services-admin-page__form-actions">
                                    <button type="submit" disabled={savingService}>
                                        {savingService
                                            ? tt(t, 'common.saving', 'Збереження...')
                                            : serviceModalMode === 'edit'
                                                ? tt(t, 'servicesAdmin.updateService', 'Оновити послугу')
                                                : tt(t, 'servicesAdmin.createService', 'Створити послугу')}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}