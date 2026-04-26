import { Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import Header from './widgets/Header/Header';
import CartDrawer from './widgets/CartDrawer/CartDrawer.tsx';
import {
    clearCart,
    getCart,
    getCartCount,
    getCartTotalUah,
    removeServiceFromCart,
    setCartItemQuantity,
    getDependentServiceNames,
    type CartItem,
} from './shared/cart/cartStore';
import './App.scss';
import { useI18n } from './shared/i18n/I18nProvider';

export default function App() {
    const navigate = useNavigate();
    const { t } = useI18n();

    const [isCartOpen, setIsCartOpen] = useState(false);
    const [cartItems, setCartItems] = useState<CartItem[]>([]);

    function syncCart() {
        setCartItems(getCart());
    }

    useEffect(() => {
        syncCart();

        const handleCartChange = () => {
            syncCart();
        };

        window.addEventListener('oradent-cart-changed', handleCartChange);

        return () => {
            window.removeEventListener('oradent-cart-changed', handleCartChange);
        };
    }, []);

    const cartCount = useMemo(() => getCartCount(), [cartItems]);
    const cartTotalUah = useMemo(() => getCartTotalUah(), [cartItems]);

    function handleRemove(cartItemId: string) {
        const dependentNames = getDependentServiceNames(cartItemId);
        if (dependentNames.length) {
            const message = `${t('cart.dependencyRemoveWarning')}

${dependentNames.join(', ')}`;
            if (!window.confirm(message)) return;
        }

        removeServiceFromCart(cartItemId);
        syncCart();
    }

    function handleClear() {
        clearCart();
        syncCart();
    }

    function handleQuantityChange(cartItemId: string, quantity: number) {
        setCartItemQuantity(cartItemId, quantity);
        syncCart();
    }

    function handleBook() {
        setIsCartOpen(false);

        navigate('/smart-appointment');
    }

    return (
        <>
            <Header
                cartCount={cartCount}
                onOpenCart={() => setIsCartOpen(true)}
            />

            <Outlet />

            <CartDrawer
                isOpen={isCartOpen}
                items={cartItems}
                totalUah={cartTotalUah}
                onClose={() => setIsCartOpen(false)}
                onRemove={handleRemove}
                onQuantityChange={handleQuantityChange}
                onClear={handleClear}
                onBook={handleBook}
            />
        </>
    );
}