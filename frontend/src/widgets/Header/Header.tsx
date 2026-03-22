import { Link, useLocation } from 'react-router-dom';
import { getToken, removeToken } from '../../shared/utils/authStorage';
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

export default function Header() {
    const location = useLocation();
    const token = getToken();

    function handleLogout() {
        removeToken();
        window.location.href = '/login';
    }

    function isActive(path: string) {
        return location.pathname === path;
    }

    return (
        <header className="header">
            <div className="header__topbar">
                <a className="header__topbar-link header__topbar-link--left" href="tel:+380000000000">
                    ЗАТЕЛЕФОНУВАТИ +38(000)000-00-00
                </a>

                <Link className="header__topbar-link header__topbar-link--right" to="/appointment">
                    ЗАПИСАТИСЯ НА ПРИЙОМ
                </Link>
            </div>

            <div className="header__main">
                <div className="container header__container">
                    <Link className="header__logo" to="/">
                        <span className="header__logo-text">
                            <span className="header__logo-title">ORADENT</span>
                            <span className="header__logo-subtitle">
                                DENTAL CLINIC MANAGEMENT SYSTEM
                            </span>
                        </span>
                    </Link>

                    <nav className="header__nav">
                        <NavItem to="/" label="Головна" active={isActive('/')} />
                        <NavItem to="/appointment" label="Запис" active={isActive('/appointment')} />

                        {token ? (
                            <>
                                <NavItem to="/profile" label="Профіль" active={isActive('/profile')} />
                                <button className="header__action" type="button" onClick={handleLogout}>
                                    Вийти
                                </button>
                            </>
                        ) : (
                            <>
                                <NavItem
                                    to="/register"
                                    label="Реєстрація"
                                    active={isActive('/register')}
                                />
                                <NavItem to="/login" label="Вхід" active={isActive('/login')} />
                            </>
                        )}
                    </nav>
                </div>
            </div>
        </header>
    );
}