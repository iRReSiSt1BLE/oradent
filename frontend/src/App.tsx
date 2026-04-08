import { Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import Header from './widgets/Header/Header';
import CartDrawer from './widgets/CartDrawer/CartDrawer';
import {
    clearCart,
    getCart,
    getCartCount,
    getCartTotalUah,
    removeServiceFromCart,
    type CartItem,
} from './shared/cart/cartStore';
import './App.scss';

export default function App() {
    const navigate = useNavigate();

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

    function handleRemove(serviceId: string) {
        removeServiceFromCart(serviceId);
        syncCart();
    }

    function handleClear() {
        clearCart();
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
                onClear={handleClear}
                onBook={handleBook}
            />
        </>
    );
}