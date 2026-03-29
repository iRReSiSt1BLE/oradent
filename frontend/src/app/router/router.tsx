import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom';
import App from '../../App';
import HomePage from '../../pages/HomePage/HomePage';
import RegisterPage from '../../pages/RegisterPage/RegisterPage';
import LoginPage from '../../pages/LoginPage/LoginPage';
import LoginSuccessPage from '../../pages/LoginSuccessPage/LoginSuccessPage';
import ProfilePage from '../../pages/ProfilePage/ProfilePage';
import DoctorProfilePage from '../../pages/DoctorProfilePage/DoctorProfilePage';
import AppointmentPage from '../../pages/AppointmentPage/AppointmentPage';
import AdminCreatePage from '../../pages/AdminCreatePage/AdminCreatePage';
import AdminListPage from '../../pages/AdminListPage/AdminListPage';
import ServiceCreatePage from '../../pages/ServiceCreatePage/ServiceCreatePage';
import ServiceListPage from '../../pages/ServiceListPage/ServiceListPage';
import ServiceDetailPage from '../../pages/ServiceDetailPage/ServiceDetailPage';
import DoctorCreatePage from '../../pages/DoctorCreatePage/DoctorCreatePage';
import DoctorListPage from '../../pages/DoctorListPage/DoctorListPage';
import DoctorDetailPage from '../../pages/DoctorDetailPage/DoctorDetailPage';
import DoctorAppointmentsPage from '../../pages/DoctorAppointmentsPage/DoctorAppointmentsPage';
import DoctorAppointmentDetailPage from '../../pages/DoctorAppointmentDetailPage/DoctorAppointmentDetailPage';
import { getToken, getUserRole } from '../../shared/utils/authStorage';

function SuperAdminOnly() {
    const token = getToken();
    const role = getUserRole();

    if (!token) return <Navigate to="/login" replace />;
    if (role !== 'SUPER_ADMIN') return <Navigate to="/" replace />;
    return <Outlet />;
}

function AdminPanelOnly() {
    const token = getToken();
    const role = getUserRole();

    if (!token) return <Navigate to="/login" replace />;
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') return <Navigate to="/" replace />;
    return <Outlet />;
}

function DoctorOnly() {
    const token = getToken();
    const role = getUserRole();

    if (!token) return <Navigate to="/login" replace />;
    if (role !== 'DOCTOR') return <Navigate to="/" replace />;
    return <Outlet />;
}

function RoleBasedProfilePage() {
    const role = getUserRole();
    if (role === 'DOCTOR') return <DoctorProfilePage />;
    return <ProfilePage />;
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
            { path: 'profile', element: <RoleBasedProfilePage /> },
            { path: 'appointment', element: <AppointmentPage /> },

            {
                element: <DoctorOnly />,
                children: [
                    { path: 'doctor/appointments', element: <DoctorAppointmentsPage /> },
                    { path: 'doctor/appointments/:id', element: <DoctorAppointmentDetailPage /> },
                ],
            },

            {
                element: <AdminPanelOnly />,
                children: [
                    { path: 'admin/services/create', element: <ServiceCreatePage /> },
                    { path: 'admin/services/list', element: <ServiceListPage /> },
                    { path: 'admin/doctors/create', element: <DoctorCreatePage /> },
                    { path: 'admin/doctors/list', element: <DoctorListPage /> },
                    { path: 'admin/doctors/:doctorId', element: <DoctorDetailPage /> },
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
