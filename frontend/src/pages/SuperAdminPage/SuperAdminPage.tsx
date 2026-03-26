import { useEffect, useState } from 'react';
import { getToken } from '../../shared/utils/authStorage';
import { createAdmin, getAllAdmins, toggleAdminActive } from '../../shared/api/adminApi';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import './SuperAdminPage.scss';

type AdminItem = {
    id: string;
    userId: string;
    email: string;
    lastName: string;
    firstName: string;
    middleName: string | null;
    phone: string;
    isActive: boolean;
    role: string;
};

export default function SuperAdminPage() {
    const token = getToken();

    const [admins, setAdmins] = useState<AdminItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const [form, setForm] = useState({
        lastName: '',
        firstName: '',
        middleName: '',
        phone: '',
        email: '',
        password: '',
    });

    useEffect(() => {
        void loadAdmins();
    }, []);

    async function loadAdmins() {
        if (!token) {
            setError('Спочатку увійди в систему');
            setLoading(false);
            return;
        }

        try {
            const result = await getAllAdmins(token);
            setAdmins(result.admins);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося завантажити адміністраторів');
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateAdmin(e: React.FormEvent) {
        e.preventDefault();

        if (!token) return;

        setSaving(true);
        setMessage('');
        setError('');

        try {
            const result = await createAdmin(token, {
                ...form,
                middleName: form.middleName || undefined,
            });

            setAdmins((prev) => [...prev, result.admin]);
            setForm({
                lastName: '',
                firstName: '',
                middleName: '',
                phone: '',
                email: '',
                password: '',
            });
            setMessage(result.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося створити адміністратора');
        } finally {
            setSaving(false);
        }
    }

    async function handleToggleAdmin(adminId: string) {
        if (!token) return;

        setMessage('');
        setError('');

        try {
            const result = await toggleAdminActive(token, adminId);

            setAdmins((prev) =>
                prev.map((item) =>
                    item.id === adminId ? { ...item, isActive: result.isActive } : item,
                ),
            );

            setMessage(result.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося змінити статус адміністратора');
        }
    }

    return (
        <div className="page-shell super-admin-page">
            <div className="container super-admin-page__container">
                {error && (
                    <AlertToast
                        message={error}
                        variant="error"
                        onClose={() => setError('')}
                    />
                )}

                {message && (
                    <AlertToast
                        message={message}
                        variant="success"
                        onClose={() => setMessage('')}
                    />
                )}

                <div className="super-admin-page__layout">
                    <section className="super-admin-page__card">
                        <h1 className="super-admin-page__title">СТВОРЕННЯ АДМІНІСТРАТОРА</h1>

                        <form className="super-admin-page__form" onSubmit={handleCreateAdmin}>
                            <div className="super-admin-page__field">
                                <label>ПРІЗВИЩЕ</label>
                                <input
                                    value={form.lastName}
                                    onChange={(e) => setForm((prev) => ({ ...prev, lastName: e.target.value }))}
                                />
                            </div>

                            <div className="super-admin-page__field">
                                <label>ІМ’Я</label>
                                <input
                                    value={form.firstName}
                                    onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
                                />
                            </div>
                            <div className="super-admin-page__field">
                                <label>ПО БАТЬКОВІ</label>
                                <input
                                    value={form.middleName}
                                    onChange={(e) => setForm((prev) => ({ ...prev, middleName: e.target.value }))}
                                />
                            </div>

                            <div className="super-admin-page__field">
                                <label>ТЕЛЕФОН</label>
                                <input
                                    value={form.phone}
                                    onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                                />
                            </div>

                            <div className="super-admin-page__field">
                                <label>EMAIL</label>
                                <input
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                                />
                            </div>

                            <div className="super-admin-page__field">
                                <label>ПАРОЛЬ</label>
                                <input
                                    type="password"
                                    value={form.password}
                                    onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                                />
                            </div>

                            <button className="super-admin-page__submit" type="submit" disabled={saving}>
                                {saving ? 'СТВОРЕННЯ...' : 'СТВОРИТИ АДМІНА'}
                            </button>
                        </form>
                    </section>

                    <section className="super-admin-page__card">
                        <h2 className="super-admin-page__title">СПИСОК АДМІНІСТРАТОРІВ</h2>

                        {loading ? (
                            <div className="super-admin-page__loading">Завантаження...</div>
                        ) : (
                            <div className="super-admin-page__list">
                                {admins.map((admin) => (
                                    <article key={admin.id} className="super-admin-page__item">
                                        <div className="super-admin-page__item-main">
                                            <div className="super-admin-page__item-name">
                                                {admin.lastName} {admin.firstName} {admin.middleName || ''}
                                            </div>
                                            <div className="super-admin-page__item-meta">{admin.email}</div>
                                            <div className="super-admin-page__item-meta">{admin.phone}</div>
                                            <div className="super-admin-page__item-status">
                                                {admin.isActive ? 'АКТИВНИЙ' : 'НЕАКТИВНИЙ'}
                                            </div>
                                        </div>

                                        <button
                                            className="super-admin-page__toggle"
                                            type="button"
                                            onClick={() => handleToggleAdmin(admin.id)}
                                        >
                                            {admin.isActive ? 'ДЕАКТИВУВАТИ' : 'АКТИВУВАТИ'}
                                        </button>
                                    </article>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}