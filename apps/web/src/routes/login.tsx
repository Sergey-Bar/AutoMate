import React, { useState } from 'react';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { Route as rootRoute } from './__root.js';
import { useAuth } from '../auth/useAuth.js';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { return?: string } => {
    if (typeof search['return'] === 'string') {
      return { return: search['return'] };
    }
    return {};
  },
  component: LoginComponent,
});

function LoginComponent() {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ from: '/login' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(apiKey);
      const returnPath = search.return ? decodeURIComponent(search.return) : '/';
      await navigate({ to: returnPath });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-testid="login-page" className="login-shell">
      <section className="login-card">
        <p className="login-kicker">Secure Access</p>
        <h1 className="login-title">Sign in to Automate</h1>
        <form onSubmit={(e) => { void handleSubmit(e); }}>
          <div>
            <label htmlFor="api-key" className="login-label">
            API Key
            </label>
            <input
              id="api-key"
              data-testid="api-key-input"
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API key"
              required
              className="login-input"
            />
          </div>
          {error && (
            <p data-testid="login-error" className="login-error">
              {error}
            </p>
          )}
          <button
            type="submit"
            data-testid="login-submit"
            disabled={loading}
            className="login-submit"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </div>
  );
}
