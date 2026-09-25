import enTranslations from './locales/en.json' assert { type: 'json' };
import heTranslations from './locales/he.json' assert { type: 'json' };

export type Locale = 'en' | 'he';

const STORAGE_KEY = 'automate-lang';
const SUPPORTED_LOCALES: Locale[] = ['en', 'he'];

const translations: Record<Locale, Record<string, string>> = {
  en: enTranslations as Record<string, string>,
  he: heTranslations as Record<string, string>,
};

export const RTL_LOCALES: Locale[] = ['he'];

export function isRTL(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale);
}

export function t(key: string, locale: Locale = 'en'): string {
  return translations[locale][key] ?? key;
}

export function getLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && (SUPPORTED_LOCALES as string[]).includes(stored)) {
    return stored as Locale;
  }
  return 'en';
}

export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
}
