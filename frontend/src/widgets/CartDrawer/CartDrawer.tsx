import { useI18n } from '../../shared/i18n/I18nProvider';
import type { CartItem } from '../../shared/cart/cartStore';
import './CartDrawer.scss';

type Props = {
    isOpen: boolean;
    items: CartItem[];
    totalUah: number;
    onClose: () => void;
    onRemove: (serviceId: string) => void;
    onClear: () => void;
    onBook: () => void;
};

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

        if ('value' in raw && typeof raw.value === 'string') {
            return raw.value;
        }

        if ('name' in raw) {
            return parseDbI18nValue(raw.name, language);
        }

        if ('data' in raw && raw.data && typeof raw.data === 'object') {
            return (
                raw.data[language] ||
                raw.data.ua ||
                raw.data.en ||
                raw.data.de ||
                raw.data.fr ||
                ''
            );
        }

        return '';
    }

    if (typeof raw === 'string') {
        if (!raw.includes('__ORADENT_I18N__')) {
            return raw;
        }

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

export default function CartDrawer({
                                       isOpen,
                                       items,
                                       totalUah,
                                       onClose,
                                       onRemove,
                                       onClear,
                                       onBook,
                                   }: Props) {
    const { t, language } = useI18n();

    const tx = (key: string, fallback: string) => {
        const value = t(key);
        return !value || value === key ? fallback : value;
    };

    return (
        <>
            {isOpen && (
                <button
                    type="button"
                    className="cart-drawer__backdrop"
                    onClick={onClose}
                    aria-label={tx('cart.close', 'Закрити кошик')}
                />
            )}

            <aside className={`cart-drawer ${isOpen ? 'is-open' : ''}`}>
                <div className="cart-drawer__header">
                    <div>
                        <h2>{tx('cart.title', 'Кошик')}</h2>
                        <p>
                            {items.length
                                ? tx('cart.selectedServices', 'Обрані послуги для запису')
                                : tx('cart.empty', 'Кошик порожній')}
                        </p>
                    </div>

                    <button type="button" className="cart-drawer__close" onClick={onClose}>
                        ✕
                    </button>
                </div>

                <div className="cart-drawer__body">
                    {items.length === 0 ? (
                        <div className="cart-drawer__empty">
                            {tx('cart.addFromHome', 'Додайте послуги на головній сторінці.')}
                        </div>
                    ) : (
                        <div className="cart-drawer__list">
                            {items.map((item) => {
                                const serviceName = parseDbI18nValue(item.name, language);
                                const categoryName = parseDbI18nValue(item.categoryName, language);

                                return (
                                    <div key={item.serviceId} className="cart-drawer__item">
                                        <div className="cart-drawer__item-main">
                                            <strong>{serviceName || tx('cart.service', 'Послуга')}</strong>

                                            {categoryName ? (
                                                <p>
                                                    {tx('cart.category', 'Категорія')}: {categoryName}
                                                </p>
                                            ) : null}

                                            <p>
                                                {item.durationMinutes} {tx('cart.minutes', 'хв')} · {item.priceUah} грн
                                            </p>
                                        </div>

                                        <div className="cart-drawer__item-actions">
                                            <button
                                                type="button"
                                                className="cart-drawer__remove"
                                                onClick={() => onRemove(item.serviceId)}
                                            >
                                                {tx('cart.remove', 'Видалити')}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="cart-drawer__footer">
                    <div className="cart-drawer__summary">
                        <span>{tx('cart.total', 'Разом')}:</span>
                        <strong>{totalUah} грн</strong>
                    </div>

                    <div className="cart-drawer__actions">
                        <button type="button" onClick={onClear} disabled={!items.length}>
                            {tx('cart.clear', 'Очистити')}
                        </button>
                        <button type="button" onClick={onBook} disabled={!items.length}>
                            {tx('cart.toBooking', 'До запису')}
                        </button>
                    </div>
                </div>
            </aside>
        </>
    );
}