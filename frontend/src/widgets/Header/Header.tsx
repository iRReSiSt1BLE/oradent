import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMemo } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider';
import './Header.scss';

type HeaderProps = {
    cartCount?: number;
    onOpenCart?: () => void;
};

function readAuthState() {
    const token =
        localStorage.getItem('token') ||
        localStorage.getItem('accessToken') ||
        localStorage.getItem('authToken') ||
        '';

    const role =
        localStorage.getItem('role') ||
        localStorage.getItem('userRole') ||
        '';

    return {
        isAuthenticated: Boolean(token),
        role: role.toUpperCase(),
    };
}

export default function Header({ cartCount = 0, onOpenCart }: HeaderProps) {
    const { t, language, setLanguage } = useI18n();
    const navigate = useNavigate();
    const location = useLocation();

    const auth = useMemo(() => readAuthState(), [location.pathname]);

    const isStaff =
        auth.role === 'ADMIN' ||
        auth.role === 'SUPER_ADMIN' ||
        auth.role === 'DOCTOR';

    function handleLogout() {
        localStorage.removeItem('token');
        localStorage.removeItem('accessToken');
        localStorage.removeItem('authToken');
        localStorage.removeItem('role');
        localStorage.removeItem('userRole');
        localStorage.removeItem('user');
        navigate('/login');
    }

    function handlePanelClick() {
        if (auth.role === 'DOCTOR') {
            navigate('/doctor/profile');
            return;
        }

        if (auth.role === 'ADMIN' || auth.role === 'SUPER_ADMIN') {
            navigate('/admin/services');
            return;
        }

        navigate('/');
    }

    function renderCartButton() {
        return (
            <button
                type="button"
                className="header__cart-button"
                onClick={onOpenCart}
                aria-label={t('cart.title') || 'Кошик'}
            >
                <span className="header__cart-icon" aria-hidden="true">
                    🧺
                </span>

                {cartCount > 0 ? (
                    <span className="header__cart-badge">{cartCount}</span>
                ) : null}
            </button>
        );
    }

    function renderLanguageButton() {
        const nextLanguage =
            language === 'ua' ? 'en' : language === 'en' ? 'de' : language === 'de' ? 'fr' : 'ua';

        return (
            <button
                type="button"
                className="header__action header__lang"
                onClick={() => setLanguage(nextLanguage)}
            >
                {(language || 'ua').toUpperCase()}
            </button>
        );
    }

    return (
        <header className="header">
            <div className="header__inner container">
                <div className="header__brand">
                    <Link to="/" className="header__logo">
                        <span className="header__logo-title">ORADENT</span>
                        <span className="header__logo-subtitle">
                            DENTAL CLINIC MANAGEMENT SYSTEM
                        </span>
                    </Link>
                </div>

                <nav className="header__nav" aria-label="Main navigation">
                    {!auth.isAuthenticated ? (
                        <>
                            <Link className="header__link" to="/">
                                {t('header.home') || 'Головна'}
                            </Link>

                            <Link className="header__link" to="/appointment">
                                {t('header.appointment') || 'Запис'}
                            </Link>

                            <Link className="header__link" to="/register">
                                {t('header.register') || 'Реєстрація'}
                            </Link>

                            <Link className="header__link" to="/login">
                                {t('header.login') || 'Вхід'}
                            </Link>

                            {renderCartButton()}
                            {renderLanguageButton()}
                        </>
                    ) : (
                        <>
                            <Link className="header__link" to="/">
                                {t('header.home') || 'Головна'}
                            </Link>

                            <Link className="header__link" to="/appointment">
                                {t('header.appointment') || 'Запис'}
                            </Link>

                            {isStaff ? (
                                <button
                                    type="button"
                                    className="header__action"
                                    onClick={handlePanelClick}
                                >
                                    {t('header.panel') || 'Панель'}
                                </button>
                            ) : null}

                            {renderLanguageButton()}
                            {renderCartButton()}

                            <button
                                type="button"
                                className="header__action"
                                onClick={handleLogout}
                            >
                                {t('header.logout') || 'Вийти'}
                            </button>
                        </>
                    )}
                </nav>
            </div>
        </header>
    );
}