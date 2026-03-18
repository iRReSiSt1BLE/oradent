const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export async function uploadVideo(formData: FormData) {
    const response = await fetch(`${API_BASE_URL}/video/upload`, {
        method: 'POST',
        body: formData,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        const message =
            data?.message ||
            data?.error ||
            'Не вдалося завантажити відео';
        throw new Error(message);
    }

    return data;
}

export async function getAllVideos() {
    const response = await fetch(`${API_BASE_URL}/video`);

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        const message =
            data?.message ||
            data?.error ||
            'Не вдалося отримати список відео';
        throw new Error(message);
    }

    return data;
}