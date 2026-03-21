const API_BASE_URL = 'http://localhost:3000';

type RequestOptions = RequestInit & {
    token?: string | null;
};

export async function http<T>(
    path: string,
    options: RequestOptions = {},
): Promise<T> {
    const { token, headers, ...rest } = options;

    const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
            headers: {
        ...(rest.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
        },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.message || 'Помилка запиту');
    }

    return data as T;
}