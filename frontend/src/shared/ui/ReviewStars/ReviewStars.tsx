import { useId } from 'react';
import './ReviewStars.scss';

type ReviewStarsProps = {
    value: number;
    size?: 'sm' | 'md' | 'lg';
    interactive?: boolean;
    disabled?: boolean;
    onChange?: (value: number) => void;
};

const STAR_VALUES = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
const STAR_INDEXES = [0, 1, 2, 3, 4];
const STAR_PATH =
    'M12 1.85l3.14 6.37 7.03 1.02-5.08 4.95 1.2 7-6.29-3.31-6.29 3.31 1.2-7-5.08-4.95 7.03-1.02L12 1.85z';

function clampValue(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(5, Math.round(value * 2) / 2));
}

function getStarFillPercent(value: number, index: number) {
    const fill = Math.max(0, Math.min(1, value - index));
    return fill * 100;
}

export default function ReviewStars({
    value,
    size = 'md',
    interactive = false,
    disabled = false,
    onChange,
}: ReviewStarsProps) {
    const normalized = clampValue(value);
    const idPrefix = useId().replace(/:/g, '');

    return (
        <div className={`review-stars review-stars--${size} ${interactive ? 'is-interactive' : ''} ${disabled ? 'is-disabled' : ''}`}>
            <div className="review-stars__visual" aria-hidden="true">
                {STAR_INDEXES.map((index) => {
                    const fillPercent = getStarFillPercent(normalized, index);
                    const gradientId = `${idPrefix}-star-${index}`;

                    return (
                        <svg key={gradientId} className="review-stars__star" viewBox="0 0 24 24" focusable="false">
                            <defs>
                                <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset={`${fillPercent}%`} stopColor="#84d8ce" />
                                    <stop offset={`${fillPercent}%`} stopColor="#cbd5df" />
                                </linearGradient>
                            </defs>
                            <path d={STAR_PATH} fill={`url(#${gradientId})`} />
                        </svg>
                    );
                })}
            </div>

            {interactive ? (
                <div className="review-stars__controls" role="radiogroup" aria-label="Оцінка відгуку">
                    {STAR_VALUES.map((option) => (
                        <button
                            key={option}
                            type="button"
                            className="review-stars__segment"
                            disabled={disabled}
                            aria-label={`${option} зірки`}
                            aria-checked={normalized === option}
                            role="radio"
                            onClick={() => onChange?.(option)}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}
