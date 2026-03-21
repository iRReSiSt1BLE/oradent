import { Link, useLocation } from 'react-router-dom';
import { getToken, removeToken } from '../../shared/utils/authStorage';
import './Header.scss';

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
            <div className="container header__container">
                <Link className="header__logo" to="/">
                    Oradent
                </Link>

                <nav className="header__nav">
                    <Link
                        className={`header__link ${isActive('/') ? 'header__link--active' : ''}`}
                        to="/"
                    >
                        Головна
                    </Link>

                    <Link
                        className={`header__link ${isActive('/appointment') ? 'header__link--active' : ''}`}
                        to="/appointment"
                    >
                        Запис
                    </Link>

                    {token ? (
                        <>
                            <Link
                                className={`header__link ${isActive('/profile') ? 'header__link--active' : ''}`}
                                to="/profile"
                            >
                                Профіль
                            </Link>

                            <button
                                className="button button--secondary header__logout"
                                type="button"
                                onClick={handleLogout}
                            >
                                Вийти
                            </button>
                        </>
                    ) : (
                        <>
                            <Link
                                className={`header__link ${isActive('/register') ? 'header__link--active' : ''}`}
                                to="/register"
                            >
                                Реєстрація
                            </Link>

                            <Link
                                className={`header__link ${isActive('/login') ? 'header__link--active' : ''}`}
                                to="/login"
                            >
                                Вхід
                            </Link>
                        </>
                    )}
                </nav>
            </div>
        </header>
    );
}