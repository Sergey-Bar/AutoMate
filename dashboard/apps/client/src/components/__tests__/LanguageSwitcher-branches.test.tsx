import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import { LanguageSwitcher } from '../LanguageSwitcher';

// Separate branch-coverage file so we can vary the i18n mock without
// touching the main LanguageSwitcher.test.tsx module-level mock.
const { mockI18nState } = vi.hoisted(() => ({
  mockI18nState: {
    language: 'en' as string,
    resolvedLanguage: 'en' as string | undefined,
    changeLanguage: vi.fn() as ((...args: unknown[]) => unknown) | undefined,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: mockI18nState,
  }),
}));

describe('LanguageSwitcher branch coverage', () => {
  beforeEach(() => {
    mockI18nState.language = 'en';
    mockI18nState.resolvedLanguage = 'en';
    mockI18nState.changeLanguage = vi.fn();
    localStorage.clear();
  });

  it('renders select value as "he" when resolvedLanguage is Hebrew (covers startsWith("he") true + ternary "he" branches)', () => {
    mockI18nState.resolvedLanguage = 'he';
    mockI18nState.language = 'he';

    renderWithProviders(<LanguageSwitcher />);

    const select = screen.getByLabelText('Language') as HTMLSelectElement;
    expect(select.value).toBe('he');
  });

  it('does not throw and still updates localStorage when changeLanguage is absent (covers if(changeLanguage) false branch)', () => {
    mockI18nState.changeLanguage = undefined;

    renderWithProviders(<LanguageSwitcher />);

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'he' } });

    // No error thrown; localStorage was still updated
    expect(localStorage.getItem('automate_lang')).toBe('he');
  });
});
