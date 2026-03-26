import './TelegramQrCard.scss';

type TelegramQrCardProps = {
    telegramBotUrl: string;
    title?: string;
    subtitle?: string;
    buttonLabel?: string;
};

export default function TelegramQrCard({
    telegramBotUrl,
    title = 'Скануй QR для підтвердження в Telegram',
    subtitle = 'Відскануй код камерою телефону або відкрий Telegram вручну.',
    buttonLabel = 'ВІДКРИТИ TELEGRAM',
}: TelegramQrCardProps) {
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(
        telegramBotUrl,
    )}`;

    return (
        <div className="telegram-qr-card">
            <div className="telegram-qr-card__qr-wrap">
                <img className="telegram-qr-card__qr" src={qrImageUrl} alt="Telegram QR code" loading="lazy" />
            </div>

            <div className="telegram-qr-card__content">
                <h3>{title}</h3>
                <p>{subtitle}</p>
                <a href={telegramBotUrl} target="_blank" rel="noreferrer">
                    {buttonLabel}
                </a>
            </div>
        </div>
    );
}
