/**
 * settings.vault.state.test.tsx
 *
 * Covers the VaultSettingsPage conditional branches that require:
 *   - isUnlocked === true  → renders "Lock Vault" button and connector credentials section
 *   - connectors.length > 0 → renders the {isUnlocked && connectors.length > 0} block
 *   - saveCredentials body (lines 86-98) → via saveStatus mock states
 *
 * useState call order in VaultSettingsPage during renderToString:
 *   1. isUnlocked     → bool
 *   2. password       → ''
 *   3. status         → 'idle' | 'loading' | 'error'
 *   4. errorMsg       → ''
 *   5. connectors     → ConnectorInfo[]
 *   6. credentialInputs → {}
 *   7. saveStatus     → {}
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

// ---- Module-level state controls (reset in beforeEach) ----------------------

let _useStateCallCount = 0;
let _mockIsUnlocked = true;
let _mockStatus: 'idle' | 'loading' | 'error' = 'idle';
let _mockErrorMsg = '';
let _mockConnectors: Array<{
  name: string; displayName: string; description: string; icon: string; toolCount: number;
}> = [
  { name: 'github', displayName: 'GitHub', description: 'GitHub integration', icon: '🐙', toolCount: 3 },
  { name: 'jira', displayName: 'Jira', description: 'Jira integration', icon: '🎯', toolCount: 2 },
  { name: 'slack', displayName: 'Slack', description: 'Slack notifications', icon: '💬', toolCount: 1 },
];
let _mockCredentialInputs: Record<string, Record<string, string>> = {};
let _mockSaveStatus: Record<string, 'idle' | 'saving' | 'saved' | 'error'> = {};

vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>();
  return {
    ...original,
    useState: (initial: unknown) => {
      _useStateCallCount++;
      const count = _useStateCallCount;

      if (count === 1) return [_mockIsUnlocked, vi.fn()];
      if (count === 2) return ['', vi.fn()];                    // password
      if (count === 3) return [_mockStatus, vi.fn()];
      if (count === 4) return [_mockErrorMsg, vi.fn()];
      if (count === 5) return [_mockConnectors, vi.fn()];
      if (count === 6) return [_mockCredentialInputs, vi.fn()];
      if (count === 7) return [_mockSaveStatus, vi.fn()];

      return original.useState(initial);
    },
    useCallback: (cb: unknown) => cb,
    useEffect: (_cb: unknown) => { /* no-op */ },
  };
});

beforeEach(() => {
  _useStateCallCount = 0;
  _mockIsUnlocked = true;
  _mockStatus = 'idle';
  _mockErrorMsg = '';
  _mockConnectors = [
    { name: 'github', displayName: 'GitHub', description: 'GitHub integration', icon: '🐙', toolCount: 3 },
    { name: 'jira', displayName: 'Jira', description: 'Jira integration', icon: '🎯', toolCount: 2 },
    { name: 'slack', displayName: 'Slack', description: 'Slack notifications', icon: '💬', toolCount: 1 },
  ];
  _mockCredentialInputs = {};
  _mockSaveStatus = {};
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Unlocked state: Lock Vault button ─────────────────────────────────────────

describe('VaultSettingsPage when isUnlocked=true', () => {
  it('renders "🔓 Unlocked" status', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('🔓 Unlocked');
  });

  it('renders Lock Vault button instead of Unlock form', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('Lock Vault');
    expect(html).not.toContain('Unlock Vault');
  });

  it('does NOT render password input when unlocked', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).not.toContain('Master password');
  });
});

// ── Unlocked + connectors: Connector Credentials section ─────────────────────

describe('VaultSettingsPage connector credentials section (isUnlocked=true, connectors loaded)', () => {
  it('renders "Connector Credentials" heading', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('Connector Credentials');
  });

  it('renders each connector displayName', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('GitHub');
    expect(html).toContain('Jira');
    expect(html).toContain('Slack');
  });

  it('renders connector icons', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('🐙');
    expect(html).toContain('🎯');
    expect(html).toContain('💬');
  });

  it('renders known credential fields for github (token)', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('token');
    expect(html).toContain('github-token');
  });

  it('renders known credential fields for jira (host, email, apiToken)', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('host');
    expect(html).toContain('email');
    expect(html).toContain('apiToken');
  });

  it('renders known credential fields for slack (webhookUrl)', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('webhookUrl');
  });

  it('renders fallback apiKey field for unknown connector', async () => {
    _mockConnectors = [
      { name: 'custom', displayName: 'Custom', description: 'Custom connector', icon: '🔌', toolCount: 1 },
    ];
    _useStateCallCount = 0;
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('apiKey');
    expect(html).toContain('custom-apiKey');
  });

  it('renders password-type inputs for credential fields', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    const pwdInputCount = (html.match(/type="password"/g) ?? []).length;
    // github(1) + jira(3) + slack(1) = 5 credential password inputs
    expect(pwdInputCount).toBeGreaterThanOrEqual(5);
  });

  it('renders Save Credentials button for each connector', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    const saveCount = (html.match(/Save Credentials/g) ?? []).length;
    expect(saveCount).toBe(3);
  });

  it('renders label htmlFor attribute matching input id', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('for="github-token"');
    expect(html).toContain('id="github-token"');
  });
});

// ── saveStatus variants ───────────────────────────────────────────────────────

describe('VaultSettingsPage saveStatus variants', () => {
  it('renders "Saving..." when saveStatus[name] is saving', async () => {
    _mockSaveStatus = { github: 'saving' };
    _useStateCallCount = 0;
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('Saving...');
  });

  it('Save button is disabled when saveStatus[name] is saving', async () => {
    _mockSaveStatus = { github: 'saving' };
    _useStateCallCount = 0;
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('disabled');
  });

  it('renders "Saved ✓" when saveStatus[name] is saved', async () => {
    _mockSaveStatus = { github: 'saved' };
    _useStateCallCount = 0;
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('Saved ✓');
  });

  it('renders "Failed to save credentials" error when saveStatus[name] is error', async () => {
    _mockSaveStatus = { github: 'error' };
    _useStateCallCount = 0;
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('Failed to save credentials');
  });

  it('renders "Save Credentials" text when saveStatus is idle', async () => {
    _mockSaveStatus = { github: 'idle' };
    _useStateCallCount = 0;
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('Save Credentials');
  });
});

// ── credentialInputs pre-filled values ────────────────────────────────────────

describe('VaultSettingsPage credentialInputs pre-filled', () => {
  it('renders input value from credentialInputs when pre-filled', async () => {
    _mockCredentialInputs = { github: { token: 'ghp_test_token_123' } };
    _useStateCallCount = 0;
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('ghp_test_token_123');
  });

  it('renders empty value when credentialInputs entry is missing', async () => {
    _mockCredentialInputs = {};
    _useStateCallCount = 0;
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    // All inputs render with value="" when no pre-fill
    expect(html).toContain('value=""');
  });
});

// ── Locked state: Unlock form ─────────────────────────────────────────────────

describe('VaultSettingsPage when isUnlocked=false', () => {
  beforeEach(() => {
    _mockIsUnlocked = false;
    _useStateCallCount = 0;
  });

  it('renders "🔒 Locked" status', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('🔒 Locked');
  });

  it('renders Unlock Vault button', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('Unlock Vault');
  });

  it('does NOT render Connector Credentials section when locked', async () => {
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).not.toContain('Connector Credentials');
  });

  it('renders error message when status is error', async () => {
    _mockStatus = 'error';
    _mockErrorMsg = 'Wrong password';
    _useStateCallCount = 0;
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('Wrong password');
  });

  it('renders "Unlocking..." when status is loading', async () => {
    _mockStatus = 'loading';
    _useStateCallCount = 0;
    const { VaultSettingsPage } = await import('./settings.vault.js');
    const html = renderToString(React.createElement(VaultSettingsPage));
    expect(html).toContain('Unlocking...');
  });
});
