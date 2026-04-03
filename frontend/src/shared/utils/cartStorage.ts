import type { ClinicService } from '../api/servicesApi';

export type CartItem = {
    serviceId: string;
    name: string;
    priceUah: number;
    durationMinutes: number;
    categoryId: string;
    categoryName: string | null;
    specialtyIds: string[];
    specialtyNames: string[];
};

const CART_STORAGE_KEY = 'oradent_cart_v3';

function isBrowser(): boolean {
    return typeof window !== 'undefined';
}

export function getCart(): CartItem[] {
    if (!isBrowser()) return [];

    try {
        const raw = window.localStorage.getItem(CART_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function saveCart(items: CartItem[]): void {
    if (!isBrowser()) return;
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('oradent-cart-changed'));
}

export function clearCart(): void {
    saveCart([]);
}

export function addServiceToCart(service: ClinicService): CartItem[] {
    const current = getCart();

    const alreadyExists = current.some((item) => item.serviceId === service.id);
    if (alreadyExists) {
        return current;
    }

    const nextItem: CartItem = {
        serviceId: service.id,
        name: service.name,
        priceUah: Number(service.priceUah),
        durationMinutes: service.durationMinutes,
        categoryId: service.categoryId,
        categoryName: service.category?.name ?? null,
        specialtyIds: service.specialtyIds ?? [],
        specialtyNames: Array.isArray(service.specialties)
            ? service.specialties.map((s: any) => {
                if (s?.nameI18n) {
                    return s.nameI18n.ua || s.nameI18n.en || s.nameI18n.de || s.nameI18n.fr || s.name;
                }
                return s.name;
            })
            : [],
    };

    const next = [...current, nextItem];
    saveCart(next);
    return next;
}

export function removeServiceFromCart(serviceId: string): CartItem[] {
    const current = getCart();
    const next = current.filter((item) => item.serviceId !== serviceId);
    saveCart(next);
    return next;
}

export function getCartCount(): number {
    return getCart().length;
}

export function getCartTotalUah(): number {
    return getCart().reduce((sum, item) => sum + item.priceUah, 0);
}