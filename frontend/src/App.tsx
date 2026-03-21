import { Outlet } from 'react-router-dom';
import Header from './widgets/Header/Header';
import './App.scss';

export default function App() {
    return (
        <div className="app-layout">
            <Header />
            <main className="app-layout__main">
                <Outlet />
            </main>
        </div>
    );
}