import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { type Locale, t as translate, isRTL, getLocale, setLocale } from './index.js';

interface I18nContextValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: (key: string) => string;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

interface I18nProviderProps {
  children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(getLocale);

  const handleSetLocale = useCallback((newLocale: Locale) => {
    setLocale(newLocale);
    setLocaleState(newLocale);
    document.documentElement.dir = isRTL(newLocale) ? 'rtl' : 'ltr';
    document.documentElement.lang = newLocale;
  }, []);

  const tFn = useCallback((key: string) => translate(key, locale), [locale]);

  const dir: 'ltr' | 'rtl' = isRTL(locale) ? 'rtl' : 'ltr';

  return (
    <I18nContext.Provider value={{ locale, dir, t: tFn, setLocale: handleSetLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18nContext(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18nContext must be used within I18nProvider');
  }
  return ctx;
}
