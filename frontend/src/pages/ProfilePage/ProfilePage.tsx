import { useEffect, useState } from 'react';
import { getMyPatient } from '../../shared/api/patientApi';
import { getToken, removeToken } from '../../shared/utils/authStorage';
import './ProfilePage.scss';

export default function ProfilePage() {
    const token = getToken();

    const [patient, setPatient] = useState<any>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        async function loadPatient() {
            if (!token) {
                setError('Спочатку увійди в систему');
                return;
            }

            try {
                const result = await getMyPatient(token);
                setPatient(result.patient);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Не вдалося завантажити профіль');
            }
        }

        loadPatient();
    }, [token]);

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
                            <p>Тут відображаються основні дані акаунта.</p>
                        </div>

                        <button className="button button--danger" onClick={handleLogout}>
                            Вийти
                        </button>
                    </div>

                    {error && <div className="status-box status-box--error">{error}</div>}

                    {patient && (
                        <div className="profile-page__info">
                            <div className="profile-page__item profile-page__item--wide">
                                <span>Пацієнт</span>
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
                                <strong>{patient.phone || 'Не вказано'}</strong>
                            </div>

                            <div className="profile-page__item">
                                <span>Статус телефону</span>
                                <strong>{patient.phoneVerified ? 'Підтверджено' : 'Не підтверджено'}</strong>
                            </div>

                            <div className="profile-page__item">
                                <span>Статус акаунта</span>
                                <strong>{token ? 'Авторизований користувач' : 'Гість'}</strong>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}