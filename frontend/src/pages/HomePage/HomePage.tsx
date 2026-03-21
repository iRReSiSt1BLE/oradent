import { Link } from 'react-router-dom';
import './HomePage.scss';

export default function HomePage() {
    return (
        <div className="page-shell home-page">
            <div className="container">
                <div className="card home-page__hero">
                    <div className="home-page__content">
                        <span className="home-page__badge">Oradent</span>
                        <h1>Стоматологічна система з реальною верифікацією даних</h1>
                        <p>
                            Реєстрація, підтвердження пошти, Telegram-підтвердження телефону,
                            гостьовий і авторизований запис на прийом.
                        </p>

                        <div className="home-page__actions">
                            <Link className="button button--primary" to="/register">
                                Реєстрація
                            </Link>
                            <Link className="button button--secondary" to="/login">
                                Увійти
                            </Link>
                            <Link className="button button--secondary" to="/appointment">
                                Запис на прийом
                            </Link>
                            <Link className="button button--secondary" to="/profile">
                                Профіль
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}