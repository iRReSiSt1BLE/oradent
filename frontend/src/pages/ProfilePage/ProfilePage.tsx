import { useEffect, useState } from 'react';
import { getMyPatient, setPatientPhone, confirmPatientPhone } from '../../shared/api/patientApi';
import {
    getPhoneVerificationStatus,
    startPhoneVerification,
} from '../../shared/api/phoneVerificationApi';
import { getToken, removeToken } from '../../shared/utils/authStorage';
import './ProfilePage.scss';

export default function ProfilePage() {
    const token = getToken();

    const [patient, setPatient] = useState<any>(null);
    const [phone, setPhone] = useState('');
    const [sessionId, setSessionId] = useState('');
    const [telegramBotUrl, setTelegramBotUrl] = useState('');
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    async function loadPatient() {
        if (!token) {
            setError('Спочатку увійди в систему');
            return;
        }

        try {
            const result = await getMyPatient(token);
            setPatient(result.patient);
            setPhone(result.patient.phone || '');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося завантажити профіль');
        }
    }

    useEffect(() => {
        loadPatient();
    }, []);

    async function handleSavePhone() {
        if (!token) return;

        setError('');
        setMessage('');

        try {
            const result = await setPatientPhone(token, phone);
            setPatient((prev: any) => ({ ...prev, ...result.patient }));
            setMessage(result.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося зберегти номер');
        }
    }

    async function handleStartVerification() {
        setError('');
        setMessage('');
        setStatus('');

        try {
            const result = await startPhoneVerification(phone);
            setSessionId(result.sessionId);
            setTelegramBotUrl(result.telegramBotUrl);
            setStatus(result.status);
            setMessage('Сесію створено. Відкрий Telegram і підтвердь контакт.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося стартувати верифікацію');
        }
    }

    async function handleCheckStatus() {
        if (!sessionId) return;

        try {
            const result = await getPhoneVerificationStatus(sessionId);
            setStatus(result.status);

            if (result.status === 'VERIFIED') {
                setMessage('Telegram підтвердження пройшло успішно');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося перевірити статус');
        }
    }

    async function handleConfirmPhone() {
        if (!token || !sessionId) return;

        try {
            const result = await confirmPatientPhone(token, sessionId);
            setPatient((prev: any) => ({ ...prev, ...result.patient }));
            setMessage(result.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося підтвердити номер');
        }
    }

    function handleLogout() {
        removeToken();
        window.location.href = '/login';
    }

    return (
        <div className="page-shell profile-page">
            <div className="container">
                <div className="card profile-page__card">
                    <div className="profile-page__header">
                        <div>
                            <h1>Профіль пацієнта</h1>
                            <p>Тут зберігається номер телефону і проходить одноразове підтвердження через Telegram.</p>
                        </div>

                        <button className="button button--danger" onClick={handleLogout}>
                            Вийти
                        </button>
                    </div>

                    {message && <div className="status-box status-box--success">{message}</div>}
                    {error && <div className="status-box status-box--error">{error}</div>}

                    {patient && (
                        <div className="profile-page__info">
                            <div className="profile-page__item">
                                <span>ПІБ</span>
                                <strong>
                                    {patient.lastName} {patient.firstName} {patient.middleName || ''}
                                </strong>
                            </div>

                            <div className="profile-page__item">
                                <span>Email</span>
                                <strong>{patient.email || '—'}</strong>
                            </div>
                            <div className="profile-page__item">
                                <span>Телефон</span>
                                <strong>{patient.phone || 'не вказаний'}</strong>
                            </div>

                            <div className="profile-page__item">
                                <span>Статус телефону</span>
                                <strong>{patient.phoneVerified ? 'Підтверджено' : 'Не підтверджено'}</strong>
                            </div>
                        </div>
                    )}

                    <div className="profile-page__actions">
                        <input
                            className="input"
                            placeholder="+380..."
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                        />

                        <div className="profile-page__buttons">
                            <button className="button button--secondary" onClick={handleSavePhone}>
                                Зберегти номер
                            </button>
                            <button className="button button--primary" onClick={handleStartVerification}>
                                Старт Telegram verification
                            </button>
                            <button className="button button--secondary" onClick={handleCheckStatus}>
                                Перевірити статус
                            </button>
                            <button className="button button--success" onClick={handleConfirmPhone}>
                                Підтвердити номер у профілі
                            </button>
                        </div>
                    </div>

                    <div className="profile-page__telegram">
                        <div className="profile-page__item">
                            <span>Session ID</span>
                            <strong>{sessionId || '—'}</strong>
                        </div>

                        <div className="profile-page__item">
                            <span>Telegram статус</span>
                            <strong>{status || '—'}</strong>
                        </div>

                        {telegramBotUrl && (
                            <a
                                className="button button--primary profile-page__telegram-link"
                                href={telegramBotUrl}
                                target="_blank"
                                rel="noreferrer"
                            >
                                Відкрити Telegram бота
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}