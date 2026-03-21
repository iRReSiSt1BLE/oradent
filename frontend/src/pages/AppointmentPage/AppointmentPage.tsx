import { useState } from 'react';
import {
    createAuthenticatedAppointment,
    createGuestAppointment,
} from '../../shared/api/appointmentApi';
import {
    getPhoneVerificationStatus,
    startPhoneVerification,
} from '../../shared/api/phoneVerificationApi';
import { getToken } from '../../shared/utils/authStorage';
import './AppointmentPage.scss';

type Mode = 'guest' | 'authenticated';

export default function AppointmentPage() {
    const token = getToken();

    const [mode, setMode] = useState<Mode>(token ? 'authenticated' : 'guest');

    const [guestForm, setGuestForm] = useState({
        lastName: '',
        firstName: '',
        middleName: '',
        phone: '',
        doctorId: '',
        serviceId: '',
        appointmentDate: '',
        reason: '',
    });

    const [authForm, setAuthForm] = useState({
        doctorId: '',
        serviceId: '',
        appointmentDate: '',
        reason: '',
    });

    const [phoneForVerification, setPhoneForVerification] = useState('');
    const [sessionId, setSessionId] = useState('');
    const [telegramBotUrl, setTelegramBotUrl] = useState('');
    const [telegramStatus, setTelegramStatus] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    async function handleStartVerification(phone: string) {
        setError('');
        setMessage('');

        try {
            const result = await startPhoneVerification(phone);
            setSessionId(result.sessionId);
            setTelegramBotUrl(result.telegramBotUrl);
            setTelegramStatus(result.status);
            setMessage('Верифікацію створено. Відкрий Telegram.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Помилка старту верифікації');
        }
    }

    async function handleCheckStatus() {
        if (!sessionId) return;

        try {
            const result = await getPhoneVerificationStatus(sessionId);
            setTelegramStatus(result.status);
            setMessage(`Поточний статус: ${result.status}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Помилка перевірки статусу');
        }
    }

    async function handleGuestAppointment(e: React.FormEvent) {
        e.preventDefault();

        try {
            const result = await createGuestAppointment({
                lastName: guestForm.lastName,
                firstName: guestForm.firstName,
                middleName: guestForm.middleName || undefined,
                phone: guestForm.phone,
                phoneVerificationSessionId: sessionId,
                doctorId: guestForm.doctorId || undefined,
                serviceId: guestForm.serviceId || undefined,
                appointmentDate: guestForm.appointmentDate || undefined,
                reason: guestForm.reason || undefined,
            });

            setMessage((result as any).message || 'Гостьовий запис створено');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Помилка створення запису');
        }
    }

    async function handleAuthenticatedAppointment(e: React.FormEvent) {
        e.preventDefault();

        if (!token) {
            setError('Спочатку увійди в систему');
            return;
        }

        try {
            const result = await createAuthenticatedAppointment(token, {
                phoneVerificationSessionId: sessionId || undefined,
                doctorId: authForm.doctorId || undefined,
                serviceId: authForm.serviceId || undefined,
                appointmentDate: authForm.appointmentDate || undefined,
                reason: authForm.reason || undefined,
            });

            setMessage((result as any).message || 'Запис створено');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Помилка створення запису');
        }
    }

    return (
        <div className="page-shell appointment-page">
            <div className="container">
                <div className="card appointment-page__card">
                    <div className="appointment-page__header">
                        <div>
                            <h1>Запис на прийом</h1>
                            <p>
                                Гість проходить Telegram-підтвердження щоразу. Авторизований користувач —
                                лише під час першого підтвердження номера.
                            </p>
                        </div>
                        <div className="appointment-page__modes">
                            <button
                                className={`button ${mode === 'guest' ? 'button--primary' : 'button--secondary'}`}
                                onClick={() => setMode('guest')}
                                type="button"
                            >
                                Гість
                            </button>
                            <button
                                className={`button ${
                                    mode === 'authenticated' ? 'button--primary' : 'button--secondary'
                                }`}
                                onClick={() => setMode('authenticated')}
                                type="button"
                            >
                                Авторизований
                            </button>
                        </div>
                    </div>

                    {message && <div className="status-box status-box--success">{message}</div>}
                    {error && <div className="status-box status-box--error">{error}</div>}

                    {mode === 'guest' ? (
                        <form className="form-grid" onSubmit={handleGuestAppointment}>
                            <div className="form-row">
                                <input
                                    className="input"
                                    placeholder="Прізвище"
                                    value={guestForm.lastName}
                                    onChange={(e) =>
                                        setGuestForm((prev) => ({ ...prev, lastName: e.target.value }))
                                    }
                                />
                                <input
                                    className="input"
                                    placeholder="Ім’я"
                                    value={guestForm.firstName}
                                    onChange={(e) =>
                                        setGuestForm((prev) => ({ ...prev, firstName: e.target.value }))
                                    }
                                />
                            </div>

                            <input
                                className="input"
                                placeholder="По батькові"
                                value={guestForm.middleName}
                                onChange={(e) =>
                                    setGuestForm((prev) => ({ ...prev, middleName: e.target.value }))
                                }
                            />

                            <input
                                className="input"
                                placeholder="+380..."
                                value={guestForm.phone}
                                onChange={(e) => {
                                    setGuestForm((prev) => ({ ...prev, phone: e.target.value }));
                                    setPhoneForVerification(e.target.value);
                                }}
                            />

                            <div className="form-row">
                                <input
                                    className="input"
                                    placeholder="doctorId"
                                    value={guestForm.doctorId}
                                    onChange={(e) =>
                                        setGuestForm((prev) => ({ ...prev, doctorId: e.target.value }))
                                    }
                                />
                                <input
                                    className="input"
                                    placeholder="serviceId"
                                    value={guestForm.serviceId}
                                    onChange={(e) =>
                                        setGuestForm((prev) => ({ ...prev, serviceId: e.target.value }))
                                    }
                                />
                            </div>

                            <input
                                className="input"
                                type="datetime-local"
                                value={guestForm.appointmentDate}
                                onChange={(e) =>
                                    setGuestForm((prev) => ({ ...prev, appointmentDate: e.target.value }))
                                }
                            />

                            <textarea
                                className="textarea"
                                placeholder="Причина звернення"
                                value={guestForm.reason}
                                onChange={(e) =>
                                    setGuestForm((prev) => ({ ...prev, reason: e.target.value }))
                                }
                            />

                            <div className="appointment-page__verification">
                                <button
                                    className="button button--secondary"
                                    type="button"
                                    onClick={() => handleStartVerification(phoneForVerification)}
                                >
                                    Старт Telegram verification
                                </button>
                                <button
                                    className="button button--secondary"
                                    type="button"
                                    onClick={handleCheckStatus}
                                >
                                    Перевірити статус
                                </button>

                                {telegramBotUrl && (
                                    <a
                                        className="button button--primary"
                                        href={telegramBotUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        Відкрити Telegram
                                    </a>
                                )}
                            </div>

                            <div className="appointment-page__session card">
                                <p><b>Session ID:</b> {sessionId || '—'}</p>
                                <p><b>Status:</b> {telegramStatus || '—'}</p>
                            </div>

                            <button className="button button--success" type="submit">
                                Створити гостьовий запис
                            </button>
                        </form>
                    ) : (
                        <form className="form-grid" onSubmit={handleAuthenticatedAppointment}>
                            <div className="status-box status-box--info">
                                Якщо телефон у профілі ще не підтверджений, спочатку пройди Telegram verification
                                і тільки потім створи запис.
                            </div>

                            <div className="form-row">
                                <input
                                    className="input"
                                    placeholder="doctorId"
                                    value={authForm.doctorId}
                                    onChange={(e) =>
                                        setAuthForm((prev) => ({ ...prev, doctorId: e.target.value }))
                                    }
                                />
                                <input
                                    className="input"
                                    placeholder="serviceId"
                                    value={authForm.serviceId}
                                    onChange={(e) =>
                                        setAuthForm((prev) => ({ ...prev, serviceId: e.target.value }))
                                    }
                                />
                            </div>

                            <input
                                className="input"
                                type="datetime-local"
                                value={authForm.appointmentDate}
                                onChange={(e) =>
                                    setAuthForm((prev) => ({ ...prev, appointmentDate: e.target.value }))
                                }
                            />

                            <textarea
                                className="textarea"
                                placeholder="Причина звернення"
                                value={authForm.reason}
                                onChange={(e) =>
                                    setAuthForm((prev) => ({ ...prev, reason: e.target.value }))
                                }
                            />

                            <div className="appointment-page__verification">
                                <input
                                    className="input"
                                    placeholder="Номер для Telegram verification"
                                    value={phoneForVerification}
                                    onChange={(e) => setPhoneForVerification(e.target.value)}
                                />

                                <button
                                    className="button button--secondary"
                                    type="button"
                                    onClick={() => handleStartVerification(phoneForVerification)}
                                >
                                    Старт Telegram verification
                                </button>

                                <button
                                    className="button button--secondary"
                                    type="button"
                                    onClick={handleCheckStatus}
                                >
                                    Перевірити статус
                                </button>

                                {telegramBotUrl && (
                                    <a
                                        className="button button--primary"
                                        href={telegramBotUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        Відкрити Telegram
                                    </a>
                                )}
                            </div>

                            <div className="appointment-page__session card">
                                <p><b>Session ID:</b> {sessionId || '—'}</p>
                                <p><b>Status:</b> {telegramStatus || '—'}</p>
                            </div>
                            <button className="button button--success" type="submit">
                                Створити авторизований запис
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}