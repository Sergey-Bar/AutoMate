/**
 * settings.connectors.rtl.test.tsx
 *
 * RTL tests for ConnectorsSettingsPage and McpConnectorCard that target
 * the uncovered lines:
 *  - Line 51: setStatus('loading') inside loadConnectors (triggered by mount/effect)
 *  - Line 97: setStatus('error') catch block in fetchHealth
 *
 * These require actual DOM rendering with effects running.
 */
import { render, screen, waitFor, act } from '../test/test-utils.js';
import { ConnectorsSettingsPage } from './settings.connectors.js';

describe('ConnectorsSettingsPage RTL — async loading states', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders heading and description on initial load', async () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as typeof globalThis.fetch; // never resolves

    render(<ConnectorsSettingsPage />);

    expect(screen.getByText('Connector Settings')).toBeInTheDocument();
    expect(screen.getByText(/enable connectors and bind vault credentials/i)).toBeInTheDocument();
  });

  it('shows Loading connectors... text while fetching connectors (line 61)', async () => {
    // Mock fetchHealth first, then connectors (both pending)
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as typeof globalThis.fetch;

    render(<ConnectorsSettingsPage />);

    // The outer page starts with status 'loading' while loadConnectors runs
    // Confirm: "Loading connectors..." text appears during load
    expect(screen.getByText('Loading connectors...')).toBeInTheDocument();
  });

  it('shows error when loadConnectors fails (line 62) — covers error status', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as typeof globalThis.fetch;

    await act(async () => {
      render(<ConnectorsSettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText('Failed to load connectors.')).toBeInTheDocument();
    });
  });

  it('shows connector cards after successful load', async () => {
    const connectors = [
      { name: 'github', displayName: 'GitHub', description: 'GitHub integration', icon: '🐙', toolCount: 3 },
      { name: 'slack', displayName: 'Slack', description: 'Slack webhooks', icon: '💬', toolCount: 1 },
    ];

    // fetchHealth call and connectors call - first call is fetchHealth, second is connectors
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })               // fetchHealth fails → error state for MCP
      .mockResolvedValueOnce({ ok: true, json: async () => connectors }) as typeof globalThis.fetch; // loadConnectors succeeds

    await act(async () => {
      render(<ConnectorsSettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText('🐙 GitHub')).toBeInTheDocument();
    });

    expect(screen.getByText('💬 Slack')).toBeInTheDocument();
    expect(screen.getByText('GitHub integration')).toBeInTheDocument();
    expect(screen.getByText('3 tools')).toBeInTheDocument();
  });

  it('shows Failed to load connectors error on non-ok fetch response (line 62)', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })  // fetchHealth
      .mockResolvedValueOnce({ ok: false, status: 500 }) as typeof globalThis.fetch; // loadConnectors

    await act(async () => {
      render(<ConnectorsSettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText('Failed to load connectors.')).toBeInTheDocument();
    });
  });

  it('connector checkbox toggles enabled/disabled state', async () => {
    const connectors = [
      { name: 'github', displayName: 'GitHub', description: 'GitHub integration', icon: '🐙', toolCount: 3 },
    ];

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })               // fetchHealth
      .mockResolvedValueOnce({ ok: true, json: async () => connectors }) as typeof globalThis.fetch; // loadConnectors

    await act(async () => {
      render(<ConnectorsSettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText('🐙 GitHub')).toBeInTheDocument();
    });

    // Initially enabled
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
    expect(screen.getByText('Enabled')).toBeInTheDocument();

    // Toggle off
    await act(async () => {
      checkbox.click();
    });

    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });
});

describe('McpConnectorCard RTL — health fetch states', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows Loading MCP Status... initially', async () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as typeof globalThis.fetch;

    render(<ConnectorsSettingsPage />);

    expect(screen.getByText('Loading MCP Status...')).toBeInTheDocument();
  });

  it('shows Failed to load MCP status. when fetchHealth errors — covers line 97', async () => {
    globalThis.fetch = vi.fn()
      .mockRejectedValueOnce(new Error('Connection refused'))  // fetchHealth throws
      .mockResolvedValueOnce({ ok: true, json: async () => [] }) as typeof globalThis.fetch; // loadConnectors

    await act(async () => {
      render(<ConnectorsSettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText('Failed to load MCP status.')).toBeInTheDocument();
    });
  });

  it('shows health data when fetchHealth succeeds', async () => {
    const healthData = {
      contractVersion: '2.0',
      validationStatus: 'passed',
      diagnostics: '',
      mismatches: [],
      lastValidationTimestamp: '2026-01-01T00:00:00.000Z',
      apiKeyStatus: 'configured',
      endpointUrl: 'http://localhost:8080/mcp',
    };

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => healthData }) // fetchHealth
      .mockResolvedValueOnce({ ok: true, json: async () => [] }) as typeof globalThis.fetch;         // loadConnectors

    await act(async () => {
      render(<ConnectorsSettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText(/PASSED/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Contract Version: 2.0/i)).toBeInTheDocument();
  });

  it('shows Not configured when apiKeyStatus is not_configured', async () => {
    const healthData = {
      contractVersion: '1.0',
      validationStatus: 'unknown',
      diagnostics: '',
      mismatches: [],
      lastValidationTimestamp: null,
      apiKeyStatus: 'not_configured',
      endpointUrl: '',
    };

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => healthData })
      .mockResolvedValueOnce({ ok: true, json: async () => [] }) as typeof globalThis.fetch;

    await act(async () => {
      render(<ConnectorsSettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText('Not configured')).toBeInTheDocument();
    });
  });

  it('shows Test Connection and Save buttons when health is loaded', async () => {
    const healthData = {
      contractVersion: '1.0',
      validationStatus: 'passed',
      diagnostics: '',
      mismatches: [],
      lastValidationTimestamp: null,
      apiKeyStatus: 'configured',
      endpointUrl: 'http://localhost:8080/mcp',
    };

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => healthData })
      .mockResolvedValueOnce({ ok: true, json: async () => [] }) as typeof globalThis.fetch;

    await act(async () => {
      render(<ConnectorsSettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Test Connection' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
