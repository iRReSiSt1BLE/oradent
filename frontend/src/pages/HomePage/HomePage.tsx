import { useEffect, useMemo, useState } from 'react';
import { addServiceToCartWithRules, getCart } from '../../shared/utils/cartStorage.ts';
import {
    getPublicDoctors,
    type PublicDoctorItem,
    buildDoctorAvatarUrl,
} from '../../shared/api/doctorApi';
import {
    getPublicCatalog,
    type ClinicService,
    type ServiceCategory,
} from '../../shared/api/servicesApi.ts';
import { useI18n } from '../../shared/i18n/I18nProvider';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import './HomePage.scss';

type CatalogCategory = ServiceCategory & { services: ClinicService[] };

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
        if ('value' in raw && typeof raw.value === 'string') return raw.value;
        if ('name' in raw) return parseDbI18nValue(raw.name, language);
        if ('data' in raw && raw.data && typeof raw.data === 'object') {
            return raw.data[language] || raw.data.ua || raw.data.en || raw.data.de || raw.data.fr || '';
        }
        return '';
    }
    if (typeof raw === 'string') {
        if (!raw.includes('__ORADENT_I18N__')) return raw;
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

function fullDoctorName(d: PublicDoctorItem) {
    return `${d.lastName ?? ''} ${d.firstName ?? ''} ${d.middleName ?? ''}`.replace(/\s+/g, ' ').trim();
}

function serviceHasRules(service: ClinicService) {
    return Boolean(
        (service.requiredServiceIds || []).length ||
            (service.prerequisiteServiceIds || []).length ||
            service.minIntervalDays !== null ||
            service.maxIntervalDays !== null,
    );
}

export default function HomePage() {
    const { t, language } = useI18n();

    const tx = (key: string, fallback: string) => {
        const value = t(key);
        return !value || value === key ? fallback : value;
    };

    const [doctors, setDoctors] = useState<PublicDoctorItem[]>([]);
    const [categories, setCategories] = useState<CatalogCategory[]>([]);
    const [openedIds, setOpenedIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [alert, setAlert] = useState<AlertState>(null);
    const [pendingServiceId, setPendingServiceId] = useState<string | null>(null);
    const [hoveredServiceId, setHoveredServiceId] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            try {
                setLoading(true);
                const [doctorsRes, catalogRes] = await Promise.all([getPublicDoctors(), getPublicCatalog()]);
                const doctorsList = Array.isArray((doctorsRes as any)?.doctors) ? (doctorsRes as any).doctors : [];
                const categoriesList = Array.isArray((catalogRes as any)?.categories) ? (catalogRes as any).categories : [];
                setDoctors(doctorsList);
                setCategories(categoriesList);
                setOpenedIds(categoriesList.map((c: CatalogCategory) => c.id));
            } catch {
                setAlert({ variant: 'error', message: tx('home.loadError', 'Не вдалося завантажити головну сторінку') });
            } finally {
                setLoading(false);
            }
        }
        void load();
    }, [language]);

    const visibleDoctors = useMemo(() => doctors.slice(0, 8), [doctors]);
    const allServices = useMemo(() => categories.flatMap((category) => category.services || []), [categories]);
    const cartSnapshot = useMemo(() => getCart(), [alert, pendingServiceId, categories]);

    function buildRuleMessages(service: ClinicService) {
        const messages: string[] = [];
        const requiredNames = (service.requiredServiceIds || [])
            .map((id) => allServices.find((item) => item.id === id))
            .filter(Boolean)
            .map((item) => parseDbI18nValue((item as ClinicService).name, language));

        const prerequisiteNames = (service.prerequisiteServiceIds || [])
            .map((id) => allServices.find((item) => item.id === id))
            .filter(Boolean)
            .map((item) => parseDbI18nValue((item as ClinicService).name, language));

        if (requiredNames.length) {
            messages.push(
                tx('home.ruleRequiredWith', 'Для цієї послуги обов’язково потрібні ще такі послуги:') +
                    ' ' +
                    requiredNames.join(', '),
            );
        }

        if (prerequisiteNames.length) {
            messages.push(
                tx('home.ruleAfterServices', 'Цю послугу потрібно виконувати після таких процедур:') +
                    ' ' +
                    prerequisiteNames.join(', '),
            );
        }

        if (service.minIntervalDays !== null || service.maxIntervalDays !== null) {
            const parts: string[] = [];
            if (service.minIntervalDays !== null) {
                parts.push(
                    `${tx('home.ruleMinInterval', 'не раніше ніж через')} ${service.minIntervalDays} ${tx('home.daysShort', 'дн.')}`,
                );
            }
            if (service.maxIntervalDays !== null) {
                parts.push(
                    `${tx('home.ruleMaxInterval', 'не пізніше ніж через')} ${service.maxIntervalDays} ${tx('home.daysShort', 'дн.')}`,
                );
            }
            if (parts.length) {
                messages.push(
                    `${tx('home.ruleIntervalLabel', 'Рекомендований інтервал між процедурами:')} ${parts.join(', ')}`,
                );
            }
        }

        return messages;
    }

    function toggleCategory(id: string) {
        setOpenedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
    }

    function finalizeAdd(service: ClinicService) {
        const result = addServiceToCartWithRules(service, allServices);
        setPendingServiceId(null);

        if (result.blockedReason === 'single') {
            setAlert({ variant: 'info', message: tx('home.singleOnlyInfo', 'Цю послугу можна додати до кошика лише один раз') });
            return;
        }

        if (result.blockedReason === 'maxQuantity') {
            setAlert({ variant: 'info', message: tx('home.maxQuantityReached', 'Досягнуто максимальної кількості цієї послуги в кошику') });
            return;
        }

        setAlert({ variant: 'success', message: tx('home.addedToCart', 'Послугу додано до кошика') });
    }

    function handleAddToCart(service: ClinicService) {
        if (serviceHasRules(service) && pendingServiceId !== service.id) {
            setPendingServiceId(service.id);
            return;
        }
        finalizeAdd(service);
    }

    if (loading) {
        return <div className="home-page__loading">{tx('home.loading', 'Завантаження...')}</div>;
    }

    return (
        <main className="home-page">
            {alert && <AlertToast variant={alert.variant} message={alert.message} onClose={() => setAlert(null)} />}

            <section className="home-page__doctors container">
                <div className="home-page__doctors-grid">
                    {visibleDoctors.map((doctor: any) => {
                        const name = fullDoctorName(doctor);
                        const imageUrl = doctor.hasAvatar ? buildDoctorAvatarUrl(doctor.id, 'md', doctor.avatarVersion) : null;
                        const specialtiesList = Array.isArray(doctor.specialties)
                            ? doctor.specialties.map((item: any) => item?.i18n?.[language] || item?.i18n?.ua || item?.value || '').filter(Boolean)
                            : [];
                        const specialtyText = specialtiesList.length > 0 ? specialtiesList.join(', ') : doctor.specialtyI18n?.[language] || doctor.specialtyI18n?.ua || doctor.specialty || '';
                        const infoBlock = parseDbI18nValue(doctor.infoBlockI18n || doctor.infoBlock, language);
                        return (
                            <article key={doctor.id} className="home-page__doctor-card">
                                <div className="home-page__doctor-photo-wrap">
                                    {imageUrl ? <img className="home-page__doctor-photo" src={imageUrl} alt={name} /> : <div className="home-page__doctor-photo home-page__doctor-photo--placeholder">X0</div>}
                                </div>
                                <h3 className="home-page__doctor-name">{name}</h3>
                                {specialtyText ? <p className="home-page__doctor-specialty">{specialtyText}</p> : null}
                                {infoBlock ? <p className="home-page__doctor-description">{infoBlock}</p> : null}
                            </article>
                        );
                    })}
                </div>
            </section>

            <section className="home-page__catalog container">
                {categories.map((category) => {
                    const opened = openedIds.includes(category.id);
                    const categoryTitle = parseDbI18nValue(category.name, language);
                    return (
                        <div key={category.id} className="home-page__category">
                            <button type="button" className={`home-page__category-head ${opened ? 'is-open' : ''}`} onClick={() => toggleCategory(category.id)}>
                                <span className="home-page__category-title">{categoryTitle}</span>
                                <span className="home-page__category-toggle">{opened ? '×' : '+'}</span>
                            </button>
                            <div className={`home-page__category-body ${opened ? 'is-open' : ''}`}>
                                <div className="home-page__category-inner">
                                    <ul className="home-page__service-list">
                                        {category.services.map((service) => {
                                            const quantityInCart = cartSnapshot.find((item) => item.serviceId === service.id)?.quantity || 0;
                                            const showInfo = pendingServiceId === service.id;
                                            const ruleMessages = buildRuleMessages(service);
                                            return (
                                                <li key={service.id} className="home-page__service-item-wrap">
                                                    <div className="home-page__service-item">
                                                        <div className="home-page__service-left">
                                                            <div className="home-page__service-name-wrap">
                                                                <span className="home-page__service-name">{parseDbI18nValue(service.name, language)}</span>
                                                                <strong className="home-page__service-price">{service.priceUah} грн</strong>
                                                                {quantityInCart > 0 ? <span className="home-page__service-qty">x{quantityInCart}</span> : null}
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="home-page__add-button"
                                                            onMouseEnter={() => setHoveredServiceId(service.id)}
                                                            onMouseLeave={() => setHoveredServiceId((prev) => (prev === service.id ? null : prev))}
                                                            onClick={() => handleAddToCart(service)}
                                                        >
                                                            {tx('home.addToCart', 'Додати до кошика')}
                                                        </button>
                                                    </div>
                                                    {showInfo ? (
                                                        <div className={`home-page__service-info ${hoveredServiceId === service.id ? 'is-emphasis' : ''}`}>
                                                            {ruleMessages.map((message, index) => (
                                                                <p key={`${service.id}-${index}`}>{message}</p>
                                                            ))}
                                                            <div className="home-page__service-info-actions">
                                                                <button type="button" onClick={() => finalizeAdd(service)}>
                                                                    {tx('home.acknowledged', 'Ознайомився')}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </section>
        </main>
    );
}
