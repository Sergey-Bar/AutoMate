import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'he', name: 'עברית', flag: '🇮🇱' },
] as const;

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const currentLanguage = (i18n?.resolvedLanguage ?? i18n?.language ?? 'en').startsWith('he') ? 'he' : 'en';

  const handleChange = (code: string) => {
    try {
      localStorage.setItem('automate_lang', code);
    } catch {
      // ignore storage failures
    }
    if (i18n?.changeLanguage) {
      void i18n.changeLanguage(code);
    }
  };

  return (
    <select
      value={currentLanguage}
      onChange={(e) => handleChange(e.target.value)}
      aria-label={t('common.language', 'Language')}
      className={cn(
        'h-7 rounded border px-2 text-xs transition-colors outline-none',
        'border-border-default bg-transparent text-text-secondary',
      )}
    >
      {LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.flag} {lang.name}
        </option>
      ))}
    </select>
  );
}
