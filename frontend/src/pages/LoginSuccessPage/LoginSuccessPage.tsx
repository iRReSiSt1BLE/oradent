import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { saveToken } from '../../shared/utils/authStorage';

export default function LoginSuccessPage() {
    const [params] = useSearchParams();
    const navigate = useNavigate();

    useEffect(() => {
        const token = params.get('token');

        if (token) {
            saveToken(token);
            navigate('/profile');
        } else {
            navigate('/login');
        }
    }, [params, navigate]);

    return <div className="page-shell"><div className="container">Вхід через Google...</div></div>;
}