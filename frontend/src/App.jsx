import { useState } from 'react';

function App() {
    const [healthResult, setHealthResult] = useState(null);
    const [dbResult, setDbResult] = useState(null);
    const [error, setError] = useState('');

    const checkBackend = async () => {
        try {
            setError('');
            const response = await fetch('http://localhost:3000/api/health');
            const data = await response.json();
            setHealthResult(data);
        } catch (err) {
            setError('Backend request failed');
            console.error(err);
        }
    };

    const checkDatabase = async () => {
        try {
            setError('');
            const response = await fetch('http://localhost:3000/api/db-test');
            const data = await response.json();
            setDbResult(data);
        } catch (err) {
            setError('Database request failed');
            console.error(err);
        }
    };

    return (
        <div style={{ padding: '30px', fontFamily: 'Arial, sans-serif' }}>
            <h1>Medicore test frontend</h1>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                <button onClick={checkBackend}>Check backend</button>
                <button onClick={checkDatabase}>Check database</button>
            </div>

            {error && <p style={{ color: 'red' }}>{error}</p>}

            {healthResult && (
                <div>
                    <h2>Backend response</h2>
                    <pre>{JSON.stringify(healthResult, null, 2)}</pre>
                </div>
            )}

            {dbResult && (
                <div>
                    <h2>Database response</h2>
                    <pre>{JSON.stringify(dbResult, null, 2)}</pre>
                </div>
            )}
        </div>
    );
}

export default App;