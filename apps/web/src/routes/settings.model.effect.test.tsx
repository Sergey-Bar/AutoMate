/**
 * settings.model.effect.test.tsx
 *
 * Covers the useEffect-triggered loadConfig code paths (lines 22-38 in settings.model.tsx)
 * by mocking `useEffect` to call its callback synchronously. Uses a guard to prevent
 * infinite re-render loops in React SSR.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

// Fire useEffect synchronously but only once per renderToString call
// to avoid "too many re-renders" from SSR dispatcher re-invoking on state updates
let _effectFired = false;

vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>();
  return {
    ...original,
    useEffect: (cb: () => (() => void) | void) => {
      if (!_effectFired) {
        _effectFired = true;
        cb();
      }
    },
  };
});

const mockFetch = vi.fn();

beforeEach(() => {
  globalThis.fetch = mockFetch;
  _effectFired = false;
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ModelSettingsPage loadConfig via useEffect (sync — lines 22-38)', () => {
  it('loadConfig: calls fetch /api/model-config on mount (ok response)', async () => {
    const { ModelSettingsPage } = await import('./settings.model.js');
    const configData = {
      provider: 'openai', model: 'gpt-4',
      endpoint: 'https://api.openai.com/v1', temperature: 0.5, maxTokens: 8192,
    };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => configData });

    renderToString(React.createElement(ModelSettingsPage));

    expect(mockFetch).toHaveBeenCalledWith('/api/model-config');
    await Promise.resolve();
    await Promise.resolve();
  });

  it('loadConfig: calls fetch on mount (non-ok response → error path)', async () => {
    const { ModelSettingsPage } = await import('./settings.model.js');
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    renderToString(React.createElement(ModelSettingsPage));

    expect(mockFetch).toHaveBeenCalledWith('/api/model-config');
    await Promise.resolve();
    await Promise.resolve();
  });

  it('loadConfig: calls fetch on mount (network error → catch path)', async () => {
    const { ModelSettingsPage } = await import('./settings.model.js');
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    renderToString(React.createElement(ModelSettingsPage));

    expect(mockFetch).toHaveBeenCalledWith('/api/model-config');
    await Promise.resolve();
    await Promise.resolve();
  });
});
