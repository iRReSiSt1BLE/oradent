export function normalizePhone(phone: string): string {
    if (!phone) return '';

    // залишаємо тільки цифри
    let normalized = phone.replace(/\D/g, '');

    // якщо номер починається з 0 → додаємо код країни
    if (normalized.startsWith('0')) {
        normalized = '38' + normalized;
    }

    // якщо вже починається з 380 → норм
    if (normalized.startsWith('380')) {
        return normalized;
    }

    // якщо починається з 80 (рідкі випадки)
    if (normalized.startsWith('80')) {
        return '3' + normalized;
    }

    return normalized;
}