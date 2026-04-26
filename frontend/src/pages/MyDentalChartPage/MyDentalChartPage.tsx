import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    fetchDentalSnapshotFile,
    getAppointmentDentalChart,
    getAppointmentDentalChartWithPassword,
    getMyDentalChart,
    type DentalChartResponse,
    type DentalSnapshotItem,
    type DentalTargetType,
} from '../../shared/api/dentalChartApi';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import './MyDentalChartPage.scss';

type DentalTargetSelection = {
    targetType: DentalTargetType;
    label: string;
    toothNumber?: number | null;
    jaw?: 'UPPER' | 'LOWER' | 'WHOLE' | null;
};

const DENTAL_TEETH_ROWS = [
    [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
    [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
];

function formatDateTime(value: string | null) {
    if (!value) return 'Дата не вказана';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString('uk-UA');
}

function dentalTargetLabel(target: DentalTargetSelection | DentalSnapshotItem) {
    if (target.targetType === 'TOOTH' && target.toothNumber) return `Зуб ${target.toothNumber}`;
    if (target.targetType === 'JAW') return target.jaw === 'LOWER' ? 'Нижня щелепа' : 'Верхня щелепа';
    return 'Уся ротова порожнина';
}

function snapshotMatchesTarget(snapshot: DentalSnapshotItem, target: DentalTargetSelection) {
    if (target.targetType === 'TOOTH') return snapshot.targetType === 'TOOTH' && snapshot.toothNumber === target.toothNumber;
    if (target.targetType === 'JAW') return snapshot.targetType === 'JAW' && snapshot.jaw === target.jaw;
    return snapshot.targetType === 'MOUTH';
}

export default function MyDentalChartPage() {
    const token = getToken();
    const role = getUserRole();
    const [searchParams] = useSearchParams();
    const appointmentId = searchParams.get('appointmentId');
    const doctorPasswordRequired = Boolean(appointmentId && role === 'DOCTOR');

    const [chart, setChart] = useState<DentalChartResponse | null>(null);
    const [loading, setLoading] = useState(!doctorPasswordRequired);
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [password, setPassword] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [authorized, setAuthorized] = useState(!doctorPasswordRequired);
    const [error, setError] = useState('');
    const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
    const imageUrlsRef = useRef<Record<string, string>>({});
    const [selectedTarget, setSelectedTarget] = useState<DentalTargetSelection>({
        targetType: 'MOUTH',
        label: 'Уся ротова порожнина',
        jaw: 'WHOLE',
    });

    const selectedHistory = useMemo(
        () => (chart?.snapshots || []).filter((snapshot) => snapshotMatchesTarget(snapshot, selectedTarget)),
        [chart?.snapshots, selectedTarget],
    );

    async function loadWithPassword() {
        if (!token || !appointmentId) return;
        if (!password.trim()) {
            setPasswordError('Введіть пароль від акаунта.');
            return;
        }

        try {
            setPasswordLoading(true);
            setPasswordError('');
            const response = await getAppointmentDentalChartWithPassword(token, appointmentId, password.trim());
            setChart(response);
            setAuthorized(true);
        } catch (err) {
            setPasswordError(err instanceof Error ? err.message : 'Не вдалося відкрити зубну карту.');
        } finally {
            setPasswordLoading(false);
        }
    }

    useEffect(() => {
        async function load() {
            if (!token) {
                setLoading(false);
                setError('Увійдіть у систему, щоб переглянути зубну карту.');
                return;
            }

            if (doctorPasswordRequired) {
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                setError('');
                const response = appointmentId
                    ? await getAppointmentDentalChart(token, appointmentId)
                    : await getMyDentalChart(token);
                setChart(response);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Не вдалося завантажити зубну карту.');
            } finally {
                setLoading(false);
            }
        }

        void load();
    }, [appointmentId, doctorPasswordRequired, token]);

    useEffect(() => {
        if (!token || !chart?.snapshots?.length) return;

        chart.snapshots.forEach((snapshot) => {
            if (!snapshot.hasFile || imageUrlsRef.current[snapshot.id]) return;

            void fetchDentalSnapshotFile(token, snapshot.id)
                .then((blob) => {
                    const url = URL.createObjectURL(blob);
                    imageUrlsRef.current[snapshot.id] = url;
                    setImageUrls((prev) => ({ ...prev, [snapshot.id]: url }));
                })
                .catch(() => null);
        });
    }, [chart?.snapshots, token]);

    useEffect(() => {
        return () => {
            Object.values(imageUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
            imageUrlsRef.current = {};
        };
    }, []);

    const patientName = `${chart?.patient.lastName || ''} ${chart?.patient.firstName || ''}`.trim() || 'Пацієнт';

    return (
        <main className="my-dental-chart">
            <section className="my-dental-chart__hero">
                <h1>{appointmentId ? 'Зубна карта пацієнта' : 'Моя зубна карта'}</h1>
                <p>Тут зберігаються знімки та примітки, прикріплені до зубів, щелепи або всієї ротової порожнини.</p>
            </section>

            {doctorPasswordRequired && !authorized ? (
                <section className="my-dental-chart__password-card">
                    <h2>Підтвердження доступу</h2>
                    <p>Введіть пароль від акаунта лікаря, щоб переглянути зубну карту цього прийому.</p>
                    <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Пароль від акаунта"
                        disabled={passwordLoading}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') void loadWithPassword();
                        }}
                    />
                    {passwordError ? <div className="my-dental-chart__password-error">{passwordError}</div> : null}
                    <button type="button" onClick={() => void loadWithPassword()} disabled={passwordLoading}>
                        {passwordLoading ? 'Перевірка…' : 'Відкрити зубну карту'}
                    </button>
                </section>
            ) : null}

            {loading ? <div className="my-dental-chart__state">Завантаження зубної карти…</div> : null}
            {!loading && error ? <div className="my-dental-chart__state is-error">{error}</div> : null}

            {!loading && !error && chart && authorized ? (
                <section className="my-dental-chart__panel">
                    <div className="my-dental-chart__patient-row">
                        <div>
                            <h2>{patientName}</h2>
                            <p>{chart.snapshots.length} записів в історії</p>
                        </div>
                    </div>

                    <div className="my-dental-chart__layout">
                        <div className="my-dental-chart__map">
                            <div className="my-dental-chart__jaw-actions">
                                <button type="button" className={selectedTarget.targetType === 'MOUTH' ? 'is-selected' : ''} onClick={() => setSelectedTarget({ targetType: 'MOUTH', label: 'Уся ротова порожнина', jaw: 'WHOLE' })}>
                                    Уся ротова порожнина <span>{chart.mouthHistory.length}</span>
                                </button>
                                <button type="button" className={selectedTarget.targetType === 'JAW' && selectedTarget.jaw === 'UPPER' ? 'is-selected' : ''} onClick={() => setSelectedTarget({ targetType: 'JAW', label: 'Верхня щелепа', jaw: 'UPPER' })}>
                                    Верхня щелепа <span>{chart.upperJawHistory.length}</span>
                                </button>
                                <button type="button" className={selectedTarget.targetType === 'JAW' && selectedTarget.jaw === 'LOWER' ? 'is-selected' : ''} onClick={() => setSelectedTarget({ targetType: 'JAW', label: 'Нижня щелепа', jaw: 'LOWER' })}>
                                    Нижня щелепа <span>{chart.lowerJawHistory.length}</span>
                                </button>
                            </div>

                            <div className="my-dental-chart__tooth-grid" aria-label="32 зуби">
                                {DENTAL_TEETH_ROWS.map((row, rowIndex) => (
                                    <div className="my-dental-chart__tooth-row" key={`row-${rowIndex}`}>
                                        {row.map((toothNumber) => {
                                            const tooth = chart.teeth.find((item) => item.number === toothNumber);
                                            const isSelected = selectedTarget.targetType === 'TOOTH' && selectedTarget.toothNumber === toothNumber;
                                            return (
                                                <button
                                                    type="button"
                                                    key={toothNumber}
                                                    className={`my-dental-chart__tooth ${isSelected ? 'is-selected' : ''} ${tooth?.snapshotCount ? 'has-history' : ''}`}
                                                    onClick={() => setSelectedTarget({ targetType: 'TOOTH', label: `Зуб ${toothNumber}`, toothNumber })}
                                                >
                                                    <span>{toothNumber}</span>
                                                    {tooth?.snapshotCount ? <em>{tooth.snapshotCount}</em> : null}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="my-dental-chart__history">
                            <div className="my-dental-chart__history-head">
                                <h2>{selectedTarget.label}</h2>
                                <span>{selectedHistory.length} записів</span>
                            </div>

                            {selectedHistory.length ? (
                                <div className="my-dental-chart__snapshot-list">
                                    {selectedHistory.map((snapshot) => (
                                        <article className="my-dental-chart__snapshot-card" key={snapshot.id}>
                                            {snapshot.hasFile ? (
                                                imageUrls[snapshot.id] ? (
                                                    <a href={imageUrls[snapshot.id]} target="_blank" rel="noreferrer" className="my-dental-chart__snapshot-link">
                                                        <img src={imageUrls[snapshot.id]} alt={snapshot.title || dentalTargetLabel(snapshot)} />
                                                    </a>
                                                ) : <div className="my-dental-chart__snapshot-placeholder">Завантаження…</div>
                                            ) : <div className="my-dental-chart__snapshot-placeholder is-note">Без фото</div>}
                                            <div className="my-dental-chart__snapshot-content">
                                                <strong>{snapshot.title || dentalTargetLabel(snapshot)}</strong>
                                                <span>{snapshot.doctorName || 'Лікар не вказаний'} · {formatDateTime(snapshot.capturedAt || snapshot.createdAt)}</span>
                                                {snapshot.description ? <p>{snapshot.description}</p> : null}
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            ) : (
                                <div className="my-dental-chart__state">Для вибраної області ще немає записів.</div>
                            )}
                        </div>
                    </div>
                </section>
            ) : null}
        </main>
    );
}
