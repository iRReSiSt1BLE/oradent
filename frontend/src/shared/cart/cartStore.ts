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

function parseDbI18nValue(raw: any): string {
    if (!raw) return '';

    if (typeof raw === 'object' && raw !== null) {
        if ('ua' in raw || 'en' in raw || 'de' in raw || 'fr' in raw) {
            return raw.ua || raw.en || raw.de || raw.fr || '';
        }

        if ('i18n' in raw && raw.i18n) {
            const map = raw.i18n as Record<string, string>;
            return map.ua || map.en || map.de || map.fr || '';
        }

        if ('value' in raw && typeof raw.value === 'string') {
            return raw.value;
        }
    }

    if (typeof raw === 'string') {
        try {
            const start = raw.indexOf('{');
            if (start === -1) return raw;
            const parsed = JSON.parse(raw.slice(start));
            const data = parsed?.data;
            if (data && typeof data === 'object') {
                return data.ua || data.en || data.de || data.fr || raw;
            }
            return raw;
        } catch {
            return raw;
        }
    }

    return String(raw);
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
            ? service.specialties.map((s) => parseDbI18nValue((s as any).nameI18n || s.name))
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