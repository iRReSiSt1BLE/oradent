import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { login } from '../../shared/api/authApi';
import { saveToken } from '../../shared/utils/authStorage';
import './LoginPage.scss';

export default function LoginPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const googleError = searchParams.get('googleError');

        if (googleError) {
            setError(googleError);
        }
    }, [searchParams]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError('');
        setMessage('');

        try {
            const result = await login({ email, password });
            saveToken(result.accessToken);
            setMessage(result.message);

            navigate(
                result.user.role === 'ADMIN' || result.user.role === 'SUPER_ADMIN'
                    ? '/'
                    : '/profile',
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Помилка входу');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="page-shell auth-retro login-page">
            <div className="container auth-retro__container">
                <div className="auth-retro__card">
                    <h1 className="auth-retro__title">Авторизація</h1>

                    {message && <div className="status-box status-box--success">{message}</div>}
                    {error && <div className="status-box status-box--error">{error}</div>}

                    <form className="auth-retro__form" onSubmit={handleSubmit}>
                        <div className="auth-retro__field">
                            <label htmlFor="login-email">Пошта</label>
                            <input
                                id="login-email"
                                className="auth-retro__input"
                                type="email"
                                placeholder="your@email.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                        </div>

                        <div className="auth-retro__field">
                            <label htmlFor="login-password">Пароль</label>
                            <input
                                id="login-password"
                                className="auth-retro__input"
                                type="password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>

                        <button className="auth-retro__submit" disabled={loading} type="submit">
                            {loading ? 'Вхід...' : 'Увійти'}
                        </button>
                    </form>

                    <div className="auth-retro__divider">
                        <span>АБО</span>
                    </div>

                    <a className="auth-retro__google" href="http://localhost:3000/auth/google">
                        <img src="../../../public/google-icon.svg" alt="" aria-hidden="true" />
                        <span>Google Авторизація</span>
                    </a>

                    <p className="auth-retro__footer">
                        Ще немає акаунту? <Link to="/register">Зареєструватися</Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
