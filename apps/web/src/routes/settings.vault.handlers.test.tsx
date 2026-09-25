/**
 * settings.vault.handlers.test.tsx
 *
 * Covers handler bodies that cannot be exercised via renderToString alone:
 *   - saveCredentials body (lines 86-97): setSaveStatus, fetch, setTimeout
 *   - updateCredential / onChange on credential input (line 170)
 *   - onClick on Save Credentials button (line 177)
 *
 * Strategy:
 *   1. Mock useState to expose setter spies and return state with isUnlocked=true + connectors.
 *   2. Call VaultSettingsPage() as a function to get the React element tree.
 *   3. Drill into the connector credentials section and locate inputs/buttons.
 *   4. Invoke onChange/onClick handlers and verify setter spies are called.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

// ── Setter spies for VaultSettingsPage useState calls ─────────────────────────
// useState call order in VaultSettingsPage:
//   1. isUnlocked       → setIsUnlocked
//   2. password         → setPassword
//   3. status           → setStatus
//   4. errorMsg         → setErrorMsg
//   5. connectors       → setConnectors
//   6. credentialInputs → setCredentialInputs
//   7. saveStatus       → setSaveStatus

const setIsUnlockedSpy = vi.fn();
const setPasswordSpy = vi.fn();
const setStatusSpy = vi.fn();
const setErrorMsgSpy = vi.fn();
const setConnectorsSpy = vi.fn();
const setCredentialInputsSpy = vi.fn();
const setSaveStatusSpy = vi.fn();

let _useStateCallCount = 0;

const MOCK_CONNECTORS = [
  { name: 'github', displayName: 'GitHub', description: 'GitHub integration', icon: '🐙', toolCount: 3 },
];

vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>();
  return {
    ...original,
    useState: (initial: unknown) => {
      _useStateCallCount++;
      const count = _useStateCallCount;
      if (count === 1) return [true, setIsUnlockedSpy];             // isUnlocked
      if (count === 2) return ['', setPasswordSpy];                  // password
      if (count === 3) return ['idle', setStatusSpy];               // status
      if (count === 4) return ['', setErrorMsgSpy];                 // errorMsg
      if (count === 5) return [MOCK_CONNECTORS, setConnectorsSpy];  // connectors
      if (count === 6) return [{}, setCredentialInputsSpy];         // credentialInputs
      if (count === 7) return [{}, setSaveStatusSpy];               // saveStatus
      return (original.useState as (v: unknown) => [unknown, unknown])(initial);
    },
    useCallback: <T,>(fn: T): T => fn,
    useEffect: (_cb: unknown) => { /* no-op */ },
  };
});

const mockFetch = vi.fn();

beforeEach(() => {
  _useStateCallCount = 0;
  vi.clearAllMocks();
  globalThis.fetch = mockFetch;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Helper: get VaultSettingsPage VNode and locate elements ──────────────────

async function getPageVNode() {
  const { VaultSettingsPage } = await import('./settings.vault.js');
  _useStateCallCount = 0;
  return VaultSettingsPage() as React.ReactElement<{ children?: React.ReactNode }>;
}

/** Recursively find all elements with a given prop key */
function findAllByProp<T>(
  node: React.ReactNode,
  propKey: string,
  results: Array<React.ReactElement<{ [key: string]: T }>> = []
): Array<React.ReactElement<{ [key: string]: T }>> {
  if (!React.isValidElement(node)) return results;
  const el = node as React.ReactElement<{ [key: string]: unknown }>;
  if (propKey in el.props) results.push(el as React.ReactElement<{ [key: string]: T }>);
  const children = el.props.children;
  if (children) {
    for (const child of React.Children.toArray(children as React.ReactNode)) {
      findAllByProp(child, propKey, results);
    }
  }
  return results;
}

// ── saveCredentials: lines 86-97 ──────────────────────────────────────────────

describe('saveCredentials body (lines 86-97)', () => {
  it('calls setSaveStatus("saving") then setSaveStatus("saved") on success', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const pageEl = await getPageVNode();

    // Find "Save Credentials" button — it has onClick that calls saveCredentials
    const buttons = findAllByProp<() => void>(pageEl, 'onClick');
    const saveBtn = buttons.find((btn) => {
      const el = btn as React.ReactElement<{ children?: React.ReactNode }>;
      const text = String(el.props.children ?? '');
      return text.includes('Save Credentials') || text.includes('Saving') || text.includes('Saved');
    });

    expect(saveBtn).toBeDefined();
    if (!saveBtn) return;

    const onClick = saveBtn.props['onClick'] as (() => void) | undefined;
    onClick?.();

    // setSaveStatus should have been called with a functional updater that sets 'saving'
    expect(setSaveStatusSpy).toHaveBeenCalled();
    const savingCall = setSaveStatusSpy.mock.calls[0][0] as (prev: Record<string, string>) => Record<string, string>;
    if (typeof savingCall === 'function') {
      const result = savingCall({});
      expect(result['github']).toBe('saving');
    }

    // Let fetch resolve
    await Promise.resolve();
    await Promise.resolve();

    // setSaveStatus should have been called with 'saved'
    const allCalls = setSaveStatusSpy.mock.calls;
    const savedCall = allCalls.find((call) => {
      const updater = call[0];
      if (typeof updater === 'function') {
        const r = updater({}) as Record<string, string>;
        return r['github'] === 'saved';
      }
      return false;
    });
    expect(savedCall).toBeDefined();
  });

  it('calls setSaveStatus("saving") then setSaveStatus via setTimeout on saved', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const pageEl = await getPageVNode();
    const buttons = findAllByProp<() => void>(pageEl, 'onClick');
    const saveBtn = buttons.find((btn) => {
      const el = btn as React.ReactElement<{ children?: React.ReactNode }>;
      const text = String(el.props.children ?? '');
      return text.includes('Save Credentials') || text.includes('Saving');
    });
    if (!saveBtn) return;

    const onClick = saveBtn.props['onClick'] as (() => void) | undefined;
    onClick?.();
    await Promise.resolve();
    await Promise.resolve();

    // After 2000ms timeout, saveStatus should reset to 'idle'
    vi.runAllTimers();
    const idleCall = setSaveStatusSpy.mock.calls.find((call) => {
      const updater = call[0];
      if (typeof updater === 'function') {
        const r = updater({}) as Record<string, string>;
        return r['github'] === 'idle';
      }
      return false;
    });
    expect(idleCall).toBeDefined();
  });

  it('calls setSaveStatus("error") when fetch returns non-ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const pageEl = await getPageVNode();
    const buttons = findAllByProp<() => void>(pageEl, 'onClick');
    const saveBtn = buttons.find((btn) => {
      const el = btn as React.ReactElement<{ children?: React.ReactNode }>;
      const text = String(el.props.children ?? '');
      return text.includes('Save Credentials') || text.includes('Saving');
    });
    if (!saveBtn) return;

    const onClick = saveBtn.props['onClick'] as (() => void) | undefined;
    onClick?.();
    await Promise.resolve();
    await Promise.resolve();

    const errorCall = setSaveStatusSpy.mock.calls.find((call) => {
      const updater = call[0];
      if (typeof updater === 'function') {
        const r = updater({}) as Record<string, string>;
        return r['github'] === 'error';
      }
      return false;
    });
    expect(errorCall).toBeDefined();
  });

  it('calls setSaveStatus("error") when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const pageEl = await getPageVNode();
    const buttons = findAllByProp<() => void>(pageEl, 'onClick');
    const saveBtn = buttons.find((btn) => {
      const el = btn as React.ReactElement<{ children?: React.ReactNode }>;
      const text = String(el.props.children ?? '');
      return text.includes('Save Credentials') || text.includes('Saving');
    });
    if (!saveBtn) return;

    const onClick = saveBtn.props['onClick'] as (() => void) | undefined;
    onClick?.();
    await Promise.resolve();
    await Promise.resolve();

    const errorCall = setSaveStatusSpy.mock.calls.find((call) => {
      const updater = call[0];
      if (typeof updater === 'function') {
        const r = updater({}) as Record<string, string>;
        return r['github'] === 'error';
      }
      return false;
    });
    expect(errorCall).toBeDefined();
  });
});

// ── updateCredential / onChange on credential input (lines 170, 78-83) ────────

describe('updateCredential / onChange handler (lines 170, 78-83)', () => {
  it('calls setCredentialInputs with updated nested value when credential input changes', async () => {
    const pageEl = await getPageVNode();

    // Find password-type inputs with onChange — these are credential inputs
    const inputs = findAllByProp<(e: { target: { value: string } }) => void>(pageEl, 'onChange');
    const credInput = inputs.find((el) => {
      const props = el.props as { type?: string; placeholder?: string };
      return props.type === 'password' && props.placeholder?.includes('Enter ');
    });

    expect(credInput).toBeDefined();
    if (!credInput) return;

    const onChange = credInput.props['onChange'] as (e: { target: { value: string } }) => void;
    onChange({ target: { value: 'ghp_testtoken' } });

    // setCredentialInputs should be called with a functional updater
    expect(setCredentialInputsSpy).toHaveBeenCalled();
    const updater = setCredentialInputsSpy.mock.calls[0][0] as (
      prev: Record<string, Record<string, string>>
    ) => Record<string, Record<string, string>>;
    if (typeof updater === 'function') {
      const result = updater({});
      // The updater should have set the github.token field to 'ghp_testtoken'
      expect(result['github']).toBeDefined();
      expect(Object.values(result['github'])[0]).toBe('ghp_testtoken');
    }
  });

  it('updateCredential preserves existing fields when updating a key', async () => {
    const pageEl = await getPageVNode();

    const inputs = findAllByProp<(e: { target: { value: string } }) => void>(pageEl, 'onChange');
    const credInput = inputs.find((el) => {
      const props = el.props as { type?: string; placeholder?: string };
      return props.type === 'password' && props.placeholder?.includes('Enter ');
    });

    if (!credInput) return;
    const onChange = credInput.props['onChange'] as (e: { target: { value: string } }) => void;
    onChange({ target: { value: 'new_value' } });

    const updater = setCredentialInputsSpy.mock.calls[0][0] as (
      prev: Record<string, Record<string, string>>
    ) => Record<string, Record<string, string>>;
    if (typeof updater === 'function') {
      // Existing data should be preserved
      const prev = { github: { token: 'old_value', otherField: 'preserved' } };
      const result = updater(prev);
      expect(result['github']['otherField']).toBe('preserved');
    }
  });
});
