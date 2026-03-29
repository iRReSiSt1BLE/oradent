import { useEffect, useState } from 'react';
import { getToken, removeToken } from '../../shared/utils/authStorage';
import { changeMyPassword, getMyProfile } from '../../shared/api/profileApi';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import './DoctorProfilePage.scss';

type Profile = {
    userId: string;
    email: string;
    role: string;
    lastName: string;
    firstName: string;
    middleName: string | null;
    phone: string | null;
};

export default function DoctorProfilePage() {
    const token = getToken();

    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);

    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const [modalOpen, setModalOpen] = useState(false);
    const [modalError, setModalError] = useState('');
    const [saving, setSaving] = useState(false);

    const [passwordForm, setPasswordForm] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
    });

    useEffect(() => {
        async function load() {
            if (!token) {
                setError('Спочатку увійди в систему');
                setLoading(false);
                return;
            }

            try {
                const result = await getMyProfile(token);
                setProfile(result.profile);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Не вдалося завантажити профіль');
            } finally {
                setLoading(false);
            }
        }

        void load();
    }, [token]);

    function handleLogout() {
        removeToken();
        window.location.href = '/login';
    }

    function openPasswordModal() {
        setModalError('');
        setPasswordForm({
            currentPassword: '',
            newPassword: '',
            confirmPassword: '',
        });
        setModalOpen(true);
    }

    function closePasswordModal() {
        setModalOpen(false);
        setModalError('');
    }

    async function handleChangePassword(e: React.FormEvent) {
        e.preventDefault();
        if (!token) return;

        if (!passwordForm.currentPassword.trim()) {
            setModalError('Введи поточний пароль');
            return;
        }

        if (!passwordForm.newPassword.trim()) {
            setModalError('Введи новий пароль');
            return;
        }

        if (passwordForm.newPassword !== passwordForm.confirmPassword) {
            setModalError('Новий пароль і підтвердження не співпадають');
            return;
        }

        setSaving(true);
        setModalError('');

        try {
            const result = await changeMyPassword(token, {
                currentPassword: passwordForm.currentPassword,
                newPassword: passwordForm.newPassword,
            });

            setMessage(result.message || 'Пароль успішно змінено');
            closePasswordModal();
        } catch (err) {
            setModalError(err instanceof Error ? err.message : 'Не вдалося змінити пароль');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="page-shell doctor-profile-page">
            <div className="container doctor-profile-page__container">
                <div className="doctor-profile-page__content">
                    {error && (
                        <div className="doctor-profile-page__top-alert">
                            <AlertToast message={error} variant="error" onClose={() => setError('')} />
                        </div>
                    )}

                    {message && (
                        <div className="doctor-profile-page__top-alert">
                            <AlertToast message={message} variant="success" onClose={() => setMessage('')} />
                        </div>
                    )}

                    <section className="doctor-profile-page__card">
                        <div className="doctor-profile-page__header">
                            <div>
                                <h1 className="doctor-profile-page__title">ПРОФІЛЬ ЛІКАРЯ</h1>
                                <p className="doctor-profile-page__subtitle">
                                    Для лікаря доступна зміна лише паролю.
                                </p>
                            </div>
                            <button className="doctor-profile-page__danger" type="button" onClick={handleLogout}>
                                ВИЙТИ
                            </button>
                        </div>

                        {loading ? (
                            <div className="doctor-profile-page__state">Завантаження профілю...</div>
                        ) : !profile ? (
                            <div className="doctor-profile-page__state">Профіль не знайдено</div>
                        ) : (
                            <>
                                <div className="doctor-profile-page__stack">
                                    <div className="doctor-profile-page__info-card">
                                        <span>ЛІКАР</span>
                                        <strong>
                                            {profile.lastName} {profile.firstName} {profile.middleName || ''}
                                        </strong>
                                    </div>

                                    <div className="doctor-profile-page__info-card">
                                        <span>EMAIL</span>
                                        <strong>{profile.email}</strong>
                                    </div>

                                    <div className="doctor-profile-page__info-card">
                                        <span>ТЕЛЕФОН</span>
                                        <strong>{profile.phone || 'НЕ ВКАЗАНО'}</strong>
                                    </div>
                                </div>

                                <div className="doctor-profile-page__actions">
                                    <button
                                        className="doctor-profile-page__secondary"
                                        type="button"
                                        onClick={openPasswordModal}
                                    >
                                        ЗМІНИТИ ПАРОЛЬ
                                    </button>
                                </div>
                            </>
                        )}
                    </section>
                </div>
            </div>

            {modalOpen && (
                <div className="doctor-profile-page__modal-backdrop">
                    <div className="doctor-profile-page__modal">
                        {modalError && (
                            <div className="doctor-profile-page__modal-alert">
                                <AlertToast message={modalError} variant="error" onClose={() => setModalError('')} />
                            </div>
                        )}

                        <h2 className="doctor-profile-page__modal-title">ЗМІНА ПАРОЛЮ</h2>

                        <form className="doctor-profile-page__modal-form" onSubmit={handleChangePassword}>
                            <label className="doctor-profile-page__field">
                                <span>ПОТОЧНИЙ ПАРОЛЬ</span>
                                <input
                                    type="password"
                                    value={passwordForm.currentPassword}
                                    onChange={(e) =>
                                        setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))
                                    }
                                />
                            </label>

                            <label className="doctor-profile-page__field">
                                <span>НОВИЙ ПАРОЛЬ</span>
                                <input
                                    type="password"
                                    value={passwordForm.newPassword}
                                    onChange={(e) =>
                                        setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))
                                    }
                                />
                            </label>

                            <label className="doctor-profile-page__field">
                                <span>ПІДТВЕРДИ НОВИЙ ПАРОЛЬ</span>
                                <input
                                    type="password"
                                    value={passwordForm.confirmPassword}
                                    onChange={(e) =>
                                        setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))
                                    }
                                />
                            </label>

                            <div className="doctor-profile-page__modal-actions">
                                <button
                                    className="doctor-profile-page__secondary"
                                    type="button"
                                    onClick={closePasswordModal}
                                >
                                    СКАСУВАТИ
                                </button>

                                <button className="doctor-profile-page__submit" type="submit" disabled={saving}>
                                    {saving ? 'ЗМІНА...' : 'ЗМІНИТИ ПАРОЛЬ'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
