import React, { useState } from 'react';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
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
    <div
      data-testid="login-page"
      style={{ maxWidth: '400px', margin: '80px auto', padding: '32px' }}
    >
      <h1 style={{ marginBottom: '24px', fontSize: '1.5rem', fontWeight: 'bold' }}>
        Sign in to Automate
      </h1>
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <label htmlFor="api-key" style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
          API Key
        </label>
        <input
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
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #ccc',
            borderRadius: 4,
            fontSize: '1rem',
          }}
        />
        {error && (
          <p
            id="api-key-error"
            role="alert"
            data-testid="login-error"
            style={{ color: 'red', marginBottom: 16 }}
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          data-testid="login-submit"
          disabled={loading}
          aria-busy={loading}
          style={{
            width: '100%',
            padding: 10,
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            fontSize: '1rem',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
