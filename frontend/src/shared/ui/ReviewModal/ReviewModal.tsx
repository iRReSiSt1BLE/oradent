import { useEffect, useState } from 'react';
import { submitAppointmentReview } from '../../api/appointmentApi';
import ReviewStars from '../ReviewStars/ReviewStars';
import './ReviewModal.scss';

type ReviewModalProps = {
    open: boolean;
    token: string;
    appointmentId: string | null;
    serviceName?: string | null;
    doctorName?: string | null;
    onClose: () => void;
    onSubmitted: (appointment: any, message: string) => void;
};

export default function ReviewModal({
    open,
    token,
    appointmentId,
    serviceName,
    doctorName,
    onClose,
    onSubmitted,
}: ReviewModalProps) {
    const [rating, setRating] = useState(5);
    const [text, setText] = useState('');
    const [anonymous, setAnonymous] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!open) return;
        setRating(5);
        setText('');
        setAnonymous(false);
        setError('');
        setSubmitting(false);
    }, [open, appointmentId]);

    if (!open || !appointmentId) return null;

    async function handleSubmit() {
        if (!appointmentId) return;
        try {
            setSubmitting(true);
            setError('');
            const response = await submitAppointmentReview(token, appointmentId, {
                rating,
                text,
                anonymous,
            });
            onSubmitted(response.appointment, response.message || 'Відгук збережено');
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося зберегти відгук');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="review-modal" role="dialog" aria-modal="true">
            <div className="review-modal__backdrop" onClick={onClose} />
            <div className="review-modal__card">
                <button type="button" className="review-modal__close" onClick={onClose} aria-label="Закрити">
                    ×
                </button>

                <div className="review-modal__head">
                    <h3>Залишити відгук</h3>
                    <p>
                        {serviceName || 'Прийом'}
                        {doctorName ? ` · ${doctorName}` : ''}
                    </p>
                </div>

                <div className="review-modal__field review-modal__field--stars">
                    <span className="review-modal__label">Оцінка</span>
                    <div className="review-modal__rating-row">
                        <ReviewStars value={rating} interactive size="lg" onChange={setRating} disabled={submitting} />
                        <strong>{rating.toFixed(1)}</strong>
                    </div>
                </div>

                <label className="review-modal__checkbox">
                    <input
                        type="checkbox"
                        checked={anonymous}
                        onChange={(event) => setAnonymous(event.target.checked)}
                        disabled={submitting}
                    />
                    <span>Опублікувати анонімно</span>
                </label>

                <label className="review-modal__field">
                    <span className="review-modal__label">Текст відгуку</span>
                    <textarea
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        placeholder="Можна залишити кілька слів про візит"
                        maxLength={2000}
                        disabled={submitting}
                    />
                </label>

                {error ? <div className="review-modal__error">{error}</div> : null}

                <div className="review-modal__actions">
                    <button type="button" className="review-modal__ghost" onClick={onClose} disabled={submitting}>
                        Скасувати
                    </button>
                    <button type="button" className="review-modal__primary" onClick={handleSubmit} disabled={submitting}>
                        {submitting ? <span className="review-modal__spinner" /> : null}
                        <span>{submitting ? 'Надсилаємо...' : 'Надіслати відгук'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
