import { useEffect } from 'react';
import './AlertToast.scss';

type AlertToastVariant = 'success' | 'error' | 'info';

type AlertToastProps = {
    message: string;
    variant?: AlertToastVariant;
    duration?: number;
    onClose: () => void;
};

export default function AlertToast({
                                       message,
                                       variant = 'info',
                                       duration = 10000,
                                       onClose,
                                   }: AlertToastProps) {
    useEffect(() => {
        const timer = window.setTimeout(() => {
            onClose();
        }, duration);

        return () => window.clearTimeout(timer);
    }, [duration, onClose]);

    return (
        <div className={`alert-toast alert-toast--${variant}`} role="alert">
            <div className="alert-toast__content">
                <div className="alert-toast__icon">
                    {variant === 'success' && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16">
                            <polyline
                                fill="none"
                                stroke="#000"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="1.5"
                                points="2.75 8.75 6.25 12.25 13.25 4.75"
                            />
                        </svg>
                    )}
                    {variant === 'error' && '✕'}
                    {variant === 'info' && 'i'}
                </div>

                <div className="alert-toast__message">{message}</div>

                <button
                    className="alert-toast__close"
                    type="button"
                    onClick={onClose}
                    aria-label="Закрити повідомлення"
                >
                    ×
                </button>
            </div>

            <div className="alert-toast__timer" style={{ animationDuration: `${duration}ms` }} />
        </div>
    );
}
