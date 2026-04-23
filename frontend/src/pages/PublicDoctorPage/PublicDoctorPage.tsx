import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
    buildDoctorAvatarUrl,
    getPublicDoctorById,
    type PublicDoctorItem,
    type PublicDoctorReviewItem,
} from '../../shared/api/doctorApi';
import ReviewStars from '../../shared/ui/ReviewStars/ReviewStars';
import './PublicDoctorPage.scss';
import { useI18n } from '../../shared/i18n/I18nProvider';

function parseDbI18nValue(raw: any, language: string): string {
    if (!raw) return '';
    if (typeof raw === 'object' && raw !== null) {
        if ('ua' in raw || 'en' in raw || 'de' in raw || 'fr' in raw) {
            return raw[language] || raw.ua || raw.en || raw.de || raw.fr || '';
        }
        if ('i18n' in raw && raw.i18n) {
            const map = raw.i18n as Record<string, string>;
            return map[language] || map.ua || map.en || map.de || map.fr || '';
        }
        if ('value' in raw && typeof raw.value === 'string') return raw.value;
        if ('name' in raw) return parseDbI18nValue(raw.name, language);
        if ('data' in raw && raw.data && typeof raw.data === 'object') {
            return raw.data[language] || raw.data.ua || raw.data.en || raw.data.de || raw.data.fr || '';
        }
        return '';
    }
    if (typeof raw === 'string') {
        if (!raw.includes('__ORADENT_I18N__')) return raw;
        try {
            const start = raw.indexOf('{');
            if (start === -1) return raw;
            const parsed = JSON.parse(raw.slice(start));
            const data = parsed?.data;
            if (data && typeof data === 'object') {
                return data[language] || data.ua || data.en || data.de || data.fr || raw;
            }
            return raw;
        } catch {
            return raw;
        }
    }
    return String(raw);
}

function fullDoctorName(d: PublicDoctorItem) {
    return `${d.lastName ?? ''} ${d.firstName ?? ''} ${d.middleName ?? ''}`.replace(/\s+/g, ' ').trim();
}

function formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('uk-UA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
}

function DoctorSkeleton() {
    return (
        <div className="public-doctor-page__skeleton">
            <div className="public-doctor-page__skeleton-photo" />
            <div className="public-doctor-page__skeleton-lines">
                <span />
                <span />
                <span />
                <span />
            </div>
        </div>
    );
}

export default function PublicDoctorPage() {
    const { doctorId } = useParams();
    const { language } = useI18n();
    const [doctor, setDoctor] = useState<(PublicDoctorItem & {
        reviews: PublicDoctorReviewItem[];
        reviewsCount: number;
        averageRating: number;
    }) | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        async function load() {
            if (!doctorId) return;
            try {
                setLoading(true);
                setError('');
                const response = await getPublicDoctorById(doctorId);
                setDoctor(response.doctor);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Не вдалося завантажити сторінку лікаря');
            } finally {
                setLoading(false);
            }
        }

        void load();
    }, [doctorId]);

    const doctorName = useMemo(() => (doctor ? fullDoctorName(doctor) : ''), [doctor]);
    const specialtiesText = useMemo(() => {
        if (!doctor) return '';
        const list = Array.isArray(doctor.specialties)
            ? doctor.specialties
                  .map((item) => item?.i18n?.[language] || item?.i18n?.ua || item?.value || '')
                  .filter(Boolean)
            : [];
        return list.length ? list.join(', ') : doctor.specialtyI18n?.[language] || doctor.specialtyI18n?.ua || doctor.specialty || '';
    }, [doctor, language]);
    const infoText = useMemo(() => parseDbI18nValue(doctor?.infoBlockI18n || doctor?.infoBlock, language), [doctor, language]);
    const avatarUrl = doctor?.hasAvatar ? buildDoctorAvatarUrl(doctor.id, 'lg', doctor.avatarVersion) : '';

    return (
        <main className="public-doctor-page">
            <div className="container public-doctor-page__container">
                {loading ? (
                    <DoctorSkeleton />
                ) : error ? (
                    <div className="public-doctor-page__state">{error}</div>
                ) : !doctor ? (
                    <div className="public-doctor-page__state">Лікаря не знайдено</div>
                ) : (
                    <>
                        <section className="public-doctor-page__hero">
                            <div className="public-doctor-page__photo-wrap">
                                {avatarUrl ? (
                                    <img src={avatarUrl} alt={doctorName} className="public-doctor-page__photo" />
                                ) : (
                                    <div className="public-doctor-page__photo public-doctor-page__photo--placeholder">OR</div>
                                )}
                            </div>

                            <div className="public-doctor-page__content">
                                <p className="public-doctor-page__eyebrow">Лікар ORADENT</p>
                                <h1 className="public-doctor-page__title">{doctorName}</h1>
                                {specialtiesText ? <p className="public-doctor-page__specialties">{specialtiesText}</p> : null}
                                {infoText ? <p className="public-doctor-page__description">{infoText}</p> : null}

                                <div className="public-doctor-page__stats">
                                    <div className="public-doctor-page__stat-card">
                                        <span>Середня оцінка</span>
                                        <strong>{doctor.averageRating ? doctor.averageRating.toFixed(1) : '—'}</strong>
                                        <ReviewStars value={doctor.averageRating || 0} size="md" />
                                    </div>
                                    <div className="public-doctor-page__stat-card">
                                        <span>Відгуків</span>
                                        <strong>{doctor.reviewsCount}</strong>
                                    </div>
                                </div>

                                <div className="public-doctor-page__actions">
                                    <Link to={`/doctors/${doctor.id}/schedule`} className="public-doctor-page__primary-btn">
                                        Записатися до лікаря
                                    </Link>
                                    <Link to="/" className="public-doctor-page__ghost-btn">
                                        На головну
                                    </Link>
                                </div>
                            </div>
                        </section>

                        <section className="public-doctor-page__reviews">
                            <div className="public-doctor-page__section-head">
                                <h2>Відгуки пацієнтів</h2>
                                <p>Оцінки прив’язані до завершених записів.</p>
                            </div>

                            {!doctor.reviews.length ? (
                                <div className="public-doctor-page__empty-reviews">Поки що відгуків немає.</div>
                            ) : (
                                <div className="public-doctor-page__review-list">
                                    {doctor.reviews.map((review) => (
                                        <article key={review.appointmentId} className="public-doctor-page__review-card">
                                            <div className="public-doctor-page__review-top">
                                                <div>
                                                    <strong>{review.authorName}</strong>
                                                    <span>{formatDate(review.createdAt)}</span>
                                                </div>
                                                <div className="public-doctor-page__review-rating">
                                                    <ReviewStars value={review.rating} size="sm" />
                                                    <b>{review.rating.toFixed(1)}</b>
                                                </div>
                                            </div>
                                            {review.text ? <p>{review.text}</p> : <p className="is-muted">Без текстового коментаря</p>}
                                        </article>
                                    ))}
                                </div>
                            )}
                        </section>
                    </>
                )}
            </div>
        </main>
    );
}
