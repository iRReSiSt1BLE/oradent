import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addServiceToCartWithRules, getCart, removeServiceFromCart } from '../../shared/utils/cartStorage.ts';
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
import {
    buildHomeContentImageUrl,
    getAdminHomeContent,
    getPublicHomeContent,
    type HomeContentBlock,
    type HomeContentI18n,
} from '../../shared/api/homeContentApi';
import { useI18n } from '../../shared/i18n/I18nProvider';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import ReviewModal from '../../shared/ui/ReviewModal/ReviewModal';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import HomeContentManager from './components/HomeContentManager';
import './HomePage.scss';

type CatalogCategory = ServiceCategory & { services: ClinicService[] };

type AlertState = {
    id: string;
    variant: 'success' | 'error' | 'info';
    message: string;
};

function parseDbI18nValue(raw: unknown, language: string): string {
    if (!raw) return '';
    if (typeof raw === 'object' && raw !== null) {
        const obj = raw as Record<string, unknown>;
        if ('ua' in obj || 'en' in obj || 'de' in obj || 'fr' in obj) {
            return String(obj[language] || obj.ua || obj.en || obj.de || obj.fr || '');
        }
        if ('i18n' in obj && obj.i18n) {
            const map = obj.i18n as Record<string, string>;
            return map[language] || map.ua || map.en || map.de || map.fr || '';
        }
        if ('value' in obj && typeof obj.value === 'string') return obj.value;
        if ('name' in obj) return parseDbI18nValue(obj.name, language);
        if ('data' in obj && obj.data && typeof obj.data === 'object') {
            const data = obj.data as Record<string, string>;
            return data[language] || data.ua || data.en || data.de || data.fr || '';
        }
        return '';
    }
    if (typeof raw === 'string') {
        if (!raw.includes('__ORADENT_I18N__')) return raw;
        try {
            const start = raw.indexOf('{');
            if (start === -1) return raw;
            const parsed = JSON.parse(raw.slice(start)) as { data?: Record<string, string> };
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

function pickI18n(raw: HomeContentI18n | undefined, language: string): string {
    if (!raw) return '';
    return raw[language as keyof HomeContentI18n] || raw.ua || raw.en || raw.de || raw.fr || '';
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

function HomeSkeleton() {
    return (
        <main className="home-page home-page--skeleton">
            <section className="home-page__skeleton-hero container">
                <div>
                    <span />
                    <h1 />
                    <p />
                    <button type="button" aria-hidden="true" />
                </div>
            </section>

            <section className="home-page__skeleton-split container">
                <div className="home-page__skeleton-picture" />
                <div className="home-page__skeleton-copy">
                    <span />
                    <h2 />
                    <p />
                    <p />
                </div>
            </section>

            <section className="home-page__skeleton-intro container">
                <span />
                <h2 />
                <p />
            </section>

            <section className="home-page__skeleton-grid container">
                {Array.from({ length: 4 }).map((_, index) => (
                    <article key={index}>
                        <span />
                        <h3 />
                        <p />
                    </article>
                ))}
            </section>
        </main>
    );
}

function HomeImage({ block, language }: { block: HomeContentBlock; language: string }) {
    if (!block.image) {
        return (
            <div className="home-page__content-image home-page__content-image--placeholder">
                <span>ORADENT</span>
            </div>
        );
    }

    const version = block.image.version;
    const desktop = block.image.desktop ? buildHomeContentImageUrl(block.key, 'desktop', version) : '';
    const tablet = block.image.tablet ? buildHomeContentImageUrl(block.key, 'tablet', version) : desktop;
    const mobile = block.image.mobile ? buildHomeContentImageUrl(block.key, 'mobile', version) : tablet || desktop;
    const alt = pickI18n(block.imageAlt, language) || pickI18n(block.title, language) || 'Oradent';

    return (
        <picture className="home-page__content-image" key={`${block.key}-${version}`}>
            {mobile ? <source media="(max-width: 640px)" srcSet={mobile} /> : null}
            {tablet ? <source media="(max-width: 1024px)" srcSet={tablet} /> : null}
            <img src={desktop || tablet || mobile} alt={alt} loading="lazy" decoding="async" />
        </picture>
    );
}

function ContentButton({ block, language }: { block: HomeContentBlock; language: string }) {
    const href = block.buttonHref || '/smart-appointment';
    if (href.startsWith('http')) {
        return (
            <a className="home-page__content-button" href={href} target="_blank" rel="noreferrer">
                {pickI18n(block.buttonLabel, language) || 'Записатися'}
            </a>
        );
    }

    return (
        <Link className="home-page__content-button" to={href}>
            {pickI18n(block.buttonLabel, language) || 'Записатися'}
        </Link>
    );
}

function IntroBlock({ block, language, compact = false }: { block: HomeContentBlock; language: string; compact?: boolean }) {
    return (
        <section className={`home-page__intro container home-reveal home-reveal--scale ${compact ? 'home-page__intro--compact' : ''}`}>
            {pickI18n(block.eyebrow, language) ? <p className="home-page__eyebrow">{pickI18n(block.eyebrow, language)}</p> : null}
            <h2>{pickI18n(block.title, language)}</h2>
            {pickI18n(block.subtitle, language) ? <p>{pickI18n(block.subtitle, language)}</p> : null}
            {pickI18n(block.body, language) ? <span>{pickI18n(block.body, language)}</span> : null}
        </section>
    );
}

export default function HomePage() {
    const { t, language } = useI18n();
    const token = getToken();
    const role = getUserRole();
    const isContentManager = role === 'ADMIN' || role === 'SUPER_ADMIN';
    const [searchParams, setSearchParams] = useSearchParams();

    const tx = (key: string, fallback: string) => {
        const value = t(key);
        return !value || value === key ? fallback : value;
    };

    function pushAlert(alert: Omit<AlertState, 'id'>) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setAlerts((prev) => [...prev, { ...alert, id }].slice(-5));
    }

    function removeAlert(id: string) {
        setAlerts((prev) => prev.filter((item) => item.id !== id));
    }

    const [doctors, setDoctors] = useState<PublicDoctorItem[]>([]);
    const [categories, setCategories] = useState<CatalogCategory[]>([]);
    const [homeBlocks, setHomeBlocks] = useState<HomeContentBlock[]>([]);
    const [openedIds, setOpenedIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [managerOpen, setManagerOpen] = useState(false);
    const [alerts, setAlerts] = useState<AlertState[]>([]);
    const [pendingServiceId, setPendingServiceId] = useState<string | null>(null);
    const [hoveredServiceId, setHoveredServiceId] = useState<string | null>(null);
    const [reviewAppointmentId, setReviewAppointmentId] = useState<string | null>(null);
    const [cartVersion, setCartVersion] = useState(0);

    useEffect(() => {
        async function load() {
            try {
                setLoading(true);
                const [doctorsRes, catalogRes, homeContentRes] = await Promise.all([
                    getPublicDoctors(),
                    getPublicCatalog(),
                    getPublicHomeContent(),
                ]);
                const doctorsList = Array.isArray((doctorsRes as { doctors?: PublicDoctorItem[] })?.doctors) ? doctorsRes.doctors : [];
                const categoriesList = Array.isArray((catalogRes as { categories?: CatalogCategory[] })?.categories) ? catalogRes.categories : [];
                const blocksList = Array.isArray(homeContentRes.blocks) ? homeContentRes.blocks : [];
                setDoctors(doctorsList);
                setCategories(categoriesList);
                setHomeBlocks(blocksList);
                setOpenedIds(categoriesList.map((c: CatalogCategory) => c.id));
            } catch {
                pushAlert({ variant: 'error', message: tx('home.loadError', 'Не вдалося завантажити головну сторінку') });
            } finally {
                setLoading(false);
            }
        }
        void load();
    }, [language]);

    useEffect(() => {
        const reviewId = searchParams.get('reviewAppointmentId');
        if (!reviewId) return;

        if (!token) {
            pushAlert({ variant: 'info', message: t('home.reviewLoginRequired') });
            return;
        }

        setReviewAppointmentId(reviewId);
    }, [searchParams, token]);

    useEffect(() => {
        const nodes = Array.from(document.querySelectorAll<HTMLElement>('.home-reveal'));
        if (!nodes.length) return undefined;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('is-visible');
                        observer.unobserve(entry.target);
                    }
                });
            },
            { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
        );

        nodes.forEach((node) => observer.observe(node));
        return () => observer.disconnect();
    }, [homeBlocks, doctors, categories]);

    useEffect(() => {
        if (!isContentManager || !token) return undefined;

        const onOpenHomeContentManager = () => {
            void openContentManager();
        };

        window.addEventListener('oradent-open-home-content-manager', onOpenHomeContentManager);

        return () => {
            window.removeEventListener('oradent-open-home-content-manager', onOpenHomeContentManager);
        };
    }, [isContentManager, token]);

    useEffect(() => {
        const onCartChanged = () => setCartVersion((value) => value + 1);
        window.addEventListener('oradent-cart-changed', onCartChanged);
        return () => window.removeEventListener('oradent-cart-changed', onCartChanged);
    }, []);

    const closeReviewFromHome = () => {
        setReviewAppointmentId(null);
        if (searchParams.get('reviewAppointmentId')) {
            const next = new URLSearchParams(searchParams);
            next.delete('reviewAppointmentId');
            setSearchParams(next, { replace: true });
        }
    };

    const visibleDoctors = useMemo(() => doctors.slice(0, 8), [doctors]);
    const allServices = useMemo(() => categories.flatMap((category) => category.services || []), [categories]);
    const cartSnapshot = useMemo(() => getCart(), [cartVersion, alerts, pendingServiceId, categories]);
    const visibleHomeBlocks = useMemo(
        () => homeBlocks.filter((block) => block.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)),
        [homeBlocks],
    );
    const footerBlock = visibleHomeBlocks.find((block) => block.key === 'footer');
    const flowBlocks = visibleHomeBlocks.filter((block) => block.key !== 'footer');
    const hasDoctorsAnchor = flowBlocks.some((block) => block.key === 'doctorsIntro');
    const hasServicesAnchor = flowBlocks.some((block) => block.key === 'servicesIntro');

    async function openContentManager() {
        if (!token) return;
        setAlerts([]);

        try {
            const response = await getAdminHomeContent(token);
            setHomeBlocks(response.blocks);
            setManagerOpen(true);
        } catch (err) {
            pushAlert({ variant: 'error', message: err instanceof Error ? err.message : t('home.openContentManagerError') });
        }
    }

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
            pushAlert({ variant: 'info', message: tx('home.singleOnlyInfo', 'Цю послугу можна додати до кошика лише один раз') });
            return;
        }

        if (result.blockedReason === 'maxQuantity') {
            pushAlert({ variant: 'info', message: tx('home.maxQuantityReached', 'Досягнуто максимальної кількості цієї послуги в кошику') });
            return;
        }

        pushAlert({ variant: 'success', message: tx('home.addedToCart', 'Послугу додано до кошика') });
    }

    function handleAddToCart(service: ClinicService) {
        if (serviceHasRules(service) && pendingServiceId !== service.id) {
            setPendingServiceId(service.id);
            return;
        }
        finalizeAdd(service);
    }

    function handleRemoveOneFromCart(cartItemId: string) {
        removeServiceFromCart(cartItemId);
        setCartVersion((value) => value + 1);
    }

    function renderDoctorsSection() {
        return (
            <section className="home-page__doctors container" key="fixed-doctors-section">
                <div className="home-page__doctors-grid">
                    {visibleDoctors.map((doctor: PublicDoctorItem) => {
                        const name = fullDoctorName(doctor);
                        const imageUrl = doctor.hasAvatar ? buildDoctorAvatarUrl(doctor.id, 'md', doctor.avatarVersion) : null;
                        const specialtiesList = Array.isArray(doctor.specialties)
                            ? doctor.specialties.map((item) => parseDbI18nValue(item.i18n || item.value, language)).filter(Boolean)
                            : [];
                        const specialtyText = specialtiesList.length > 0 ? specialtiesList.join(', ') : parseDbI18nValue(doctor.specialtyI18n || doctor.specialty, language);
                        const infoBlock = parseDbI18nValue(doctor.infoBlockI18n || doctor.infoBlock, language);
                        return (
                            <article key={doctor.id} className="home-page__doctor-card">
                                <Link to={`/doctors/${doctor.id}`} className="home-page__doctor-photo-wrap home-page__doctor-photo-link">
                                    {imageUrl ? <img className="home-page__doctor-photo" src={imageUrl} alt={name} /> : <div className="home-page__doctor-photo home-page__doctor-photo--placeholder">OR</div>}
                                </Link>
                                <h3 className="home-page__doctor-name">
                                    <Link to={`/doctors/${doctor.id}`} className="home-page__doctor-link">{name}</Link>
                                </h3>
                                {specialtyText ? <p className="home-page__doctor-specialty">{specialtyText}</p> : null}
                                {infoBlock ? <p className="home-page__doctor-description">{infoBlock}</p> : null}
                            </article>
                        );
                    })}
                </div>
            </section>
        );
    }

    function renderCatalogSection() {
        return (
            <section className="home-page__catalog container" key="fixed-catalog-section">
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
                                            const cartItem = cartSnapshot.find((item) => item.serviceId === service.id) || null;
                                            const quantityInCart = cartItem?.quantity || 0;
                                            const showInfo = pendingServiceId === service.id;
                                            const ruleMessages = buildRuleMessages(service);
                                            const isMultiple = Boolean(service.allowMultipleInCart);
                                            const maxReached = service.maxCartQuantity !== null && quantityInCart >= service.maxCartQuantity;
                                            return (
                                                <li key={service.id} className="home-page__service-item-wrap">
                                                    <div className={`home-page__service-item ${isMultiple ? 'home-page__service-item--multiple' : ''}`}>
                                                        <div className="home-page__service-left">
                                                            <div className="home-page__service-name-wrap">
                                                                <span className="home-page__service-name">{parseDbI18nValue(service.name, language)}</span>
                                                                <strong className="home-page__service-price">{service.priceUah} грн</strong>
                                                                {quantityInCart > 0 ? <span className="home-page__service-qty">x{quantityInCart}</span> : null}
                                                            </div>
                                                            {isMultiple ? (
                                                                <span className="home-page__service-multiple-hint">
                                                                    {tx('home.multipleServiceHint', 'Можна обрати кількість')}
                                                                    {service.maxCartQuantity ? ` · max ${service.maxCartQuantity}` : ''}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        {isMultiple ? (
                                                            <div className="home-page__quantity-control" aria-label={tx('home.quantityLabel', 'Кількість')}>
                                                                <button
                                                                    type="button"
                                                                    disabled={!cartItem || quantityInCart <= 0}
                                                                    onClick={() => cartItem && handleRemoveOneFromCart(cartItem.cartItemId)}
                                                                    aria-label={tx('home.quantityDecrease', 'Зменшити кількість')}
                                                                >
                                                                    −
                                                                </button>
                                                                <span>{quantityInCart}</span>
                                                                <button
                                                                    type="button"
                                                                    disabled={Boolean(maxReached)}
                                                                    onMouseEnter={() => setHoveredServiceId(service.id)}
                                                                    onMouseLeave={() => setHoveredServiceId((prev) => (prev === service.id ? null : prev))}
                                                                    onClick={() => handleAddToCart(service)}
                                                                    aria-label={tx('home.quantityIncrease', 'Збільшити кількість')}
                                                                >
                                                                    +
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                className="home-page__add-button"
                                                                onMouseEnter={() => setHoveredServiceId(service.id)}
                                                                onMouseLeave={() => setHoveredServiceId((prev) => (prev === service.id ? null : prev))}
                                                                onClick={() => handleAddToCart(service)}
                                                            >
                                                                {tx('home.addToCart', 'Додати до кошика')}
                                                            </button>
                                                        )}
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
        );
    }

    function renderManagedBlock(block: HomeContentBlock, _index: number) {

        if (block.kind === 'hero' || block.key === 'hero') {
            return (
                <section className="home-page__hero container home-reveal home-reveal--scale">
                    <div className="home-page__hero-copy home-page__hero-copy--centered">
                        {pickI18n(block.eyebrow, language) ? <p className="home-page__eyebrow">{pickI18n(block.eyebrow, language)}</p> : null}
                        <h1>{pickI18n(block.title, language)}</h1>
                        {pickI18n(block.subtitle, language) ? <p>{pickI18n(block.subtitle, language)}</p> : null}
                        {pickI18n(block.buttonLabel, language) ? (
                            <Link className="home-page__content-button" to={block.buttonHref || '/smart-appointment'}>
                                {pickI18n(block.buttonLabel, language)}
                            </Link>
                        ) : null}
                    </div>
                </section>
            );
        }

        if (block.kind === 'intro' || block.key === 'doctorsIntro' || block.key === 'servicesIntro') {
            return <IntroBlock block={block} language={language} compact={block.key === 'doctorsIntro' || block.key === 'servicesIntro'} />;
        }

        if (block.kind === 'split') {
            const reverse = block.key === 'technology';
            const media = (
                <div className={`home-page__split-media home-reveal ${reverse ? 'home-reveal--right' : 'home-reveal--left'}`}>
                    <HomeImage block={block} language={language} />
                </div>
            );
            const copy = (
                <div className={`home-page__split-copy home-reveal ${reverse ? 'home-reveal--left' : 'home-reveal--right'}`}>
                    {pickI18n(block.eyebrow, language) ? <p className="home-page__eyebrow">{pickI18n(block.eyebrow, language)}</p> : null}
                    <h2>{pickI18n(block.title, language)}</h2>
                    <p>{pickI18n(block.body, language)}</p>
                    {block.items?.length ? (
                        <div className="home-page__mini-cards">
                            {block.items.map((item, itemIndex) => (
                                <article key={`${block.key}-${itemIndex}`}>
                                    <strong>{pickI18n(item.title, language)}</strong>
                                    <span>{pickI18n(item.text, language)}</span>
                                </article>
                            ))}
                        </div>
                    ) : null}
                </div>
            );

            return (
                <section className={`home-page__split ${reverse ? 'home-page__split--reverse' : ''} container`}>
                    {reverse ? copy : media}
                    {reverse ? media : copy}
                </section>
            );
        }

        if (block.kind === 'steps') {
            return (
                <section className="home-page__steps container">
                    <div className="home-page__section-head home-reveal home-reveal--left">
                        {pickI18n(block.eyebrow, language) ? <p className="home-page__eyebrow">{pickI18n(block.eyebrow, language)}</p> : null}
                        <h2>{pickI18n(block.title, language)}</h2>
                    </div>
                    <div className="home-page__steps-grid">
                        {block.items.map((item, itemIndex) => (
                            <article key={`${block.key}-${itemIndex}`}>
                                <h3>{pickI18n(item.title, language)}</h3>
                                <p>{pickI18n(item.text, language)}</p>
                            </article>
                        ))}
                    </div>
                </section>
            );
        }

        if (block.kind === 'cta') {
            return (
                <section className="home-page__cta container home-reveal home-reveal--scale">
                    <div>
                        <h2>{pickI18n(block.title, language)}</h2>
                        <p>{pickI18n(block.subtitle, language)}</p>
                    </div>
                    <ContentButton block={block} language={language} />
                </section>
            );
        }

        return null;
    }

    if (loading) {
        return <HomeSkeleton />;
    }

    return (
        <main className="home-page">
            {alerts.map((alert) => (
                <AlertToast
                    key={alert.id}
                    variant={alert.variant}
                    message={alert.message}
                    onClose={() => removeAlert(alert.id)}
                />
            ))}
            {token ? (
                <ReviewModal
                    open={Boolean(reviewAppointmentId)}
                    token={token}
                    appointmentId={reviewAppointmentId}
                    onClose={closeReviewFromHome}
                    onSubmitted={(_, message) => {
                        pushAlert({ variant: 'success', message });
                        closeReviewFromHome();
                    }}
                />
            ) : null}


            {flowBlocks.map((block, index) => (
                <Fragment key={block.key}>
                    {renderManagedBlock(block, index)}
                    {block.key === 'doctorsIntro' ? renderDoctorsSection() : null}
                    {block.key === 'servicesIntro' ? renderCatalogSection() : null}
                </Fragment>
            ))}

            {!hasDoctorsAnchor ? renderDoctorsSection() : null}
            {!hasServicesAnchor ? renderCatalogSection() : null}

            {footerBlock ? (
                <footer className="home-page__footer">
                    <div className="container home-page__footer-inner">
                        <div>
                            <strong>{pickI18n(footerBlock.title, language)}</strong>
                            <p>{pickI18n(footerBlock.subtitle, language)}</p>
                        </div>
                        <span>{pickI18n(footerBlock.body, language)}</span>
                    </div>
                </footer>
            ) : null}

            {managerOpen && token ? (
                <HomeContentManager
                    token={token}
                    blocks={homeBlocks}
                    onClose={() => setManagerOpen(false)}
                    onChanged={(blocks) => setHomeBlocks(blocks)}
                />
            ) : null}
        </main>
    );
}
