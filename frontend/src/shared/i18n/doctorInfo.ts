import type { AppLanguage } from './translations';

export type DoctorInfoLocalized = {
    ua: string;
    en: string;
    de: string;
    fr: string;
};

type StoredPayload = {
    type: 'doctorInfoI18n';
    v: 1;
    data: DoctorInfoLocalized;
};

const PREFIX = '__ORADENT_I18N__:';

export function emptyDoctorInfoLocalized(): DoctorInfoLocalized {
    return { ua: '', en: '', de: '', fr: '' };
}

export function serializeDoctorInfoLocalized(value: DoctorInfoLocalized): string {
    const payload: StoredPayload = {
        type: 'doctorInfoI18n',
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

export function parseDoctorInfoLocalized(raw: string | null | undefined): DoctorInfoLocalized {
    if (!raw) return emptyDoctorInfoLocalized();

    if (!raw.startsWith(PREFIX)) {
        return { ua: raw, en: '', de: '', fr: '' };
    }

    try {
        const parsed = JSON.parse(raw.slice(PREFIX.length)) as StoredPayload;
        if (parsed?.type !== 'doctorInfoI18n' || parsed?.v !== 1 || !parsed?.data) {
            return { ua: raw, en: '', de: '', fr: '' };
        }

        const data = parsed.data as DoctorInfoLocalized;

        return {
            ua: data.ua || '',
            en: data.en || '',
            de: data.de || '',
            fr: data.fr || '',
        };
    } catch {
        return { ua: raw, en: '', de: '', fr: '' };
    }
}

export function pickDoctorInfoByLanguage(raw: string | null | undefined, lang: AppLanguage): string {
    const parsed = parseDoctorInfoLocalized(raw);
    if (parsed[lang]?.trim()) return parsed[lang];
    if (parsed.ua?.trim()) return parsed.ua;
    if (parsed.en?.trim()) return parsed.en;
    if (parsed.de?.trim()) return parsed.de;
    if (parsed.fr?.trim()) return parsed.fr;
    return '';
}


