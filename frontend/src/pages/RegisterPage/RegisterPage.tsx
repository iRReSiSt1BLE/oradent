import { useState } from 'react';
import { register, verifyEmail } from '../../shared/api/authApi';
import './RegisterPage.scss';

export default function RegisterPage() {
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
            const result = await verifyEmail({
                email: form.email,
                code: verificationCode,
            });

            setMessage(result.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Помилка підтвердження');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="page-shell auth-page">
            <div className="container">
                <div className="card auth-page__card">
                    <h1>Реєстрація</h1>
                    <p className="auth-page__subtitle">
                        Спочатку створюється заявка, а акаунт з’являється тільки після підтвердження пошти.
                    </p>

                    {message && <div className="status-box status-box--success">{message}</div>}
                    {error && <div className="status-box status-box--error">{error}</div>}

                    {step === 'register' ? (
                        <form className="form-grid" onSubmit={handleRegister}>
                            <div className="form-row">
                                <input
                                    className="input"
                                    placeholder="Прізвище"
                                    value={form.lastName}
                                    onChange={(e) => handleChange('lastName', e.target.value)}
                                />
                                <input
                                    className="input"
                                    placeholder="Ім’я"
                                    value={form.firstName}
                                    onChange={(e) => handleChange('firstName', e.target.value)}
                                />
                            </div>

                            <input
                                className="input"
                                placeholder="По батькові"
                                value={form.middleName}
                                onChange={(e) => handleChange('middleName', e.target.value)}
                            />

                            <input
                                className="input"
                                type="email"
                                placeholder="Email"
                                value={form.email}
                                onChange={(e) => handleChange('email', e.target.value)}
                            />

                            <input
                                className="input"
                                type="password"
                                placeholder="Пароль"
                                value={form.password}
                                onChange={(e) => handleChange('password', e.target.value)}
                            />

                            <button className="button button--primary" disabled={loading} type="submit">
                                {loading ? 'Надсилання...' : 'Створити заявку'}
                            </button>
                        </form>
                    ) : (
                        <form className="form-grid" onSubmit={handleVerify}>
                            <input
                                className="input"
                                placeholder="Код із листа"
                                value={verificationCode}
                                onChange={(e) => setVerificationCode(e.target.value)}
                            />
                            <button className="button button--primary" disabled={loading} type="submit">
                                {loading ? 'Перевірка...' : 'Підтвердити пошту'}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}