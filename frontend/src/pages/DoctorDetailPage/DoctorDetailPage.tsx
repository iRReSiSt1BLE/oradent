import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    buildDoctorAvatarUrl,
    getDoctorById,
    uploadDoctorAvatar,
} from '../../shared/api/doctorApi';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import './DoctorDetailPage.scss';

type DoctorItem = {
    id: string;
    userId: string;
    email: string;
    lastName: string;
    firstName: string;
    middleName: string | null;
    phone: string;
    isActive: boolean;
    hasAvatar: boolean;
    avatarVersion: number;
};

function detectPreferredSize(): 'sm' | 'md' | 'lg' {
    const dpr = window.devicePixelRatio || 1;
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    const effectiveType = connection?.effectiveType || '';

    if (effectiveType === 'slow-2g' || effectiveType === '2g') return 'sm';
    if (effectiveType === '3g') return 'md';
    if (dpr >= 2) return 'lg';
    return 'md';
}

export default function DoctorDetailPage() {
    const { doctorId } = useParams();
    const token = getToken();
    const role = getUserRole();
    const isAllowed = role === 'ADMIN' || role === 'SUPER_ADMIN';

    const [doctor, setDoctor] = useState<DoctorItem | null>(null);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [preferredSize, setPreferredSize] = useState<'sm' | 'md' | 'lg'>('md');

    useEffect(() => {
        setPreferredSize(detectPreferredSize());
        const onResize = () => setPreferredSize(detectPreferredSize());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    useEffect(() => {
        async function load() {
            if (!token || !doctorId || !isAllowed) {
                setLoading(false);
                return;
            }

            setLoading(true);
            setError('');

            try {
                const res = await getDoctorById(token, doctorId);
                setDoctor(res.doctor);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Не вдалося завантажити профіль лікаря');
            } finally {
                setLoading(false);
            }
        }

        void load();
    }, [token, doctorId, isAllowed]);

    const avatarSrc = useMemo(() => {
        if (!doctor?.hasAvatar) return '';
        return buildDoctorAvatarUrl(doctor.id, preferredSize, doctor.avatarVersion);
    }, [doctor, preferredSize]);

    const avatarSrcSet = useMemo(() => {
        if (!doctor?.hasAvatar) return '';
        const sm = buildDoctorAvatarUrl(doctor.id, 'sm', doctor.avatarVersion);
        const md = buildDoctorAvatarUrl(doctor.id, 'md', doctor.avatarVersion);
        const lg = buildDoctorAvatarUrl(doctor.id, 'lg', doctor.avatarVersion);
        return `${sm} 160w, ${md} 320w, ${lg} 640w`;
    }, [doctor]);

    async function handleUpload(file: File | null) {
        if (!file || !token || !doctor) return;

        setUploading(true);
        setMessage('');
        setError('');

        try {
            const res = await uploadDoctorAvatar(token, doctor.id, file);
            setDoctor({
                id: res.doctor.id,
                userId: res.doctor.userId,
                email: res.doctor.email,
                lastName: res.doctor.lastName,
                firstName: res.doctor.firstName,
                middleName: res.doctor.middleName,
                phone: res.doctor.phone,
                isActive: res.doctor.isActive,
                hasAvatar: res.doctor.hasAvatar,
                avatarVersion: res.doctor.avatarVersion,
            });
            setMessage(res.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося завантажити аватар');
        } finally {
            setUploading(false);
        }
    }

    if (!isAllowed) {
        return (
            <div className="page-shell doctor-detail-page">
                <div className="container doctor-detail-page__container">
                    <section className="doctor-detail-page__card">
                        <h1 className="doctor-detail-page__title">ПРОФІЛЬ ЛІКАРЯ</h1>
                        <div className="doctor-detail-page__blocked">Доступно лише для ADMIN та SUPER_ADMIN.</div>
                    </section>
                </div>
            </div>
        );
    }

    return (
        <div className="page-shell doctor-detail-page">
            <div className="container doctor-detail-page__container">
                {error && (
                    <div className="doctor-detail-page__top-alert">
                        <AlertToast message={error} variant="error" onClose={() => setError('')} />
                    </div>
                )}
                {message && (
                    <div className="doctor-detail-page__top-alert">
                        <AlertToast message={message} variant="success" onClose={() => setMessage('')} />
                    </div>
                )}

                <section className="doctor-detail-page__card">
                    {loading || !doctor ? (
                        <div className="doctor-detail-page__blocked">Завантаження...</div>
                    ) : (
                        <>
                            <h1 className="doctor-detail-page__title">
                                {doctor.lastName} {doctor.firstName} {doctor.middleName || ''}
                            </h1>

                            <div className="doctor-detail-page__meta">
                                <p>{doctor.email}</p>
                                <p>{doctor.phone}</p>
                            </div>

                            <div className="doctor-detail-page__avatar-wrap">
                                {doctor.hasAvatar ? (
                                    <img
                                        className="doctor-detail-page__avatar"
                                        src={avatarSrc}
                                        srcSet={avatarSrcSet}
                                        sizes="(max-width: 640px) 160px, (max-width: 1024px) 220px, 260px"
                                        alt="Аватар лікаря"
                                        loading="eager"
                                        decoding="async"
                                    />
                                ) : (
                                    <div className="doctor-detail-page__avatar-placeholder">Немає фото</div>
                                )}
                            </div>

                            <label className="doctor-detail-page__upload">
                                <span>{uploading ? 'Завантаження...' : 'Завантажити/замінити фото'}</span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    disabled={uploading}
                                    onChange={(e) => handleUpload(e.target.files?.[0] || null)}
                                />
                            </label>
                        </>
                    )}
                </section>
            </div>
        </div>
    );
}
