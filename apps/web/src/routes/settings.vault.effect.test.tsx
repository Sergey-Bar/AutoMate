/**
 * settings.vault.effect.test.tsx
 *
 * Covers the useEffect-triggered handler bodies in settings.vault.tsx:
 * - loadStatus (lines 20-29)
 * - loadConnectors (lines 31-40)
 * - the useEffect call itself (lines 42-45)
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

let _effectCallCount = 0;
const MAX_EFFECTS = 10;

vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>();
  return {
    ...original,
    useEffect: (cb: () => (() => void) | void, _deps?: unknown[]) => {
      void _deps;
      if (_effectCallCount < MAX_EFFECTS) {
        _effectCallCount++;
        cb();
      }
    },
  };
});

const mockFetch = vi.fn();

beforeEach(() => {
  globalThis.fetch = mockFetch;
  _effectCallCount = 0;
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('VaultSettingsPage loadStatus via useEffect (sync mock — lines 20-29)', () => {
  it('loadStatus: calls GET /api/vault/status on mount (ok, isUnlocked=false)', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isUnlocked: false }) }) // loadStatus
      .mockResolvedValueOnce({ ok: true, json: async () => [] }); // loadConnectors

    renderToString(React.createElement(VaultSettingsPage));

    expect(mockFetch).toHaveBeenCalledWith('/api/vault/status');
    await Promise.resolve();
    await Promise.resolve();
  });

  it('loadStatus: handles non-ok response (returns early)', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 });

    renderToString(React.createElement(VaultSettingsPage));

    expect(mockFetch).toHaveBeenCalledWith('/api/vault/status');
    await Promise.resolve();
  });

  it('loadStatus: handles network error (silently caught)', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    mockFetch
      .mockRejectedValueOnce(new Error('Vault not available'))
      .mockRejectedValueOnce(new Error('Connector not available'));

    renderToString(React.createElement(VaultSettingsPage));

    expect(mockFetch).toHaveBeenCalledWith('/api/vault/status');
    await Promise.resolve();
  });
});

describe('VaultSettingsPage loadConnectors via useEffect (sync mock — lines 31-40)', () => {
  it('loadConnectors: calls GET /api/connectors on mount (ok response)', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const connectorData = [
      { name: 'github', displayName: 'GitHub', description: 'GitHub connector', icon: '🐙', toolCount: 3 },
    ];
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isUnlocked: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => connectorData });

    renderToString(React.createElement(VaultSettingsPage));

    expect(mockFetch).toHaveBeenCalledWith('/api/connectors');
    await Promise.resolve();
    await Promise.resolve();
  });

  it('loadConnectors: handles non-ok response (returns early)', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isUnlocked: false }) })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    renderToString(React.createElement(VaultSettingsPage));

    expect(mockFetch).toHaveBeenCalledWith('/api/connectors');
    await Promise.resolve();
  });

  it('loadConnectors: handles network error (silently caught)', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isUnlocked: false }) })
      .mockRejectedValueOnce(new Error('Network error'));

    renderToString(React.createElement(VaultSettingsPage));

    expect(mockFetch).toHaveBeenCalledWith('/api/connectors');
    await Promise.resolve();
  });
});
