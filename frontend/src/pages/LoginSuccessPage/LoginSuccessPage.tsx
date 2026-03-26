import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getUserRole, saveToken } from '../../shared/utils/authStorage';

export default function LoginSuccessPage() {
    const [params] = useSearchParams();
    const navigate = useNavigate();

    useEffect(() => {
        const token = params.get('token');

        if (token) {
            saveToken(token);
            const role = getUserRole();
            navigate(role === 'ADMIN' || role === 'SUPER_ADMIN' ? '/' : '/profile');
        } else {
            navigate('/login');
        }
    }, [params, navigate]);

    return (
        <div className="page-shell">
            <div className="container">Вхід через Google...</div>
        </div>
    );
}
