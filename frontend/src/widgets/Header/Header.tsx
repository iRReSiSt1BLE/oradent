import { Link, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { getToken, getUserRole, removeToken } from '../../shared/utils/authStorage';
import './Header.scss';

type NavItemProps = {
    to: string;
    label: string;
    active: boolean;
};

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

export default function Header() {
    const location = useLocation();
    const token = getToken();
    const role = getUserRole();

    const isStaff = role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'DOCTOR';
    const isSuperAdmin = role === 'SUPER_ADMIN';
    const isAdminOrSuperAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
    const isDoctor = role === 'DOCTOR';

    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);

    function handleLogout() {
        removeToken();
        window.location.href = '/login';
    }

    function isActive(path: string) {
        return location.pathname === path;
    }

    const staffItems: StaffMenuItem[] = [
        { to: '/', label: 'Головна' },
        { to: '/profile', label: 'Профіль' },
        ...(isDoctor ? [{ to: '/doctor/appointments', label: 'Мої прийоми' }] : []),
        ...(isAdminOrSuperAdmin ? [{ to: '/appointment', label: 'Записи' }] : []),
        ...(isAdminOrSuperAdmin ? [{ to: '/admin/services/list', label: 'Послуги (перегляд)' }] : []),
        ...(isAdminOrSuperAdmin ? [{ to: '/admin/services/create', label: 'Послуги (створення)' }] : []),
        ...(isAdminOrSuperAdmin ? [{ to: '/admin/doctors/list', label: 'Лікарі (список)' }] : []),
        ...(isAdminOrSuperAdmin ? [{ to: '/admin/doctors/create', label: 'Створення лікаря' }] : []),
        ...(isSuperAdmin ? [{ to: '/admins/list', label: 'Адміністратори (список)' }] : []),
        ...(isSuperAdmin ? [{ to: '/admins/create', label: 'Створення адміністратора' }] : []),
    ];

    useEffect(() => {
        function onClickOutside(e: MouseEvent) {
            if (!menuRef.current) return;
            if (!menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        }

        function onEsc(e: KeyboardEvent) {
            if (e.key === 'Escape') setMenuOpen(false);
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
    }, [location.pathname]);

    return (
        <header className="header">
            {!isStaff && (
                <div className="header__topbar">
                    <a className="header__topbar-link header__topbar-link--left" href="tel:+380000000000">
                        ЗАТЕЛЕФОНУВАТИ +38(000)000-00-00
                    </a>

                    <Link className="header__topbar-link header__topbar-link--right" to="/appointment">
                        ЗАПИСАТИСЯ НА ПРИЙОМ
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
                                <NavItem to="/" label="Головна" active={isActive('/')} />
                                <NavItem to="/appointment" label="Запис" active={isActive('/appointment')} />
                                <NavItem to="/register" label="Реєстрація" active={isActive('/register')} />
                                <NavItem to="/login" label="Вхід" active={isActive('/login')} />
                            </>
                        ) : isStaff ? (
                            <>
                                <div className="header__menu-wrap" ref={menuRef}>
                                    <button
                                        type="button"
                                        className={`header__menu-button ${menuOpen ? 'header__menu-button--open' : ''}`}
                                        onClick={() => setMenuOpen((prev) => !prev)}
                                    >
                                        Панель
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

                                <button className="header__action" type="button" onClick={handleLogout}>
                                    Вийти
                                </button>
                            </>
                        ) : (
                            <>
                                <NavItem to="/" label="Головна" active={isActive('/')} />
                                <NavItem to="/appointment" label="Запис" active={isActive('/appointment')} />
                                <NavItem to="/profile" label="Профіль" active={isActive('/profile')} />
                                <button className="header__action" type="button" onClick={handleLogout}>
                                    Вийти
                                </button>
                            </>
                        )}
                    </nav>
                </div>
            </div>
        </header>
    );
}
