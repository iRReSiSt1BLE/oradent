import { API_BASE_URL, http } from './http';

export type HomeContentI18n = {
    ua?: string;
    en?: string;
    de?: string;
    fr?: string;
};

export type HomeContentItem = {
    title: HomeContentI18n;
    text: HomeContentI18n;
};

export type HomeImageVariant = 'desktop' | 'tablet' | 'mobile';

export type HomeImageSlots = Record<HomeImageVariant, {
    width: number;
    height: number;
    quality: number;
}>;

export type HomeContentBlock = {
    id: string;
    key: string;
    kind: 'hero' | 'split' | 'steps' | 'intro' | 'cta' | 'footer' | string;
    sortOrder: number;
    isActive: boolean;
    eyebrow: HomeContentI18n;
    title: HomeContentI18n;
    subtitle: HomeContentI18n;
    body: HomeContentI18n;
    buttonLabel: HomeContentI18n;
    buttonHref: string;
    items: HomeContentItem[];
    imageAlt: HomeContentI18n;
    image: null | {
        version: number;
        desktop: string;
        tablet: string;
        mobile: string;
    };
    imageSlots: HomeImageSlots;
    updatedAt?: string;
};

export type HomeContentResponse = {
    ok: boolean;
    blocks: HomeContentBlock[];
};

export type UpdateHomeContentPayload = {
    blocks: Array<{
        key: string;
        isActive?: boolean;
        sortOrder?: number;
        eyebrow?: HomeContentI18n;
        title?: HomeContentI18n;
        subtitle?: HomeContentI18n;
        body?: HomeContentI18n;
        buttonLabel?: HomeContentI18n;
        buttonHref?: string;
        items?: HomeContentItem[];
        imageAlt?: HomeContentI18n;
    }>;
};

export async function getPublicHomeContent() {
    return http<HomeContentResponse>('/home-content/public', { method: 'GET' });
}

export async function getAdminHomeContent(token: string) {
    return http<HomeContentResponse>('/home-content/admin', { method: 'GET', token });
}

export async function updateHomeContentBlocks(token: string, payload: UpdateHomeContentPayload) {
    return http<HomeContentResponse>('/home-content/blocks', {
        method: 'PATCH',
        token,
        body: JSON.stringify(payload),
    });
}

export async function uploadHomeContentImage(
    token: string,
    blockKey: string,
    variant: HomeImageVariant,
    file: File,
) {
    const body = new FormData();
    body.append('image', file);

    return http<HomeContentResponse>(`/home-content/blocks/${blockKey}/image?variant=${variant}`, {
        method: 'POST',
        token,
        body,
    });
}

export async function removeHomeContentImage(
    token: string,
    blockKey: string,
    variant: HomeImageVariant,
) {
    return http<HomeContentResponse>(`/home-content/blocks/${blockKey}/image?variant=${variant}`, {
        method: 'DELETE',
        token,
    });
}

export function buildHomeContentImageUrl(blockKey: string, variant: HomeImageVariant, version?: number) {
    const suffix = version ? `&v=${version}` : '';
    return `${API_BASE_URL}/home-content/blocks/${blockKey}/image?variant=${variant}${suffix}`;
}
