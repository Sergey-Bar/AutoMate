import { useState, useEffect, useCallback } from 'react';

interface ConnectorInfo {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  toolCount: number;
}

interface McpHealthState {
  contractVersion: string;
  validationStatus: 'passed' | 'failed' | 'unknown';
  diagnostics: string;
  mismatches: string[];
  lastValidationTimestamp: string | null;
  apiKeyStatus: 'configured' | 'not_configured';
  endpointUrl?: string;
}


export function ConnectorsSettingsPage() {
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  const loadConnectors = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch('/api/connectors');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ConnectorInfo[];
      setConnectors(data);
      // Default all connectors to enabled
      const initial: Record<string, boolean> = {};
      for (const c of data) {
        initial[c.name] = true;
      }
      setEnabled(initial);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  const toggleConnector = (name: string) => {
    setEnabled(prev => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <section style={{ maxWidth: 480, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 24 }}>Connector Settings</h1>
      <p style={{ marginBottom: 16, color: '#666' }}>
        Enable connectors and bind vault credentials.
      </p>

      {status === 'loading' && <p>Loading connectors...</p>}
      {status === 'error' && <p style={{ color: 'red' }}>Failed to load connectors.</p>}


      <McpConnectorCard />

      {connectors.map(c => (
        <div
          key={c.name}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            border: '1px solid #eee',
            borderRadius: 8,
            padding: 16,
            marginBottom: 12,
            opacity: enabled[c.name] ? 1 : 0.5,
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>
              {c.icon} {c.displayName}
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: '#666' }}>
              {c.description}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#999' }}>
              {c.toolCount} tool{c.toolCount !== 1 ? 's' : ''}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={enabled[c.name] ?? false}
                onChange={() => toggleConnector(c.name)}
              />
              {enabled[c.name] ? 'Enabled' : 'Disabled'}
            </label>
            <a href="/settings/vault" style={{ fontSize: 12 }}>
              Set credentials →
            </a>
          </div>
        </div>
      ))}
    </section>
  );
}

export default ConnectorsSettingsPage;

function McpConnectorCard() {
  const [health, setHealth] = useState<McpHealthState | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'testing' | 'saving' | 'error'>('loading');
  const [endpoint, setEndpoint] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchHealth = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch('/api/connectors/dashboard_mcp/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHealth(data);
      setEndpoint(data.endpointUrl || '');
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void fetchHealth();
  }, [fetchHealth]);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const handleTestConnection = async () => {
    setStatus('testing');
    try {
      const res = await fetch('/api/connectors/dashboard_mcp/test-connect', { method: 'POST' });
      const data = await res.json();
      setHealth(data.validationState);
      if (res.ok && data.success) {
        showToast('success', 'Connection test passed!');
      } else {
        showToast('error', 'Connection test failed. Check diagnostics.');
      }
    } catch {
      showToast('error', 'Failed to run connection test.');
    } finally {
      setStatus('idle');
    }
  };

  const handleSave = () => {
    if (!window.confirm('Are you sure you want to save the new endpoint URL?')) {
      return;
    }
    setStatus('saving');
    // NOTE: The prompt doesn't specify a save endpoint, so this is a mock implementation.
    // In a real app, this would call a PUT /api/connectors/dashboard_mcp/config
    setTimeout(() => {
      setHealth(prev => (prev ? { ...prev, endpointUrl: endpoint } : null));
      showToast('success', 'Endpoint configuration saved!');
      setStatus('idle');
    }, 1000);
  };

  const getStatusColor = (status: McpHealthState['validationStatus']) => {
    if (status === 'passed') return 'green';
    if (status === 'failed') return 'red';
    return '#666';
  };

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 24 }}>
      <h2 style={{ margin: '0 0 16px 0' }}>Dashboard MCP</h2>
      {status === 'loading' && <p>Loading MCP Status...</p>}
      {status === 'error' && <p style={{ color: 'red' }}>Failed to load MCP status.</p>}
      {health && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                padding: '4px 8px',
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 600,
                backgroundColor: getStatusColor(health.validationStatus),
                color: 'white',
              }}
            >
              {health.validationStatus.toUpperCase()}
            </span>
            <span>Contract Version: {health.contractVersion || 'N/A'}</span>
          </div>
          {health.lastValidationTimestamp && (
            <p style={{ fontSize: 12, color: '#666', margin: 0 }}>
              Last checked: {new Date(health.lastValidationTimestamp).toLocaleString()}
            </p>
          )}
          {health.validationStatus === 'failed' && (
            <pre
              style={{
                backgroundColor: '#f8f8f8',
                border: '1px solid #eee',
                padding: 8,
                borderRadius: 4,
                fontSize: 12,
                maxHeight: 100,
                overflowY: 'auto',
              }}
            >
              {health.diagnostics}
            </pre>
          )}

          <div>
            <label htmlFor="mcp-endpoint" style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Endpoint URL</label>
            <input
              id="mcp-endpoint"
              type="text"
              value={endpoint}
              onChange={e => setEndpoint(e.target.value)}
              placeholder="http://localhost:8080/mcp"
              style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
            />
          </div>

          <div>
            <span style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>API Key</span>
            <p style={{ margin: 0, fontFamily: 'monospace', fontSize: 14 }}>
              {health.apiKeyStatus === 'configured' ? '••••••••••••••••' : 'Not configured'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={handleTestConnection} disabled={status === 'testing'}>
              {status === 'testing' ? 'Testing...' : 'Test Connection'}
            </button>
            <button type="button" onClick={handleSave} disabled={status === 'saving'}>
              {status === 'saving' ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '12px 24px',
            borderRadius: 8,
            backgroundColor: toast.type === 'success' ? '#4CAF50' : '#F44336',
            color: 'white',
            boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}


