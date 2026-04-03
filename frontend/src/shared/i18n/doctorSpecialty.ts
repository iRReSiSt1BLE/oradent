import type { AppLanguage } from './translations';

export type DoctorSpecialtyLocalized = {
    ua: string;
    en: string;
    de: string;
    fr: string;
};

type StoredPayload = {
    type: 'doctorSpecialtyI18n';
    v: 1;
    data: DoctorSpecialtyLocalized;
};

const PREFIX = '__ORADENT_SPECIALTY_I18N__:';

export function emptyDoctorSpecialtyLocalized(): DoctorSpecialtyLocalized {
    return { ua: '', en: '', de: '', fr: '' };
}

function decodeJsonStringValue(value: string): string {
    try {
        return JSON.parse(`"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`) as string;
    } catch {
        return value;
    }
}

function extractField(raw: string, key: keyof DoctorSpecialtyLocalized): string {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"])*)"`, 'i'));
    if (!match?.[1]) return '';
    return decodeJsonStringValue(match[1]);
}

function parseBrokenPayload(raw: string): DoctorSpecialtyLocalized | null {
    const jsonStart = raw.indexOf('{');
    if (jsonStart >= 0) {
        const maybeJson = raw.slice(jsonStart);
        try {
            const parsed = JSON.parse(maybeJson) as StoredPayload;
            if (parsed?.type === 'doctorSpecialtyI18n' && parsed?.v === 1 && parsed?.data) {
                const data = parsed.data as DoctorSpecialtyLocalized;
                return {
                    ua: data.ua || '',
                    en: data.en || '',
                    de: data.de || '',
                    fr: data.fr || '',
                };
            }
        } catch {
        }
    }

    const recovered: DoctorSpecialtyLocalized = {
        ua: extractField(raw, 'ua'),
        en: extractField(raw, 'en'),
        de: extractField(raw, 'de'),
        fr: extractField(raw, 'fr'),
    };

    if (recovered.ua || recovered.en || recovered.de || recovered.fr) return recovered;
    return null;
}

export function serializeDoctorSpecialtyLocalized(value: DoctorSpecialtyLocalized): string {
    const payload: StoredPayload = {
        type: 'doctorSpecialtyI18n',
        v: 1,
        data: {
            ua: value.ua || '',
            en: value.en || '',
            de: value.de || '',
            fr: value.fr || '',
        },
    };

    return `${PREFIX}${JSON.stringify(payload)}`;
}

export function parseDoctorSpecialtyLocalized(raw: string | null | undefined): DoctorSpecialtyLocalized {
    if (!raw) return emptyDoctorSpecialtyLocalized();

    if (!raw.includes('__ORADENT_SPECIALTY_I18N__')) {
        return { ua: raw, en: '', de: '', fr: '' };
    }

    const normalized = raw.startsWith(PREFIX) ? raw : raw.replace(/^__ORADENT_SPECIALTY_I18N__\s*\.?\s*:\s*/, PREFIX);

    try {
        const parsed = JSON.parse(normalized.slice(PREFIX.length)) as StoredPayload;
        if (parsed?.type !== 'doctorSpecialtyI18n' || parsed?.v !== 1 || !parsed?.data) {
            const recovered = parseBrokenPayload(raw);
            return recovered ?? emptyDoctorSpecialtyLocalized();
        }

        const data = parsed.data as DoctorSpecialtyLocalized;
        return {
            ua: data.ua || '',
            en: data.en || '',
            de: data.de || '',
            fr: data.fr || '',
        };
    } catch {
        const recovered = parseBrokenPayload(raw);
        return recovered ?? emptyDoctorSpecialtyLocalized();
    }
}

export function pickDoctorSpecialtyByLanguage(raw: string | null | undefined, lang: AppLanguage): string {
    const parsed = parseDoctorSpecialtyLocalized(raw);
    if (parsed[lang]?.trim()) return parsed[lang];
    if (parsed.ua?.trim()) return parsed.ua;
    if (parsed.en?.trim()) return parsed.en;
    if (parsed.de?.trim()) return parsed.de;
    if (parsed.fr?.trim()) return parsed.fr;
    return '';
}
