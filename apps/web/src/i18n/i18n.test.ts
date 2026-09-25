import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { t, isRTL, RTL_LOCALES, getLocale, setLocale } from './index.js';

const STORAGE_KEY = 'automate-lang';

describe('t() translation lookup', () => {
  it('returns English translation for en locale', () => {
    expect(t('nav.dashboard', 'en')).toBe('Dashboard');
  });

  it('returns Hebrew translation for he locale', () => {
    expect(t('nav.dashboard', 'he')).toBe('לוח בקרה');
  });

  it('falls back to key when translation is missing', () => {
    expect(t('nonexistent.key', 'en')).toBe('nonexistent.key');
  });

  it('defaults to en locale when no locale provided', () => {
    expect(t('nav.dashboard')).toBe('Dashboard');
  });
});

describe('RTL detection', () => {
  it('isRTL returns true for Hebrew', () => {
    expect(isRTL('he')).toBe(true);
  });

  it('isRTL returns false for English', () => {
    expect(isRTL('en')).toBe(false);
  });

  it('RTL_LOCALES includes he', () => {
    expect(RTL_LOCALES).toContain('he');
  });

  it('RTL_LOCALES does not include en', () => {
    expect(RTL_LOCALES).not.toContain('en');
  });
});

describe('locale persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('getLocale returns en by default', () => {
    expect(getLocale()).toBe('en');
  });

  it('setLocale persists to localStorage', () => {
    setLocale('he');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('he');
  });

  it('getLocale reads from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'he');
    expect(getLocale()).toBe('he');
  });

  it('getLocale falls back to en for unknown locale in storage', () => {
    localStorage.setItem(STORAGE_KEY, 'fr');
    expect(getLocale()).toBe('en');
  });
});
