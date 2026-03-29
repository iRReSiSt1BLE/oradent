import { http } from './http';

export type ServiceDoctor = {
    id: string;
    email: string;
    fullName?: string;
    lastName?: string;
    firstName?: string;
    middleName?: string | null;
    hasAvatar?: boolean;
    avatarVersion?: number;
};

export type ServiceDoctorOption = {
    id: string;
    email: string;
    fullName?: string;
    hasAvatar?: boolean;
    avatarVersion?: number;
};

export type ServiceCategory = {
    id: string;
    name: string;
    description: string | null;
    sortOrder: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
};

export type ClinicService = {
    id: string;
    name: string;
    description: string | null;
    durationMinutes: number;
    priceUsd: number;
    priceUah: number;
    usdBuyRate: number;
    priceUpdatedAt: string;
    isActive: boolean;
    categoryId: string;
    category: ServiceCategory | null;
    doctorIds: string[];
    doctors: ServiceDoctor[];
    createdAt: string;
    updatedAt: string;
};

export type PricingMeta = {
    usdBuyRate: number;
    source: 'live' | 'cache' | 'fallback';
    roundedTo: number;
    currency: string;
};

export async function getPricingMeta(token: string) {
    return http<{ ok: boolean; pricing: PricingMeta }>('/services/pricing/meta', {
        method: 'GET',
        token,
    });
}

export async function getAdminServices(token: string) {
    return http<{ ok: boolean; services: ClinicService[]; pricing: PricingMeta }>('/services', {
        method: 'GET',
        token,
    });
}

export async function getAdminCategories(token: string) {
    return http<{ ok: boolean; categories: ServiceCategory[] }>('/services/categories', {
        method: 'GET',
        token,
    });
}

export async function createServiceCategory(
    token: string,
    payload: {
        name: string;
        description?: string;
        sortOrder?: number;
        isActive?: boolean;
    },
) {
    return http<{ ok: boolean; message: string; category: ServiceCategory }>('/services/categories', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });
}

export async function updateServiceCategory(
    token: string,
    categoryId: string,
    payload: {
        name?: string;
        description?: string;
        sortOrder?: number;
        isActive?: boolean;
    },
) {
    return http<{ ok: boolean; message: string; category: ServiceCategory }>(`/services/categories/${categoryId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(payload),
    });
}

export async function toggleCategoryActive(token: string, categoryId: string) {
    return http<{ ok: boolean; message: string; category: ServiceCategory }>(
        `/services/categories/${categoryId}/toggle-active`,
        {
            method: 'PATCH',
            token,
        },
    );
}

export async function getDoctorsOptions(token: string) {
    return http<{ ok: boolean; doctors: ServiceDoctorOption[] }>('/services/doctors/options', {
        method: 'GET',
        token,
    });
}

export async function createService(
    token: string,
    payload: {
        name: string;
        description?: string;
        durationMinutes: number;
        priceUsd: number;
        categoryId: string;
        isActive?: boolean;
        doctorIds?: string[];
    },
) {
    return http<{ ok: boolean; message: string; service: ClinicService; pricing: { source: string; roundedTo: number } }>(
        '/services',
        {
            method: 'POST',
            token,
            body: JSON.stringify(payload),
        },
    );
}

export async function updateService(
    token: string,
    serviceId: string,
    payload: {
        name?: string;
        description?: string;
        durationMinutes?: number;
        priceUsd?: number;
        categoryId?: string;
        isActive?: boolean;
        doctorIds?: string[];
    },
) {
    return http<{ ok: boolean; message: string; service: ClinicService }>(`/services/${serviceId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(payload),
    });
}

export async function toggleServiceActive(token: string, serviceId: string) {
    return http<{ ok: boolean; message: string; service: ClinicService }>(`/services/${serviceId}/toggle-active`, {
        method: 'PATCH',
        token,
    });
}

export async function refreshServicesPricing(token: string) {
    return http<{ ok: boolean; message: string; pricing: PricingMeta }>('/services/reprice', {
        method: 'POST',
        token,
    });
}

export async function getPublicCatalog() {
    return http<{
        ok: boolean;
        categories: Array<ServiceCategory & { services: ClinicService[] }>;
        pricing: PricingMeta;
    }>('/services/public/catalog', {
        method: 'GET',
    });
}

export async function getPublicServiceById(serviceId: string) {
    return http<{ ok: boolean; service: ClinicService; pricing: PricingMeta }>(`/services/public/${serviceId}`, {
        method: 'GET',
    });
}

export async function getActivePublicServices() {
    return http<{ ok: boolean; services: ClinicService[] }>('/services/public/active', {
        method: 'GET',
    });
}
