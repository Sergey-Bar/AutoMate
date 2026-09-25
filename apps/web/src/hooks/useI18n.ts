import { useI18nContext } from '../i18n/I18nProvider.js';
import type { Locale } from '../i18n/index.js';

interface UseI18nReturn {
  t: (key: string) => string;
  locale: Locale;
  dir: 'ltr' | 'rtl';
  setLocale: (locale: Locale) => void;
}

export function useI18n(): UseI18nReturn {
  return useI18nContext();
}
