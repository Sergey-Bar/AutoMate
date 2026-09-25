import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { FormEvent, useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const hasI18n = Boolean(i18n);
  const tr = (key: string, fallback: string) => (hasI18n ? t(key, { defaultValue: fallback }) : fallback);
  const navigate = useNavigate();
  const enabled = useAuthStore((s) => s.enabled);
  const loading = useAuthStore((s) => s.loading);
  const login = useAuthStore((s) => s.login);

  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [samlConfigured, setSamlConfigured] = useState(false);

  useEffect(() => {
    if (!enabled) {
      navigate({ to: '/' });
    }
  }, [enabled, navigate]);

  useEffect(() => {
    fetch('/api/auth/saml/status')
      .then((res) => res.ok ? res.json() : { configured: false })
      .then((data: { configured?: boolean }) => {
        setSamlConfigured(data.configured === true);
      })
      .catch(() => {
        // SSO status fetch failure is non-fatal — hide SSO button
        setSamlConfigured(false);
      });
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const ok = await login(apiKey);
    if (ok) {
      navigate({ to: '/' });
      return;
    }

    setError(tr('auth.invalidApiKey', 'Invalid API key'));
  }

  if (!enabled) {
    return (
      <div className="flex h-dvh items-center justify-center bg-bg-base px-4">
        <p className="text-sm text-text-secondary">{tr('auth.authDisabled', 'Auth is disabled')}</p>
      </div>
    );
  }

  return (
    <div className="flex h-dvh items-center justify-center bg-bg-base px-4">
      <div className="w-full max-w-md rounded-xl border border-border-default bg-bg-surface p-6">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-running text-base font-bold text-white">
            A
          </div>
          <h1 className="text-2xl font-semibold text-text-primary">{tr('auth.appName', 'Automate')}</h1>
          <p className="mt-1 text-sm text-text-secondary">{tr('auth.signInSubtitle', 'Sign in with your API key')}</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="api-key" className="mb-1 block text-sm text-text-secondary">
              {tr('auth.apiKey', 'API Key')}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="api-key"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
                className="w-full rounded-lg border border-border-default bg-bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus:border-border-focus"
                placeholder={tr('auth.apiKeyPlaceholder', 'Enter your API key')}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="rounded-lg border border-border-default px-3 py-2 text-xs text-text-secondary"
                aria-label={showKey ? tr('auth.hide', 'Hide') : tr('auth.show', 'Show')}
              >
                {showKey ? tr('auth.hide', 'Hide') : tr('auth.show', 'Show')}
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-fail">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-running px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {tr('auth.signIn', 'Sign In')}
          </button>
        </form>

        {samlConfigured && (
          <div className="mt-4">
            <div className="relative flex items-center">
              <div className="flex-grow border-t border-border-default" />
              <span className="mx-3 flex-shrink text-xs text-text-secondary">{tr('auth.orContinueWith', 'or continue with')}</span>
              <div className="flex-grow border-t border-border-default" />
            </div>
            <a
              href="/api/auth/saml/login"
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-border-default bg-bg-elevated px-4 py-2 text-sm font-medium text-text-primary hover:bg-bg-surface"
              data-testid="sso-login-button"
            >
              {tr('auth.signInWithSso', 'Sign in with SSO')}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
