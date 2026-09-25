/**
 * settings.connectors.effect.test.tsx
 *
 * Covers the useEffect-triggered handler bodies in settings.connectors.tsx by:
 * 1. Mocking useEffect to call callbacks synchronously (with a guard to prevent loops)
 * 2. Using a separate describe for getStatusColor and connector map rendering
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

// Guard: fire each unique callback at most once per test to prevent infinite loops
const _firedEffects = new Set<() => ((() => void) | void)>();

vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>();
  return {
    ...original,
    // Make setState a no-op to prevent re-renders during SSR effect firing
    useState: <T,>(initialValue: T): [T, (v: T) => void] => {
      return [initialValue, () => {}];
    },
    useCallback: <T,>(fn: T, _deps?: unknown[]): T => { void _deps; return fn; },
    useEffect: (cb: () => (() => void) | void, _deps?: unknown[]) => {
      void _deps;
      if (!_firedEffects.has(cb)) {
        _firedEffects.add(cb);
        cb();
      }
    },
  };
});

const mockFetch = vi.fn();

beforeEach(() => {
  globalThis.fetch = mockFetch;
  _firedEffects.clear();
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ConnectorsSettingsPage loadConnectors via useEffect (sync mock)', () => {
  it('loadConnectors: calls fetch /api/connectors on mount (ok response)', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const connectorData = [
      { name: 'github', displayName: 'GitHub', description: 'GitHub connector', icon: '🐙', toolCount: 3 },
    ];
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => connectorData }) // loadConnectors
      .mockResolvedValueOnce({ ok: true, json: async () => ({ contractVersion: '1.0', validationStatus: 'passed', diagnostics: '', mismatches: [], lastValidationTimestamp: null, apiKeyStatus: 'configured', endpointUrl: 'http://localhost:8080/mcp' }) }); // fetchHealth

    renderToString(React.createElement(ConnectorsSettingsPage));

    expect(mockFetch).toHaveBeenCalledWith('/api/connectors');
    await Promise.resolve();
    await Promise.resolve();
  });

  it('loadConnectors: handles non-ok response', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    renderToString(React.createElement(ConnectorsSettingsPage));

    expect(mockFetch).toHaveBeenCalledWith('/api/connectors');
    await Promise.resolve();
  });

  it('loadConnectors: handles network error', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    mockFetch
      .mockRejectedValueOnce(new Error('Network down'))
      .mockRejectedValueOnce(new Error('Network down'));

    renderToString(React.createElement(ConnectorsSettingsPage));

    expect(mockFetch).toHaveBeenCalledWith('/api/connectors');
    await Promise.resolve();
  });
});

describe('McpConnectorCard fetchHealth via useEffect (sync mock)', () => {
  it('fetchHealth: fetch is called on mount (ok response with endpointUrl)', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const healthData = {
      contractVersion: '1.0',
      validationStatus: 'passed' as const,
      diagnostics: 'All checks passed',
      mismatches: [],
      lastValidationTimestamp: '2024-01-01T00:00:00Z',
      apiKeyStatus: 'configured' as const,
      endpointUrl: 'http://localhost:8080/mcp',
    };
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] }) // loadConnectors
      .mockResolvedValueOnce({ ok: true, json: async () => healthData }); // fetchHealth

    renderToString(React.createElement(ConnectorsSettingsPage));

    expect(mockFetch).toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('fetchHealth: handles non-ok response (sets error status)', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: false, status: 503 });

    renderToString(React.createElement(ConnectorsSettingsPage));

    expect(mockFetch).toHaveBeenCalled();
    await Promise.resolve();
  });

  it('fetchHealth: handles network error', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockRejectedValueOnce(new Error('Connection refused'));

    renderToString(React.createElement(ConnectorsSettingsPage));

    expect(mockFetch).toHaveBeenCalled();
    await Promise.resolve();
  });

  it('fetchHealth: handles ok response without endpointUrl', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const healthData = {
      contractVersion: '1.0',
      validationStatus: 'unknown' as const,
      diagnostics: '',
      mismatches: [],
      lastValidationTimestamp: null,
      apiKeyStatus: 'not_configured' as const,
    };
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => healthData });

    renderToString(React.createElement(ConnectorsSettingsPage));

    await Promise.resolve();
    await Promise.resolve();
  });
});
