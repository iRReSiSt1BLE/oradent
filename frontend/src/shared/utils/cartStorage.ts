import type { ClinicService } from '../api/servicesApi';

export type CartItem = {
    cartItemId: string;
    serviceId: string;
    name: string;
    priceUah: number;
    durationMinutes: number;
    categoryId: string;
    categoryName: string | null;
    specialtyIds: string[];
    specialtyNames: string[];
    requiredServiceIds: string[];
    prerequisiteServiceIds: string[];
    prerequisiteServiceNames: string[];
    minIntervalDays: number | null;
    maxIntervalDays: number | null;
    allowMultipleInCart: boolean;
    maxCartQuantity: number | null;
    quantity: number;
    isAutoAdded: boolean;
};

export type AddToCartResult = {
    items: CartItem[];
    addedServiceIds: string[];
    blockedReason: 'single' | 'maxQuantity' | null;
};

export type BookingCartItem = CartItem & {
    cartLineId: string;
    quantityIndex: number;
};

const CART_STORAGE_KEY = 'oradent_cart_v4';

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

        if ('name' in raw) {
            return parseDbI18nValue(raw.name);
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

function createCartItemId(serviceId: string): string {
    return `${serviceId}__${Date.now()}__${Math.random().toString(36).slice(2, 8)}`;
}

function mapServiceToCartItem(
    service: ClinicService,
    catalog: ClinicService[],
    options?: { isAutoAdded?: boolean; quantity?: number },
): CartItem {
    const prerequisites = (service.prerequisiteServiceIds || [])
        .map((id) => catalog.find((item) => item.id === id) || null)
        .filter(Boolean) as ClinicService[];

    return {
        cartItemId: createCartItemId(service.id),
        serviceId: service.id,
        name: service.name,
        priceUah: Number(service.priceUah),
        durationMinutes: service.durationMinutes,
        categoryId: service.categoryId,
        categoryName: service.category?.name ?? null,
        specialtyIds: service.specialtyIds ?? [],
        specialtyNames: Array.isArray(service.specialties)
            ? service.specialties.map((s: any) => s?.name || '')
            : [],
        requiredServiceIds: service.requiredServiceIds ?? [],
        prerequisiteServiceIds: service.prerequisiteServiceIds ?? [],
        prerequisiteServiceNames: prerequisites.map((item) => parseDbI18nValue(item.name)),
        minIntervalDays: service.minIntervalDays ?? null,
        maxIntervalDays: service.maxIntervalDays ?? null,
        allowMultipleInCart: Boolean(service.allowMultipleInCart),
        maxCartQuantity: service.maxCartQuantity ?? null,
        quantity: options?.quantity ?? 1,
        isAutoAdded: Boolean(options?.isAutoAdded),
    };
}

function getDependencyIds(item: CartItem) {
    return [...(item.requiredServiceIds || []), ...(item.prerequisiteServiceIds || [])];
}

function sortCartItems(items: CartItem[]): CartItem[] {
    const map = new Map(items.map((item) => [item.cartItemId, item]));
    const firstByServiceId = new Map<string, string>();

    items.forEach((item) => {
        if (!firstByServiceId.has(item.serviceId)) {
            firstByServiceId.set(item.serviceId, item.cartItemId);
        }
    });

    const visited = new Set<string>();
    const stack = new Set<string>();
    const result: CartItem[] = [];

    const visit = (cartItemId: string) => {
        if (visited.has(cartItemId) || stack.has(cartItemId)) return;
        const item = map.get(cartItemId);
        if (!item) return;

        stack.add(cartItemId);

        getDependencyIds(item).forEach((serviceId) => {
            const dependencyId = firstByServiceId.get(serviceId);
            if (dependencyId) visit(dependencyId);
        });

        stack.delete(cartItemId);
        visited.add(cartItemId);
        result.push(item);
    };

    items.forEach((item) => visit(item.cartItemId));
    return result;
}

export function getCart(): CartItem[] {
    if (!isBrowser()) return [];

    try {
        const raw = window.localStorage.getItem(CART_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed : [];
        return sortCartItems(items);
    } catch {
        return [];
    }
}

export function saveCart(items: CartItem[]): void {
    if (!isBrowser()) return;
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(sortCartItems(items)));
    window.dispatchEvent(new CustomEvent('oradent-cart-changed'));
}

export function clearCart(): void {
    saveCart([]);
}

function getExistingItem(items: CartItem[], serviceId: string) {
    return items.find((item) => item.serviceId === serviceId) || null;
}

export function addServiceToCartWithRules(service: ClinicService, catalog: ClinicService[]): AddToCartResult {
    const current = getCart();
    const catalogMap = new Map(catalog.map((item) => [item.id, item]));
    const next = [...current];
    const addedServiceIds: string[] = [];

    const existing = getExistingItem(next, service.id);
    if (existing) {
        if (!service.allowMultipleInCart) {
            return { items: next, addedServiceIds: [], blockedReason: 'single' };
        }

        const currentQty = existing.quantity || 1;
        const maxQty = service.maxCartQuantity ?? null;
        if (maxQty !== null && currentQty >= maxQty) {
            return { items: next, addedServiceIds: [], blockedReason: 'maxQuantity' };
        }

        existing.quantity = currentQty + 1;
        saveCart(next);
        return { items: sortCartItems(next), addedServiceIds: [service.id], blockedReason: null };
    }

    const ensureDependency = (serviceId: string) => {
        if (getExistingItem(next, serviceId)) return;
        const target = catalogMap.get(serviceId);
        if (!target) return;

        (target.prerequisiteServiceIds || []).forEach(ensureDependency);
        (target.requiredServiceIds || []).forEach(ensureDependency);

        next.push(mapServiceToCartItem(target, catalog, { isAutoAdded: true }));
        addedServiceIds.push(serviceId);
    };

    (service.prerequisiteServiceIds || []).forEach(ensureDependency);
    (service.requiredServiceIds || []).forEach(ensureDependency);

    next.push(mapServiceToCartItem(service, catalog));
    addedServiceIds.push(service.id);

    const sorted = sortCartItems(next);
    saveCart(sorted);

    return {
        items: sorted,
        addedServiceIds,
        blockedReason: null,
    };
}

export function removeServiceFromCart(cartItemId: string): CartItem[] {
    const current = getCart();
    const target = current.find((item) => item.cartItemId === cartItemId) || current.find((item) => item.serviceId === cartItemId);
    if (!target) return current;

    const next = current
        .map((item) => {
            if (item.cartItemId !== target.cartItemId) return item;
            if ((item.quantity || 1) > 1) {
                return { ...item, quantity: (item.quantity || 1) - 1 };
            }
            return null;
        })
        .filter(Boolean) as CartItem[];

    saveCart(next);
    return next;
}


export function setCartItemQuantity(cartItemId: string, quantity: number): CartItem[] {
    const current = getCart();
    const target = current.find((item) => item.cartItemId === cartItemId) || current.find((item) => item.serviceId === cartItemId);
    if (!target) return current;

    const normalizedQuantity = Math.floor(Number(quantity));

    const next = current
        .map((item) => {
            if (item.cartItemId !== target.cartItemId) return item;
            if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) return null;

            const minQuantity = 1;
            const maxQuantity = item.allowMultipleInCart
                ? item.maxCartQuantity ?? 99
                : 1;

            return {
                ...item,
                quantity: Math.min(maxQuantity, Math.max(minQuantity, normalizedQuantity)),
            };
        })
        .filter(Boolean) as CartItem[];

    saveCart(next);
    return next;
}

export function getDependentServiceNames(cartItemId: string): string[] {
    const current = getCart();
    const target = current.find((item) => item.cartItemId === cartItemId) || current.find((item) => item.serviceId === cartItemId);
    if (!target) return [];

    return current
        .filter((item) => item.cartItemId !== cartItemId)
        .filter((item) => getDependencyIds(item).includes(target.serviceId))
        .map((item) => parseDbI18nValue(item.name));
}

export function getCartCount(): number {
    return getCart().reduce((sum, item) => sum + (item.quantity || 1), 0);
}

export function getCartTotalUah(): number {
    return getCart().reduce((sum, item) => sum + item.priceUah * (item.quantity || 1), 0);
}

export function expandCartItemsForBooking(items: CartItem[]): BookingCartItem[] {
    return items.flatMap((item) => {
        const quantity = Math.max(1, Number(item.quantity || 1));
        return Array.from({ length: quantity }, (_, index) => ({
            ...item,
            cartLineId: `${item.cartItemId}__${index + 1}`,
            quantityIndex: index + 1,
        }));
    });
}
