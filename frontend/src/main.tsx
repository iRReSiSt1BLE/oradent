import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './app/router/router';
import { I18nProvider } from './shared/i18n/I18nProvider';
import './app/styles/global.scss';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <I18nProvider>
            <RouterProvider router={router} />
        </I18nProvider>
    </React.StrictMode>,
);
