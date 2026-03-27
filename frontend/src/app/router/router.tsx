import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom';
import App from '../../App';
import HomePage from '../../pages/HomePage/HomePage';
import RegisterPage from '../../pages/RegisterPage/RegisterPage';
import LoginPage from '../../pages/LoginPage/LoginPage';
import LoginSuccessPage from '../../pages/LoginSuccessPage/LoginSuccessPage';
import ProfilePage from '../../pages/ProfilePage/ProfilePage';
import AppointmentPage from '../../pages/AppointmentPage/AppointmentPage';
import AdminCreatePage from '../../pages/AdminCreatePage/AdminCreatePage';
import AdminListPage from '../../pages/AdminListPage/AdminListPage';
import ServiceCreatePage from '../../pages/ServiceCreatePage/ServiceCreatePage';
import ServiceListPage from '../../pages/ServiceListPage/ServiceListPage';
import ServiceDetailPage from '../../pages/ServiceDetailPage/ServiceDetailPage';
import { getToken, getUserRole } from '../../shared/utils/authStorage';

function SuperAdminOnly() {
    const token = getToken();
    const role = getUserRole();

    if (!token) {
        return <Navigate to="/login" replace />;
    }

    if (role !== 'SUPER_ADMIN') {
        return <Navigate to="/" replace />;
    }

    return <Outlet />;
}

function AdminPanelOnly() {
    const token = getToken();
    const role = getUserRole();

    if (!token) {
        return <Navigate to="/login" replace />;
    }

    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
        return <Navigate to="/" replace />;
    }

    return <Outlet />;
}

export const router = createBrowserRouter([
    {
        path: '/',
        element: <App />,
        children: [
            { index: true, element: <HomePage /> },
            { path: 'services/:serviceId', element: <ServiceDetailPage /> },
            { path: 'register', element: <RegisterPage /> },
            { path: 'login', element: <LoginPage /> },
            { path: 'login/success', element: <LoginSuccessPage /> },
            { path: 'profile', element: <ProfilePage /> },
            { path: 'appointment', element: <AppointmentPage /> },

            {
                element: <AdminPanelOnly />,
                children: [
                    { path: 'admin/services/create', element: <ServiceCreatePage /> },
                    { path: 'admin/services/list', element: <ServiceListPage /> },
                ],
            },

            {
                element: <SuperAdminOnly />,
                children: [
                    { path: 'admins/create', element: <AdminCreatePage /> },
                    { path: 'admins/list', element: <AdminListPage /> },
                    { path: 'super-admin', element: <AdminCreatePage /> },
                ],
            },
        ],
    },
]);
