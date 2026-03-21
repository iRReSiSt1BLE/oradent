import { createBrowserRouter } from 'react-router-dom';
import App from '../../App';
import HomePage from '../../pages/HomePage/HomePage';
import RegisterPage from '../../pages/RegisterPage/RegisterPage';
import LoginPage from '../../pages/LoginPage/LoginPage';
import LoginSuccessPage from '../../pages/LoginSuccessPage/LoginSuccessPage';
import ProfilePage from '../../pages/ProfilePage/ProfilePage';
import AppointmentPage from '../../pages/AppointmentPage/AppointmentPage';

export const router = createBrowserRouter([
    {
        path: '/',
        element: <App />,
        children: [
            { index: true, element: <HomePage /> },
            { path: 'register', element: <RegisterPage /> },
            { path: 'login', element: <LoginPage /> },
            { path: 'login/success', element: <LoginSuccessPage /> },
            { path: 'profile', element: <ProfilePage /> },
            { path: 'appointment', element: <AppointmentPage /> },
        ],
    },
]);