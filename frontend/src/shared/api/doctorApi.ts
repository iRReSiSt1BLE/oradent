import { http } from './http';

const API_BASE_URL = 'http://localhost:3000';

export type DoctorSpecialtyItem = {
    id: string;
    name: string;
    nameI18n?: {
        ua?: string;
        en?: string;
        de?: string;
        fr?: string;
    };
    order: number;
};

export type DoctorItem = {
    id: string;
    userId: string;
    email: string;
    lastName: string;
    firstName: string;
    middleName: string | null;
    specialty: string | null;
    specialties: string[];
    infoBlock: string | null;
    phone: string;
    isActive: boolean;
    hasAvatar: boolean;
    avatarVersion: number;
    avatar: {
        sm: string;
        md: string;
        lg: string;
    } | null;
};


export type PublicDoctorItem = {
    id: string;
    userId: string;
    lastName: string;
    firstName: string;
    middleName: string | null;
    specialty: string | null;
    specialtyI18n?: {
        ua?: string;
        en?: string;
        de?: string;
        fr?: string;
    };
    specialties: Array<{
        value: string;
        i18n?: {
            ua?: string;
            en?: string;
            de?: string;
            fr?: string;
        };
    }>;
    infoBlock: string | null;
    infoBlockI18n?: {
        ua?: string;
        en?: string;
        de?: string;
        fr?: string;
    };
    hasAvatar: boolean;
    avatarVersion: number;
    avatar: {
        sm: string;
        md: string;
        lg: string;
    } | null;
};

export type PublicDoctorReviewItem = {
    appointmentId: string;
    rating: number;
    text: string;
    anonymous: boolean;
    authorName: string;
    createdAt: string;
};

export type PublicDoctorDetailsResponse = {
    ok: boolean;
    doctor: PublicDoctorItem & {
        reviews: PublicDoctorReviewItem[];
        reviewsCount: number;
        averageRating: number;
    };
};

export async function getDoctorSpecialties(token: string | null) {
    return http<{ ok: boolean; specialties: DoctorSpecialtyItem[] }>('/doctors/specialties', {
        method: 'GET',
        token,
    });
}

export async function createDoctorSpecialty(token: string, name: string) {
    return http<{ ok: boolean; specialty: DoctorSpecialtyItem }>('/doctors/specialties', {
        method: 'POST',
        token,
        body: JSON.stringify({ name }),
    });
}

export async function updateDoctorSpecialty(token: string, specialtyId: string, name: string) {
    return http<{ ok: boolean; specialty: DoctorSpecialtyItem }>(`/doctors/specialties/${specialtyId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ name }),
    });
}

export async function deleteDoctorSpecialty(token: string, specialtyId: string) {
    return http<{ ok: boolean; message?: string }>(`/doctors/specialties/${specialtyId}`, {
        method: 'DELETE',
        token,
    });
}

export async function getPublicDoctors() {
    return http<{ ok: boolean; doctors: PublicDoctorItem[] }>('/doctors/public', {
        method: 'GET',
    });
}

export async function getPublicDoctorById(doctorId: string) {
    return http<PublicDoctorDetailsResponse>(`/doctors/public/${doctorId}`, {
        method: 'GET',
    });
}

export async function getAllDoctors(token: string) {
    return http<{ ok: boolean; doctors: DoctorItem[] }>('/doctors', {
        method: 'GET',
        token,
    });
}

export async function getDoctorById(token: string, doctorId: string) {
    return http<{ ok: boolean; doctor: DoctorItem }>(`/doctors/${doctorId}`, {
        method: 'GET',
        token,
    });
}

export async function requestDoctorEmailVerification(token: string, email: string) {
    return http<{ ok: boolean; message: string }>('/doctors/request-email-verification', {
        method: 'POST',
        token,
        body: JSON.stringify({ email }),
    });
}

export async function createDoctor(
    token: string,
    payload: {
        lastName: string;
        firstName: string;
        middleName?: string;
        specialties: string[];
        infoBlock?: string;
        phone: string;
        email: string;
        password: string;
        emailCode?: string;
        phoneVerificationSessionId?: string;
    },
) {
    return http<{ ok: boolean; message: string; doctor: DoctorItem }>('/doctors', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });
}

export async function updateDoctor(
    token: string,
    doctorId: string,
    payload: {
        lastName?: string;
        firstName?: string;
        middleName?: string;
        specialties?: string[];
        infoBlock?: string;
        email?: string;
        phone?: string;
        emailCode?: string;
        phoneVerificationSessionId?: string;
        actorPassword: string;
    },
) {
    return http<{ ok: boolean; message: string; doctor: DoctorItem }>(`/doctors/${doctorId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(payload),
    });
}

export async function toggleDoctorActive(token: string, doctorId: string) {
    return http<{ ok: boolean; message: string; isActive: boolean }>(`/doctors/${doctorId}/toggle-active`, {
        method: 'PATCH',
        token,
    });
}

export async function uploadDoctorAvatar(token: string, doctorId: string, file: File) {
    const body = new FormData();
    body.append('avatar', file);

    return http<{ ok: boolean; message: string; doctor: DoctorItem }>(`/doctors/${doctorId}/avatar`, {
        method: 'POST',
        token,
        body,
    });
}

export async function removeDoctorAvatar(token: string, doctorId: string) {
    return http<{ ok: boolean; message: string; doctor: DoctorItem }>(`/doctors/${doctorId}/avatar`, {
        method: 'DELETE',
        token,
    });
}

export function buildDoctorAvatarUrl(doctorId: string, size: 'sm' | 'md' | 'lg', version?: number) {
    const suffix = version ? `&v=${version}` : '';
    return `${API_BASE_URL}/doctors/${doctorId}/avatar?size=${size}${suffix}`;
}
