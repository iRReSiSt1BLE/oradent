import { useEffect, useMemo, useState } from 'react';
import {
    buildDoctorAvatarUrl,
    getAllDoctors,
    getPublicDoctors,
    type DoctorItem,
    type PublicDoctorItem,
} from '../../shared/api/doctorApi';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import './HomePage.scss';

type HomeDoctor = {
    id: string;
    lastName: string;
    firstName: string;
    middleName: string | null;
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

function initials(doctor: HomeDoctor) {
    return `${doctor.lastName?.[0] || ''}${doctor.firstName?.[0] || ''}`.toUpperCase();
}

function fromPublic(list: PublicDoctorItem[]): HomeDoctor[] {
    return list.map((d) => ({
        id: d.id,
        lastName: d.lastName,
        firstName: d.firstName,
        middleName: d.middleName,
        hasAvatar: d.hasAvatar,
        avatarVersion: d.avatarVersion,
    }));
}

function fromAll(list: DoctorItem[]): HomeDoctor[] {
    return list.map((d) => ({
        id: d.id,
        lastName: d.lastName,
        firstName: d.firstName,
        middleName: d.middleName,
        hasAvatar: d.hasAvatar,
        avatarVersion: d.avatarVersion,
    }));
}

export default function HomePage() {
    const [doctors, setDoctors] = useState<HomeDoctor[]>([]);
    const [loading, setLoading] = useState(true);
    const [preferredSize, setPreferredSize] = useState<'sm' | 'md' | 'lg'>('sm');

    useEffect(() => {
        setPreferredSize(detectPreferredSize());
        const onResize = () => setPreferredSize(detectPreferredSize());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    useEffect(() => {
        async function load() {
            setLoading(true);

            const token = getToken();
            const role = getUserRole();
            const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';

            try {
                if (token && isAdmin) {
                    const res = await getAllDoctors(token);
                    setDoctors(fromAll(res.doctors));
                    return;
                }

                const res = await getPublicDoctors();
                setDoctors(fromPublic(res.doctors));
            } catch {
                try {
                    const res = await getPublicDoctors();
                    setDoctors(fromPublic(res.doctors));
                } catch {
                    setDoctors([]);
                }
            } finally {
                setLoading(false);
            }
        }

        void load();
    }, []);

    const preparedDoctors = useMemo(
        () =>
            doctors.map((doctor) => {
                const src = doctor.hasAvatar
                    ? buildDoctorAvatarUrl(doctor.id, preferredSize, doctor.avatarVersion)
                    : '';
                const srcSet = doctor.hasAvatar
                    ? `${buildDoctorAvatarUrl(doctor.id, 'sm', doctor.avatarVersion)} 160w, ${buildDoctorAvatarUrl(
                        doctor.id,
                        'md',
                        doctor.avatarVersion,
                    )} 320w, ${buildDoctorAvatarUrl(doctor.id, 'lg', doctor.avatarVersion)} 640w`
                    : '';

                return { ...doctor, src, srcSet };
            }),
        [doctors, preferredSize],
    );

    return (
        <div className="page-shell home-page">
            <div className="container home-page__container">
                <section className="home-page__doctors">
                    <h2 className="home-page__title">Лікарі сімейної стоматології</h2>

                    {loading ? (
                        <div className="home-page__state">Завантаження лікарів...</div>
                    ) : preparedDoctors.length === 0 ? (
                        <div className="home-page__state">Поки що лікарів не додано.</div>
                    ) : (
                        <div className="home-page__grid">
                            {preparedDoctors.map((doctor) => (
                                <article key={doctor.id} className="home-page__doctor-card">
                                    <div className="home-page__avatar-wrap">
                                        {doctor.hasAvatar ? (
                                            <img
                                                className="home-page__avatar"
                                                src={doctor.src}
                                                srcSet={doctor.srcSet}
                                                sizes="(max-width: 640px) 72vw, 300px"
                                                alt={`${doctor.lastName} ${doctor.firstName}`}
                                                loading="lazy"
                                                decoding="async"
                                            />
                                        ) : (
                                            <div className="home-page__avatar-placeholder">{initials(doctor)}</div>
                                        )}
                                    </div>

                                    <h3>
                                        {doctor.lastName} {doctor.firstName} {doctor.middleName || ''}
                                    </h3>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
