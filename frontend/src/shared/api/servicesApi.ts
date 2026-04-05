import { http } from './http';

export type ServiceSpecialty = {
    id: string;
    name: string;
    order?: number;
    isActive?: boolean;
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
    sortOrder: number;
    priceUah: number;
    isActive: boolean;
    categoryId: string;
    category: ServiceCategory | null;
    specialtyIds: string[];
    specialties: ServiceSpecialty[];
    createdAt: string;
    updatedAt: string;
};

export async function getAdminServices(token: string) {
    return http<{ ok: boolean; services: ClinicService[] }>('/services', {
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
    return http<{ ok: boolean; message: string; category: ServiceCategory }>(
        `/services/categories/${categoryId}`,
    {
        method: 'PATCH',
            token,
            body: JSON.stringify(payload),
    },
);
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

export async function getSpecialtiesOptions(token: string) {
    return http<{ ok: boolean; specialties: ServiceSpecialty[] }>('/services/specialties/options', {
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
        sortOrder?: number;
        priceUah: number;
        categoryId: string;
        isActive?: boolean;
        specialtyIds?: string[];
    },
) {
    return http<{ ok: boolean; message: string; service: ClinicService }>(
        '/services',
        {
            method: 'POST',
            token,
            body: JSON.stringify({
                name: payload.name,
                description: payload.description,
                durationMinutes: payload.durationMinutes,
                sortOrder: payload.sortOrder,
                priceUah: String(payload.priceUah),
                categoryId: payload.categoryId,
                isActive: payload.isActive,
                specialtyIds: payload.specialtyIds ?? [],
            }),
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
        sortOrder?: number;
        priceUah?: number;
        categoryId?: string;
        isActive?: boolean;
        specialtyIds?: string[];
    },
) {
    return http<{ ok: boolean; message: string; service: ClinicService }>(
        `/services/${serviceId}`,
    {
        method: 'PATCH',
            token,
            body: JSON.stringify({
        name: payload.name,
        description: payload.description,
        durationMinutes: payload.durationMinutes,
        sortOrder: payload.sortOrder,
        ...(payload.priceUah !== undefined ? { priceUah: String(payload.priceUah) } : {}),
        categoryId: payload.categoryId,
        isActive: payload.isActive,
        specialtyIds: payload.specialtyIds,
    }),
    },
);
}

export async function toggleServiceActive(token: string, serviceId: string) {
    return http<{ ok: boolean; message: string; service: ClinicService }>(
        `/services/${serviceId}/toggle-active`,
    {
        method: 'PATCH',
            token,
    },
);
}

export async function getPublicCatalog() {
    return http<{
        ok: boolean;
        categories: Array<ServiceCategory & { services: ClinicService[] }>;
    }>('/services/public/catalog', {
        method: 'GET',
    });
}

export async function getPublicServiceById(serviceId: string) {
    return http<{ ok: boolean; service: ClinicService }>(`/services/public/${serviceId}`, {
    method: 'GET',
});
}

export async function getActivePublicServices() {
    return http<{ ok: boolean; services: ClinicService[] }>('/services/public/active', {
        method: 'GET',
    });
}