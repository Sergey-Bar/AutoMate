import React, { useState } from 'react';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { Button, Input } from '@automate/ui';
import { Route as rootRoute } from './__root.js';
import { useAuth } from '../auth/useAuth.js';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { return?: string } =>
    typeof search['return'] === 'string' ? { return: search['return'] } : {},
  component: LoginComponent,
});

function safeReturnPath(value: string | undefined): string {
  if (!value) return '/';
  try {
    const decoded = decodeURIComponent(value);
    return decoded.startsWith('/') && !decoded.startsWith('//') ? decoded : '/';
  } catch {
    return '/';
  }
}

function LoginComponent() {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ from: '/login' });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(apiKey);
      await navigate({ to: safeReturnPath(search.return) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-testid="login-page" className="mx-auto max-w-sm px-8 pt-20">
      <h1 className="mb-6 text-2xl font-bold text-text-primary">Sign in to Automate</h1>
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <label htmlFor="api-key" className="mb-2 block text-sm font-medium text-text-primary">
          API Key
        </label>
        <Input
          id="api-key"
          data-testid="api-key-input"
          type="password"
          autoComplete="current-password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="Enter your API key"
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'api-key-error' : undefined}
          className="w-full"
        />
        {error && (
          <p
            id="api-key-error"
            role="alert"
            data-testid="login-error"
            className="mt-2 text-sm text-error"
          >
            {error}
          </p>
        )}
        <Button
          type="submit"
          data-testid="login-submit"
          disabled={loading}
          aria-busy={loading}
          variant="primary"
          className="mt-4 w-full"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
