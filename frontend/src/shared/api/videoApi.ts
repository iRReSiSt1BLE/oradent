const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export type VideoRecord = {
    id: string;
    appointmentId: string | null;
    originalFileName: string;
    storedFileName: string;
    storageRelativePath: string;
    mimeType: string;
    size: number;
    startedAt: string | null;
    endedAt: string | null;
    sha256Hash: string | null;
    manifestRelativePath: string | null;
    manifestSignature: string | null;
    signatureAlgorithm: string | null;
    tsaRequestRelativePath: string | null;
    tsaResponseRelativePath: string | null;
    tsaProvider: string | null;
    tsaHashAlgorithm: string | null;
    encryptionAlgorithm: string | null;
    encryptionIv: string | null;
    encryptionAuthTag: string | null;
    encryptedAt: string | null;
    createdAt: string;
};

export type UploadVideoResponse = {
    ok: boolean;
    message: string;
    data: VideoRecord;
};

export type GetAllVideosResponse = {
    ok: boolean;
    data: VideoRecord[];
};

export async function uploadVideo(
    token: string,
    formData: FormData,
): Promise<UploadVideoResponse> {
    const response = await fetch(`${API_BASE_URL}/video/upload`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
        },
        body: formData,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        const message =
            data?.message ||
            data?.error ||
            'Не вдалося завантажити відео';
        throw new Error(Array.isArray(message) ? message.join(', ') : message);
    }

    return data as UploadVideoResponse;
}

export async function getAllVideos(token: string): Promise<GetAllVideosResponse> {
    const response = await fetch(`${API_BASE_URL}/video`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        const message =
            data?.message ||
            data?.error ||
            'Не вдалося отримати список відео';
        throw new Error(Array.isArray(message) ? message.join(', ') : message);
    }

    return data as GetAllVideosResponse;
}

export async function getVideosByAppointment(
    token: string,
    appointmentId: string,
): Promise<GetAllVideosResponse> {
    const response = await fetch(
        `${API_BASE_URL}/video/appointment/${appointmentId}`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        },
    );

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        const message =
            data?.message ||
            data?.error ||
            'Не вдалося отримати відео прийому';
        throw new Error(Array.isArray(message) ? message.join(', ') : message);
    }

    return data as GetAllVideosResponse;
}

export async function streamVideoWithPassword(
    token: string,
    videoId: string,
    password: string,
): Promise<Blob> {
    const response = await fetch(`${API_BASE_URL}/video/${videoId}/stream-auth`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password }),
    });

    if (!response.ok) {
        let message = 'Не вдалося розшифрувати відео';
        try {
            const data = await response.json();
            if (data?.message) {
                message = Array.isArray(data.message)
                    ? data.message.join(', ')
                    : data.message;
            }
        } catch {}
        throw new Error(message);
    }

    return response.blob();
}
