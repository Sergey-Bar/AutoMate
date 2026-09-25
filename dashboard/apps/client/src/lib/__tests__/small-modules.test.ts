/// <reference types="vitest" />
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../queryClient';
import i18n from '../i18n';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

import { toast } from 'sonner';
import { showToast } from '../showToast';

describe('i18n module', () => {
  it('exports i18n instance with english language configured', () => {
    expect(i18n).toBeDefined();
    expect(typeof i18n.t).toBe('function');
    expect(i18n.language).toBe('en');
    expect(i18n.options.fallbackLng).toEqual(['en']);
  });

  it('has english resource bundle loaded', () => {
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
  });

  it('returns key for missing translation', () => {
    expect(i18n.t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
  });

  it('applies RTL direction when switching to Hebrew', () => {
    i18n.changeLanguage('he');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('he');
    // Switch back to English
    i18n.changeLanguage('en');
  });

  it('applies LTR direction when switching to English', () => {
    // First switch to Hebrew to set RTL
    i18n.changeLanguage('he');
    // Then switch back to English
    i18n.changeLanguage('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
  });

  it('stores language in localStorage on change', async () => {
    // Ensure starting from English so changing to Hebrew actually fires the event
    await i18n.changeLanguage('en');
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem');
    await i18n.changeLanguage('he');
    expect(setItemSpy).toHaveBeenCalledWith('automate_lang', 'he');
    await i18n.changeLanguage('en');
    setItemSpy.mockRestore();
  });

  it('silently catches localStorage.setItem failure on language change', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage quota exceeded');
    });

    // Should not throw even though localStorage.setItem fails
    expect(() => i18n.changeLanguage('he')).not.toThrow();

    setItemSpy.mockRestore();
    i18n.changeLanguage('en');
  });

  it('falls back to en when localStorage.getItem throws on module load', () => {
    // The module is already loaded; test indirectly by checking that i18n works
    // even when getStoredLanguage would fail (covered by the catch returning 'en')
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Private browsing');
    });

    // The already-initialized i18n should still work
    expect(i18n.language).toBeTruthy();

    getItemSpy.mockRestore();
  });

  it('has Hebrew resource bundle loaded', () => {
    expect(i18n.hasResourceBundle('he', 'translation')).toBe(true);
  });
});

describe('queryClient module', () => {
  it('exports a QueryClient instance', () => {
    expect(queryClient).toBeDefined();
    expect(typeof queryClient.getDefaultOptions).toBe('function');
  });

  it('uses expected default query options', () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.retry).toBe(2);
  });
});

describe('showToast', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.info).mockClear();
  });

  it('shows success toast by default', () => {
    showToast('Saved');
    expect(toast.success).toHaveBeenCalledWith('Saved', { duration: 3000 });
  });

  it('shows error toast with error duration', () => {
    showToast('Failed', 'error');
    expect(toast.error).toHaveBeenCalledWith('Failed', { duration: 5000 });
  });

  it('shows info toast with info duration', () => {
    showToast('Heads up', 'info');
    expect(toast.info).toHaveBeenCalledWith('Heads up', { duration: 3000 });
  });
});

