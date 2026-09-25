import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import { LanguageSwitcher } from '../LanguageSwitcher';

const mockChangeLanguage = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: {
      language: 'en',
      resolvedLanguage: 'en',
      changeLanguage: mockChangeLanguage,
    },
  }),
}));

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders english and hebrew language options', () => {
    renderWithProviders(<LanguageSwitcher />);

    const select = screen.getByLabelText('Language');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '🇺🇸 English' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '🇮🇱 עברית' })).toBeInTheDocument();
  });

  it('changes language when selecting another option', () => {
    renderWithProviders(<LanguageSwitcher />);

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'he' } });

    expect(mockChangeLanguage).toHaveBeenCalledWith('he');
  });

  it('persists language selection to localStorage', () => {
    renderWithProviders(<LanguageSwitcher />);

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'he' } });

    expect(localStorage.getItem('automate_lang')).toBe('he');
  });
});
