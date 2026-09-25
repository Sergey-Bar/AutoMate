import { useState, useEffect, useCallback } from 'react';

interface ConnectorInfo {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  toolCount: number;
}

export function VaultSettingsPage() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [credentialInputs, setCredentialInputs] = useState<Record<string, Record<string, string>>>({});
  const [saveStatus, setSaveStatus] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({});

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/vault/status');
      if (!res.ok) return;
      const data = (await res.json()) as { isUnlocked: boolean };
      setIsUnlocked(data.isUnlocked);
    } catch {
      // Vault routes may not be available
    }
  }, []);

  const loadConnectors = useCallback(async () => {
    try {
      const res = await fetch('/api/connectors');
      if (!res.ok) return;
      const data = (await res.json()) as ConnectorInfo[];
      setConnectors(data);
    } catch {
      // Connector routes may not be available
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadConnectors();
  }, [loadStatus, loadConnectors]);

  const handleUnlock = async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/vault/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const errData = (await res.json()) as { error?: string };
        throw new Error(errData.error ?? `HTTP ${res.status}`);
      }
      setIsUnlocked(true);
      setPassword('');
      setStatus('idle');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Unlock failed');
      setStatus('error');
    }
  };

  const handleLock = async () => {
    try {
      await fetch('/api/vault/lock', { method: 'POST' });
      setIsUnlocked(false);
    } catch {
      // Ignore lock errors
    }
  };

  const updateCredential = (connector: string, key: string, value: string) => {
    setCredentialInputs(prev => ({
      ...prev,
      [connector]: { ...prev[connector], [key]: value },
    }));
  };

  const saveCredentials = async (connectorName: string) => {
    setSaveStatus(prev => ({ ...prev, [connectorName]: 'saving' }));
    try {
      const res = await fetch(`/api/vault/credentials/${connectorName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: credentialInputs[connectorName] ?? {} }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveStatus(prev => ({ ...prev, [connectorName]: 'saved' }));
      setTimeout(() => setSaveStatus(prev => ({ ...prev, [connectorName]: 'idle' })), 2000);
    } catch {
      setSaveStatus(prev => ({ ...prev, [connectorName]: 'error' }));
    }
  };

  // Known credential fields per connector type
  const credentialFields: Record<string, string[]> = {
    github: ['token'],
    jira: ['host', 'email', 'apiToken'],
    slack: ['webhookUrl'],
  };

  return (
    <section style={{ maxWidth: 480, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 24 }}>Vault Settings</h1>

      <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8, marginBottom: 24 }}>
        <p style={{ fontWeight: 600, marginBottom: 8 }}>
          Status: {isUnlocked ? '🔓 Unlocked' : '🔒 Locked'}
        </p>

        {!isUnlocked ? (
          <div>
            <input
              type="password"
              placeholder="Master password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleUnlock(); }}
              style={{ width: '100%', padding: 8, marginBottom: 8 }}
            />
            <button
              type="button"
              onClick={handleUnlock}
              disabled={status === 'loading' || !password}
              style={{ padding: '8px 24px', fontWeight: 600 }}
            >
              {status === 'loading' ? 'Unlocking...' : 'Unlock Vault'}
            </button>
            {status === 'error' && (
              <p style={{ color: 'red', marginTop: 8 }}>{errorMsg}</p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={handleLock}
            style={{ padding: '8px 24px', fontWeight: 600 }}
          >
            Lock Vault
          </button>
        )}
      </div>

      {isUnlocked && connectors.length > 0 && (
        <div>
          <h2 style={{ marginBottom: 16 }}>Connector Credentials</h2>
          {connectors.map(c => {
            const fields = credentialFields[c.name] ?? ['apiKey'];
            return (
              <div key={c.name} style={{ border: '1px solid #eee', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                <h3 style={{ marginBottom: 8 }}>
                  {c.icon} {c.displayName}
                </h3>
                {fields.map(field => (
                  <div key={field} style={{ marginBottom: 8 }}>
                    <label htmlFor={`${c.name}-${field}`} style={{ display: 'block', marginBottom: 4, fontSize: 14 }}>
                      {field}
                    </label>
                    <input
                      id={`${c.name}-${field}`}
                      type="password"
                      placeholder={`Enter ${field}`}
                      value={credentialInputs[c.name]?.[field] ?? ''}
                      onChange={e => updateCredential(c.name, field, e.target.value)}
                      style={{ width: '100%', padding: 8 }}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => void saveCredentials(c.name)}
                  disabled={saveStatus[c.name] === 'saving'}
                  style={{ padding: '6px 16px', fontWeight: 600 }}
                >
                  {saveStatus[c.name] === 'saving'
                    ? 'Saving...'
                    : saveStatus[c.name] === 'saved'
                      ? 'Saved ✓'
                      : 'Save Credentials'}
                </button>
                {saveStatus[c.name] === 'error' && (
                  <p style={{ color: 'red', marginTop: 4, fontSize: 14 }}>Failed to save credentials</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default VaultSettingsPage;
