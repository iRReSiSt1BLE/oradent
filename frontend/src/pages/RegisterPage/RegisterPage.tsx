import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login, register, verifyEmail } from '../../shared/api/authApi';
import { saveToken } from '../../shared/utils/authStorage';
import './RegisterPage.scss';

export default function RegisterPage() {
    const navigate = useNavigate();

    const [form, setForm] = useState({
        lastName: '',
        firstName: '',
        middleName: '',
        email: '',
        password: '',
    });

    const [verificationCode, setVerificationCode] = useState('');
    const [step, setStep] = useState<'register' | 'verify'>('register');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    function handleChange(field: string, value: string) {
        setForm((prev) => ({ ...prev, [field]: value }));
    }

    async function handleRegister(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError('');
        setMessage('');

        try {
            const result = await register({
                lastName: form.lastName,
                firstName: form.firstName,
                middleName: form.middleName || undefined,
                email: form.email,
                password: form.password,
            });

            setMessage(result.message);
            setStep('verify');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Помилка реєстрації');
        } finally {
            setLoading(false);
        }
    }

    async function handleVerify(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError('');
        setMessage('');

        try {
            await verifyEmail({
                email: form.email,
                code: verificationCode,
            });

            const loginResult = await login({
                email: form.email,
                password: form.password,
            });

            saveToken(loginResult.accessToken);
            navigate('/profile');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Помилка підтвердження');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="page-shell auth-retro register-page">
            <div className="container auth-retro__container">
                <div className="auth-retro__card">
                    <h1 className="auth-retro__title">{step === 'register' ? 'Зареєструватися' : 'Підтвердження пошти'}</h1>

                    {message && <div className="status-box status-box--success">{message}</div>}
                    {error && <div className="status-box status-box--error">{error}</div>}

                    {step === 'register' ? (
                        <>
                            <form className="auth-retro__form auth-retro__form--register" onSubmit={handleRegister}>
                                <div className="auth-retro__field">
                                    <label htmlFor="register-lastName">Прізвище</label>
                                    <input
                                        id="register-lastName"
                                        className="auth-retro__input"
                                        placeholder="Last name"
                                        value={form.lastName}
                                        onChange={(e) => handleChange('lastName', e.target.value)}
                                    />
                                </div>

                                <div className="auth-retro__field">
                                    <label htmlFor="register-firstName">Ім'я</label>
                                    <input
                                        id="register-firstName"
                                        className="auth-retro__input"
                                        placeholder="First name"
                                        value={form.firstName}
                                        onChange={(e) => handleChange('firstName', e.target.value)}
                                    />
                                </div>

                                <div className="auth-retro__field auth-retro__field--full">
                                    <label htmlFor="register-middleName">По батькові</label>
                                    <input
                                        id="register-middleName"
                                        className="auth-retro__input"
                                        placeholder="Middle name"
                                        value={form.middleName}
                                        onChange={(e) => handleChange('middleName', e.target.value)}
                                    />
                                </div>

                                <div className="auth-retro__field auth-retro__field--full">
                                    <label htmlFor="register-email">Пошта</label>
                                    <input
                                        id="register-email"
                                        className="auth-retro__input"
                                        type="email"
                                        placeholder="your@email.com"
                                        value={form.email}
                                        onChange={(e) => handleChange('email', e.target.value)}
                                    />
                                </div>

                                <div className="auth-retro__field auth-retro__field--full">
                                    <label htmlFor="register-password">Пароль</label>
                                    <input
                                        id="register-password"
                                        className="auth-retro__input"
                                        type="password"
                                        placeholder="••••••••"
                                        value={form.password}
                                        onChange={(e) => handleChange('password', e.target.value)}
                                    />
                                </div>

                                <button className="auth-retro__submit auth-retro__submit--full" disabled={loading} type="submit">
                                    {loading ? 'Відправка...' : 'Створити Аккаунт'}
                                </button>
                            </form>

                            <p className="auth-retro__footer">
                                Вже маєте аккаунт? <Link to="/login">Авторизація</Link>
                            </p>
                        </>
                    ) : (
                        <>
                            <div className="auth-retro__verify-text">
                                We sent a verification code to:
                                <strong>{form.email}</strong>
                            </div>

                            <form className="auth-retro__form" onSubmit={handleVerify}>
                                <div className="auth-retro__field">
                                    <label htmlFor="register-code">CODE</label>
                                    <input
                                        id="register-code"
                                        className="auth-retro__input"
                                        placeholder="Enter verification code"
                                        value={verificationCode}
                                        onChange={(e) => setVerificationCode(e.target.value)}
                                    />
                                </div>

                                <button className="auth-retro__submit" disabled={loading} type="submit">
                                    {loading ? 'VERIFYING...' : 'VERIFY EMAIL'}
                                </button>
                            </form>

                            <p className="auth-retro__footer">
                                Wrong email? <Link to="/register">Start over</Link>
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}