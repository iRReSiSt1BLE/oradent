import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './AlertToast.scss';

type AlertToastVariant = 'success' | 'error' | 'info';


function getAlertRoot() {
    if (typeof document === 'undefined') return null;

    let root = document.getElementById('oradent-alert-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'oradent-alert-root';
        root.className = 'alert-toast-root';
        document.body.appendChild(root);
    }

    return root;
}

type AlertToastProps = {
    message: string;
    variant?: AlertToastVariant;
    duration?: number;
    onClose: () => void;
};

export default function AlertToast({
                                       message,
                                       variant = 'info',
                                       duration = 1800,
                                       onClose,
                                   }: AlertToastProps) {
    const [isClosing, setIsClosing] = useState(false);
    const closeTimerRef = useRef<number | null>(null);
    const exitTimerRef = useRef<number | null>(null);

    function startClose() {
        if (isClosing) return;
        setIsClosing(true);

        if (exitTimerRef.current) {
            window.clearTimeout(exitTimerRef.current);
        }

        exitTimerRef.current = window.setTimeout(() => {
            onClose();
        }, 200);
    }

    useEffect(() => {
        if (duration <= 0) return;

        closeTimerRef.current = window.setTimeout(() => {
            startClose();
        }, duration);

        return () => {
            if (closeTimerRef.current) {
                window.clearTimeout(closeTimerRef.current);
            }
            if (exitTimerRef.current) {
                window.clearTimeout(exitTimerRef.current);
            }
        };
    }, [duration]);

    const root = getAlertRoot();
    const toast = (
        <div className={`alert-toast alert-toast--${variant} ${isClosing ? 'is-closing' : ''}`} role="alert">
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
                    onClick={startClose}
                    aria-label="Закрити повідомлення"
                >
                    ×
                </button>
            </div>

            {duration > 0 && (
                <div
                    className={`alert-toast__timer ${isClosing ? 'is-hidden' : ''}`}
                    style={{ animationDuration: `${duration}ms` }}
                />
            )}
        </div>
    );

    return root ? createPortal(toast, root) : toast;
}
