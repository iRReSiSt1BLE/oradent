export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

type RequestOptions = RequestInit & {
    token?: string | null;
};

export async function http<T>(
    path: string,
    options: RequestOptions = {},
): Promise<T> {
    const { token, headers, body, ...rest } = options;
    const normalizedBody = body && !(body instanceof FormData) && typeof body !== 'string'
        ? JSON.stringify(body)
        : body;

    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...rest,
        body: normalizedBody,
        cache: 'no-store',
        headers: {
            ...(normalizedBody instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...headers,
        },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = data?.message || data?.error || 'Помилка запиту';
        throw new Error(Array.isArray(message) ? message.join(', ') : message);
    }

    return data as T;
}
