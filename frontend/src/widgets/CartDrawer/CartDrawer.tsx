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

export default function CartDrawer({
                                       isOpen,
                                       items,
                                       totalUah,
                                       onClose,
                                       onRemove,
                                       onClear,
                                       onBook,
                                   }: Props) {
    const { t } = useI18n();

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
                            {items.map((item) => (
                                <div key={item.serviceId} className="cart-drawer__item">
                                    <div className="cart-drawer__item-main">
                                        <strong>{item.name}</strong>

                                        {item.categoryName && (
                                            <p>
                                                {tx('cart.category', 'Категорія')}: {item.categoryName}
                                            </p>
                                        )}

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
                            ))}
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