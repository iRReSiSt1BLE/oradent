import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import { getPublicServiceById } from '../../shared/api/servicesApi';
import type { ClinicService } from '../../shared/api/servicesApi';
import './ServiceDetailPage.scss';

export default function ServiceDetailPage() {
    const { serviceId } = useParams();

    const [service, setService] = useState<ClinicService | null>(null);
    const [pricingRate, setPricingRate] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        async function load() {
            if (!serviceId) {
                setError('Послугу не знайдено');
                setLoading(false);
                return;
            }

            setLoading(true);
            setError('');

            try {
                const result = await getPublicServiceById(serviceId);
                setService(result.service);
                setPricingRate(result.pricing.usdBuyRate);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Не вдалося завантажити послугу');
            } finally {
                setLoading(false);
            }
        }

        void load();
    }, [serviceId]);

    return (
        <div className="page-shell service-detail-page">
            <div className="container service-detail-page__container">
                {error && (
                    <div className="service-detail-page__top-alert">
                        <AlertToast message={error} variant="error" onClose={() => setError('')} />
                    </div>
                )}

                {loading ? (
                    <section className="service-detail-page__card">
                        <div className="service-detail-page__state">Завантаження...</div>
                    </section>
                ) : !service ? (
                    <section className="service-detail-page__card">
                        <div className="service-detail-page__state">Послугу не знайдено</div>
                    </section>
                ) : (
                    <section className="service-detail-page__card">
                        <div className="service-detail-page__category">{service.category?.name || 'Категорія'}</div>
                        <h1 className="service-detail-page__title">{service.name}</h1>

                        <p className="service-detail-page__description">
                            {service.description || 'Детальний опис послуги буде додано найближчим часом.'}
                        </p>

                        <div className="service-detail-page__meta">
                            <div className="service-detail-page__meta-item">
                                <span>Тривалість</span>
                                <strong>{service.durationMinutes} хв</strong>
                            </div>
                            <div className="service-detail-page__meta-item">
                                <span>Ціна</span>
                                <strong>{Math.round(service.priceUah)} грн</strong>
                            </div>
                            <div className="service-detail-page__meta-item">
                                <span>Еквівалент</span>
                                <strong>${service.priceUsd.toFixed(2)}</strong>
                            </div>
                        </div>

                        {pricingRate !== null && (
                            <p className="service-detail-page__pricing-note">
                                Курс Monobank (buy): {pricingRate.toFixed(2)} грн за $1. Округлення ціни до 10 грн.
                            </p>
                        )}

                        <div className="service-detail-page__actions">
                            <Link className="service-detail-page__btn" to="/appointment">
                                ЗАПИСАТИСЯ НА ПРИЙОМ
                            </Link>
                            <Link className="service-detail-page__btn service-detail-page__btn--ghost" to="/">
                                НАЗАД ДО ПОСЛУГ
                            </Link>
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}
