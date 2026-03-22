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
                    {variant === 'success' && '✓'}
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

            <div
                className="alert-toast__timer"
                style={{ animationDuration: `${duration}ms` }}
            />
        </div>
    );
}