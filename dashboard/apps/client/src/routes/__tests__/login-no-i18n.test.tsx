/**
 * Covers the hasI18n=false branch in login.tsx line 13:
 *   const tr = (key, fallback) => (hasI18n ? t(key, ...) : fallback)
 *
 * When i18n is null, hasI18n=false, so tr() always returns the fallback string.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen } from '@/test/test-utils';
import { LoginPage } from '../login';

// Mock react-i18next with i18n: null to make hasI18n=false
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: null }),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: Record<string, unknown>) => ({ ...opts }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ enabled: true, authenticated: false, loading: false, error: null, login: vi.fn() }),
}));

describe('LoginPage (hasI18n=false fallback branch)', () => {
  it('renders using fallback strings when i18n instance is null', () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ configured: false }),
    } as Response);

    renderWithProviders(<LoginPage />);

    // When hasI18n=false, tr() returns the fallback string directly
    // e.g. tr('auth.appName', 'Automate') → 'Automate'
    expect(screen.getByRole('heading', { name: 'Automate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });
});
