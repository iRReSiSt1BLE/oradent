import { Link, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { getToken, getUserRole, removeToken } from '../../shared/utils/authStorage';
import { useI18n } from '../../shared/i18n/I18nProvider';
import type { AppLanguage } from '../../shared/i18n/translations';
import './Header.scss';

type HeaderProps = {
    cartCount?: number;
    onOpenCart?: () => void;
};

type NavItemProps = {
    to: string;
    label: string;
    active: boolean;
};

type LanguageOption = {
    code: AppLanguage;
    short: string;
    label: string;
    flag: string;
};

const LANG_OPTIONS: LanguageOption[] = [
    { code: 'ua', short: 'UA', label: 'Українська', flag: '🇺🇦' },
    { code: 'en', short: 'EN', label: 'English', flag: '🇬🇧' },
    { code: 'de', short: 'DE', label: 'Deutsch', flag: '🇩🇪' },
    { code: 'fr', short: 'FR', label: 'Français', flag: '🇫🇷' },
];

function NavItem({ to, label, active }: NavItemProps) {
    return (
        <Link className={`header__link ${active ? 'header__link--active' : ''}`} to={to}>
            <span className="header__link-icon-wrap" aria-hidden="true">
                <img className="header__link-icon header__link-icon--default" src="/nav-tooth.svg" alt="" />
                <img className="header__link-icon header__link-icon--filled" src="/nav-tooth-fill.svg" alt="" />
            </span>
            <span className="header__link-label">{label}</span>
        </Link>
    );
}

type StaffMenuItem = {
    to: string;
    label: string;
};

export default function Header({ cartCount = 0, onOpenCart }: HeaderProps) {
    const location = useLocation();
    const token = getToken();
    const role = getUserRole();
    const { language, setLanguage, t } = useI18n();

    const isStaff = role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'DOCTOR';
    const isSuperAdmin = role === 'SUPER_ADMIN';
    const isAdminOrSuperAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
    const isDoctor = role === 'DOCTOR';

    const [menuOpen, setMenuOpen] = useState(false);
    const [langOpen, setLangOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const langRef = useRef<HTMLDivElement | null>(null);

    const activeLang = LANG_OPTIONS.find((l) => l.code === language) || LANG_OPTIONS[0];

    function handleLogout() {
        removeToken();
        window.location.href = '/login';
    }

    function isActive(path: string) {
        return location.pathname === path;
    }

    const staffItems: StaffMenuItem[] = [
        { to: '/', label: t('header.home') },
        { to: '/profile', label: t('header.profile') },
        ...(isDoctor ? [{ to: '/doctor/appointments', label: t('header.myAppointments') }] : []),
        ...(isAdminOrSuperAdmin ? [{ to: '/appointment', label: t('header.records') }] : []),
        ...(isAdminOrSuperAdmin ? [{ to: '/admin/services/list', label: t('header.servicesView') }] : []),
        ...(isAdminOrSuperAdmin ? [{ to: '/admin/services/create', label: t('header.servicesCreate') }] : []),
        ...(isAdminOrSuperAdmin ? [{ to: '/admin/doctors/list', label: t('header.doctors') }] : []),
        ...(isAdminOrSuperAdmin ? [{ to: '/admin/doctors/schedule', label: t('header.schedules') }] : []),
        ...(isSuperAdmin ? [{ to: '/admins/list', label: t('header.adminsList') }] : []),
        ...(isSuperAdmin ? [{ to: '/admins/create', label: t('header.adminsCreate') }] : []),
    ];

    useEffect(() => {
        function onClickOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
            if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
        }

        function onEsc(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                setMenuOpen(false);
                setLangOpen(false);
            }
        }

        document.addEventListener('mousedown', onClickOutside);
        document.addEventListener('keydown', onEsc);

        return () => {
            document.removeEventListener('mousedown', onClickOutside);
            document.removeEventListener('keydown', onEsc);
        };
    }, []);

    useEffect(() => {
        setMenuOpen(false);
        setLangOpen(false);
    }, [location.pathname]);

    function renderLanguageDropdown() {
        return (
            <div className="header__lang" ref={langRef}>
                <button
                    type="button"
                    className={`header__lang-button ${langOpen ? 'is-open' : ''}`}
                    onClick={() => setLangOpen((prev) => !prev)}
                    aria-label={t('header.language')}
                >
                    <span className="header__lang-short">{activeLang.short}</span>
                    <span className="header__lang-caret" />
                </button>

                {langOpen && (
                    <div className="header__lang-menu">
                        {LANG_OPTIONS.map((lang) => (
                            <button
                                key={lang.code}
                                type="button"
                                className={`header__lang-item ${language === lang.code ? 'is-active' : ''}`}
                                onClick={() => {
                                    setLanguage(lang.code);
                                    setLangOpen(false);
                                }}
                            >
                                <span className="header__lang-item-flag" aria-hidden="true">
                                    {lang.flag}
                                </span>
                                <span className="header__lang-item-text">{lang.label}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    function renderCartButton() {
        return (
            <button
                className="header__action header__cart-action"
                type="button"
                onClick={onOpenCart}
                aria-label={t('cart.title') || 'Cart'}
            >
                <span className="header__cart-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24">
                        <path
                            fill="none"
                            stroke="#000"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.5"
                            d="M19.298 9.566H4.702a1.96 1.96 0 0 0-1.535.744a1.94 1.94 0 0 0-.363 1.66l1.565 6.408a3.9 3.9 0 0 0 1.4 2.072c.682.519 1.517.8 2.376.8h7.708c.859 0 1.694-.281 2.376-.8a3.9 3.9 0 0 0 1.4-2.072l1.565-6.407a1.94 1.94 0 0 0-1.044-2.208a2 2 0 0 0-.854-.197M8.087 13.46v3.895M12 13.46v3.895m3.913-3.895v3.895m2.935-7.789a6.8 6.8 0 0 0-2.006-4.82A6.86 6.86 0 0 0 12 2.75a6.86 6.86 0 0 0-4.842 1.996a6.8 6.8 0 0 0-2.005 4.82"
                        />
                    </svg>
                </span>

                {cartCount > 0 && <span className="header__cart-badge">{cartCount}</span>}
            </button>
        );
    }

    return (
        <header className="header">
            {!isStaff && (
                <div className="header__topbar">
                    <a className="header__topbar-link header__topbar-link--left" href="tel:+380000000000">
                        {t('header.call')}
                    </a>

                    <Link className="header__topbar-link header__topbar-link--right" to="/appointment">
                        {t('header.book')}
                    </Link>
                </div>
            )}

            <div className="header__main">
                <div className="container header__container">
                    <Link className="header__logo" to="/">
                        <span className="header__logo-text">
                            <span className="header__logo-title">ORADENT</span>
                            <span className="header__logo-subtitle">DENTAL CLINIC MANAGEMENT SYSTEM</span>
                        </span>
                    </Link>

                    <nav className="header__nav">
                        {!token ? (
                            <>
                                <NavItem to="/" label={t('header.home')} active={isActive('/')} />
                                <NavItem to="/appointment" label={t('header.appointment')} active={isActive('/appointment')} />
                                <NavItem to="/register" label={t('header.register')} active={isActive('/register')} />
                                <NavItem to="/login" label={t('header.login')} active={isActive('/login')} />
                                {renderLanguageDropdown()}
                                {renderCartButton()}
                            </>
                        ) : isStaff ? (
                            <>
                                <div className="header__menu-wrap" ref={menuRef}>
                                    <button
                                        type="button"
                                        className={`header__menu-button ${menuOpen ? 'header__menu-button--open' : ''}`}
                                        onClick={() => setMenuOpen((prev) => !prev)}
                                    >
                                        {t('header.panel')}
                                        <span className="header__menu-caret" />
                                    </button>

                                    {menuOpen && (
                                        <div className="header__menu-panel">
                                            {staffItems.map((item) => (
                                                <Link
                                                    key={item.to}
                                                    to={item.to}
                                                    className={`header__menu-link ${isActive(item.to) ? 'header__menu-link--active' : ''}`}
                                                >
                                                    {item.label}
                                                </Link>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {renderLanguageDropdown()}
                                {renderCartButton()}

                                <button className="header__action" type="button" onClick={handleLogout}>
                                    {t('header.logout')}
                                </button>
                            </>
                        ) : (
                            <>
                                <NavItem to="/" label={t('header.home')} active={isActive('/')} />
                                <NavItem to="/appointment" label={t('header.appointment')} active={isActive('/appointment')} />
                                <NavItem to="/profile" label={t('header.profile')} active={isActive('/profile')} />
                                {renderLanguageDropdown()}
                                {renderCartButton()}
                                <button className="header__action" type="button" onClick={handleLogout}>
                                    {t('header.logout')}
                                </button>
                            </>
                        )}
                    </nav>
                </div>
            </div>
        </header>
    );
}