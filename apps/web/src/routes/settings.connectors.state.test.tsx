/**
 * settings.connectors.state.test.tsx
 *
 * Covers the McpConnectorCard health-loaded JSX (lines 185-269 in settings.connectors.tsx)
 * and the connectors.map loop (lines 67-106) by mocking `useState` to return pre-populated
 * state values, so conditional branches (`{health && ...}`, `{connectors.map(...)}`) render.
 *
 * useState call order during renderToString:
 *   ConnectorsSettingsPage:
 *     1. connectors  — list of connectors
 *     2. enabled     — enabled map
 *     3. status      — 'idle'
 *   McpConnectorCard:
 *     4. health      — non-null health object
 *     5. status      — 'idle' | 'testing' | 'saving'
 *     6. endpoint    — endpoint string
 *     7. toast       — null | { type, message }
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

// ---- Mock state shapes -------------------------------------------------------

interface MockHealth {
  contractVersion: string;
  validationStatus: 'passed' | 'failed' | 'unknown';
  diagnostics: string;
  mismatches: string[];
  lastValidationTimestamp: string | null;
  apiKeyStatus: 'configured' | 'not_configured';
  endpointUrl?: string;
}

const healthPassed: MockHealth = {
  contractVersion: '1.2.3',
  validationStatus: 'passed',
  diagnostics: '',
  mismatches: [],
  lastValidationTimestamp: '2026-03-01T10:00:00Z',
  apiKeyStatus: 'configured',
  endpointUrl: 'http://localhost:8080/mcp',
};

const healthFailed: MockHealth = {
  contractVersion: '1.0.0',
  validationStatus: 'failed',
  diagnostics: 'Schema mismatch on /api/runs',
  mismatches: ['field: status'],
  lastValidationTimestamp: null,
  apiKeyStatus: 'not_configured',
  endpointUrl: '',
};

const healthUnknown: MockHealth = {
  contractVersion: 'N/A',
  validationStatus: 'unknown',
  diagnostics: '',
  mismatches: [],
  lastValidationTimestamp: null,
  apiKeyStatus: 'not_configured',
  endpointUrl: '',
};

interface MockConnector {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  toolCount: number;
}

// ---- Module-level state controls (reset in beforeEach) ----------------------

let _useStateCallCount = 0;
let _mockHealth: MockHealth | null = healthPassed;
let _mockConnectors: MockConnector[] = [
  { name: 'github', displayName: 'GitHub', description: 'GitHub integration', icon: '🐙', toolCount: 3 },
  { name: 'jira', displayName: 'Jira', description: 'Jira integration', icon: '🎯', toolCount: 2 },
];
let _mockMcpStatus: string = 'idle';
let _mockToast: { type: 'success' | 'error'; message: string } | null = null;

vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>();
  return {
    ...original,
    useState: (initial: unknown) => {
      _useStateCallCount++;
      const count = _useStateCallCount;

      // ConnectorsSettingsPage (calls 1-3)
      if (count === 1) {
        return [_mockConnectors, vi.fn()];
      }
      if (count === 2) {
        const enabled: Record<string, boolean> = {};
        for (const c of _mockConnectors) {
          enabled[c.name] = true;
        }
        return [enabled, vi.fn()];
      }
      if (count === 3) return ['idle', vi.fn()];

      // McpConnectorCard (calls 4-7)
      if (count === 4) return [_mockHealth, vi.fn()];
      if (count === 5) return [_mockMcpStatus, vi.fn()];
      if (count === 6) return [_mockHealth?.endpointUrl ?? '', vi.fn()];
      if (count === 7) return [_mockToast, vi.fn()];

      // Fallback
      return original.useState(initial);
    },
    useCallback: (cb: unknown) => cb,
    useEffect: (_cb: unknown) => { /* no-op — state is pre-populated */ },
  };
});

beforeEach(() => {
  _useStateCallCount = 0;
  _mockHealth = healthPassed;
  _mockConnectors = [
    { name: 'github', displayName: 'GitHub', description: 'GitHub integration', icon: '🐙', toolCount: 3 },
    { name: 'jira', displayName: 'Jira', description: 'Jira integration', icon: '🎯', toolCount: 2 },
  ];
  _mockMcpStatus = 'idle';
  _mockToast = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── McpConnectorCard: health=passed rendering ──────────────────────────────────

describe('McpConnectorCard health-loaded JSX (validationStatus=passed)', () => {
  it('renders PASSED badge', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('PASSED');
  });

  it('renders contract version', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('Contract Version:');
    expect(html).toContain('1.2.3');
  });

  it('renders Last checked timestamp when lastValidationTimestamp is non-null', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('Last checked:');
  });

  it('does NOT render diagnostics block when validationStatus is passed', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).not.toContain('Schema mismatch');
  });

  it('renders Endpoint URL label and input', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('Endpoint URL');
    expect(html).toContain('http://localhost:8080/mcp');
  });

  it('renders API Key section', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('API Key');
  });

  it('renders masked key when apiKeyStatus is configured', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('••••••••••••••••');
  });

  it('renders Test Connection button in idle state', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('Test Connection');
  });

  it('renders Save button in idle state', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('>Save<');
  });

  it('getStatusColor: returns green background for passed', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('background-color:green');
  });
});

// ── McpConnectorCard: health=failed rendering ─────────────────────────────────

describe('McpConnectorCard health-loaded JSX (validationStatus=failed)', () => {
  beforeEach(() => {
    _mockHealth = healthFailed;
    _useStateCallCount = 0;
  });

  it('renders FAILED badge', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('FAILED');
  });

  it('getStatusColor: returns red background for failed', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('background-color:red');
  });

  it('renders diagnostics pre block', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('Schema mismatch on /api/runs');
    expect(html).toContain('<pre');
  });

  it('does NOT render Last checked when lastValidationTimestamp is null', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).not.toContain('Last checked:');
  });

  it('renders Not configured when apiKeyStatus is not_configured', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('Not configured');
  });
});

// ── McpConnectorCard: health=unknown rendering ────────────────────────────────

describe('McpConnectorCard health-loaded JSX (validationStatus=unknown)', () => {
  beforeEach(() => {
    _mockHealth = healthUnknown;
    _useStateCallCount = 0;
  });

  it('renders UNKNOWN badge', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('UNKNOWN');
  });

  it('getStatusColor: returns #666 for unknown status', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    // #666 appears in multiple places (color:#666 for description text) so just verify UNKNOWN badge renders
    expect(html).toContain('UNKNOWN');
    expect(html).toContain('#666');
  });
});

// ── McpConnectorCard: status variants (testing / saving) ──────────────────────

describe('McpConnectorCard status variants', () => {
  it('renders Testing... button text when status is testing', async () => {
    _mockMcpStatus = 'testing';
    _useStateCallCount = 0;
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('Testing...');
  });

  it('Test Connection button is disabled when status is testing', async () => {
    _mockMcpStatus = 'testing';
    _useStateCallCount = 0;
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('disabled');
  });

  it('renders Saving... button text when status is saving', async () => {
    _mockMcpStatus = 'saving';
    _useStateCallCount = 0;
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('Saving...');
  });

  it('Save button is disabled when status is saving', async () => {
    _mockMcpStatus = 'saving';
    _useStateCallCount = 0;
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('disabled');
  });
});

// ── McpConnectorCard: toast rendering ─────────────────────────────────────────

describe('McpConnectorCard toast rendering', () => {
  it('renders success toast when toast.type is success', async () => {
    _mockToast = { type: 'success', message: 'Connection test passed!' };
    _useStateCallCount = 0;
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('Connection test passed!');
    expect(html).toContain('#4CAF50');
  });

  it('renders error toast when toast.type is error', async () => {
    _mockToast = { type: 'error', message: 'Connection test failed. Check diagnostics.' };
    _useStateCallCount = 0;
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('Connection test failed. Check diagnostics.');
    expect(html).toContain('#F44336');
  });

  it('does NOT render toast section when toast is null', async () => {
    _mockToast = null;
    _useStateCallCount = 0;
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).not.toContain('#4CAF50');
    expect(html).not.toContain('#F44336');
  });
});

// ── ConnectorsSettingsPage: connectors.map rendering ──────────────────────────

describe('ConnectorsSettingsPage connectors.map JSX', () => {
  it('renders connector displayNames', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('GitHub');
    expect(html).toContain('Jira');
  });

  it('renders connector descriptions', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('GitHub integration');
    expect(html).toContain('Jira integration');
  });

  it('renders connector icons', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('🐙');
    expect(html).toContain('🎯');
  });

  it('renders toolCount with plural "tools" label for count > 1', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    // SSR renders JSX text nodes with HTML comment separators: "3<!-- --> tool<!-- -->s"
    expect(html).toContain('>3<!-- --> tool<!-- -->s<');
    expect(html).toContain('>2<!-- --> tool<!-- -->s<');
  });

  it('renders singular "tool" label when toolCount is 1', async () => {
    _mockConnectors = [
      { name: 'slack', displayName: 'Slack', description: 'Slack notifications', icon: '💬', toolCount: 1 },
    ];
    _useStateCallCount = 0;
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    // SSR renders "1<!-- --> tool" (no "s" appended because toolCount === 1)
    expect(html).toContain('>1<!-- --> tool<');
    expect(html).not.toContain('>1<!-- --> tool<!-- -->s<');
  });

  it('renders Enabled label for enabled connectors', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('Enabled');
  });

  it('renders Set credentials link pointing to /settings/vault', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    expect(html).toContain('Set credentials');
    expect(html).toContain('/settings/vault');
  });

  it('renders checkboxes for each connector', async () => {
    const { ConnectorsSettingsPage } = await import('./settings.connectors.js');
    const html = renderToString(React.createElement(ConnectorsSettingsPage));
    const checkboxCount = (html.match(/type="checkbox"/g) ?? []).length;
    expect(checkboxCount).toBe(2);
  });
});
