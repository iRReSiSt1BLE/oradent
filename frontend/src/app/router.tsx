import { createBrowserRouter } from 'react-router-dom';
import AppointmentPage from "../pages/AppointmentPage/AppointmentPage.tsx";

export const router = createBrowserRouter([
    {
        path: '/',
        element: <div>Home Page</div>, // поки заглушка
    },
    {
        path: '/appointment',
        element: <AppointmentPage />,
    },
]);