import { deTranslations } from './de/translations';
import { enTranslations } from './en/translations';
import { frTranslations } from './fr/translations';
import { uaTranslations } from './ua/translations';
import type { AppLanguage, TranslationMap } from './types';

export type { AppLanguage, TranslationMap } from './types';

export const LANGUAGE_LABEL: Record<AppLanguage, string> = {
    ua: 'UA',
    en: 'EN',
    de: 'DE',
    fr: 'FR',
};

export const translations: Record<AppLanguage, TranslationMap> = {
    ua: uaTranslations,
    en: enTranslations,
    de: deTranslations,
    fr: frTranslations,
};
