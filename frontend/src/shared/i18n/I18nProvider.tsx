import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { translations, type AppLanguage } from './translations';

type I18nContextValue = {
    language: AppLanguage;
    setLanguage: (lang: AppLanguage) => void;
    t: (key: string) => string;
};

const STORAGE_KEY = 'oradent.language.v1';

const I18nContext = createContext<I18nContextValue | null>(null);

function getInitialLanguage(): AppLanguage {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'ua' || stored === 'en' || stored === 'de' || stored === 'fr') {
        return stored;
    }
    return 'ua';
}

export function I18nProvider({ children }: { children: ReactNode }) {
    const [language, setLanguageState] = useState<AppLanguage>(() => getInitialLanguage());

    function setLanguage(lang: AppLanguage) {
        setLanguageState(lang);
        window.localStorage.setItem(STORAGE_KEY, lang);
    }

    const value = useMemo<I18nContextValue>(() => {
        return {
            language,
            setLanguage,
            t: (key: string) => translations[language][key] || translations.ua[key] || key,
        };
    }, [language]);

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
    const ctx = useContext(I18nContext);
    if (!ctx) {
        throw new Error('useI18n must be used inside I18nProvider');
    }
    return ctx;
}


