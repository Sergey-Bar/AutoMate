import { useState, useEffect, useCallback } from 'react';

interface ModelConfigData {
  provider: string;
  model: string;
  endpoint: string;
  temperature: number;
  maxTokens: number;
}

export function ModelSettingsPage() {
  const [config, setConfig] = useState<ModelConfigData>({
    provider: 'ollama',
    model: 'llama3.1',
    endpoint: 'http://localhost:11434',
    temperature: 0.7,
    maxTokens: 4096,
  });
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const loadConfig = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch('/api/model-config');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ModelConfigData;
      setConfig(data);
      setStatus('idle');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load config');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const handleSave = async () => {
    setStatus('saving');
    setErrorMsg('');
    try {
      const res = await fetch('/api/model-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save config');
      setStatus('error');
    }
  };

  const updateField = <K extends keyof ModelConfigData>(key: K, value: ModelConfigData[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  return (
    <section style={{ maxWidth: 480, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 24 }}>Model Settings</h1>

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="provider" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Provider</label>
        <select
          id="provider"
          value={config.provider}
          onChange={e => updateField('provider', e.target.value)}
          style={{ width: '100%', padding: 8 }}
        >
          <option value="ollama">Ollama</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="model" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Model</label>
        <input
          id="model"
          type="text"
          value={config.model}
          onChange={e => updateField('model', e.target.value)}
          style={{ width: '100%', padding: 8 }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="endpoint" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Endpoint</label>
        <input
          id="endpoint"
          type="text"
          value={config.endpoint}
          onChange={e => updateField('endpoint', e.target.value)}
          style={{ width: '100%', padding: 8 }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="temperature" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
          Temperature: {config.temperature.toFixed(2)}
        </label>
        <input
          id="temperature"
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={config.temperature}
          onChange={e => updateField('temperature', Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: 24 }}>
        <label htmlFor="maxTokens" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Max Tokens</label>
        <input
          id="maxTokens"
          type="number"
          min={256}
          max={128000}
          step={256}
          value={config.maxTokens}
          onChange={e => updateField('maxTokens', Number(e.target.value))}
          style={{ width: '100%', padding: 8 }}
        />
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={status === 'saving' || status === 'loading'}
        style={{ padding: '8px 24px', fontWeight: 600 }}
      >
        {status === 'saving' ? 'Saving...' : status === 'saved' ? 'Saved ✓' : 'Save'}
      </button>

      {status === 'error' && (
        <p style={{ color: 'red', marginTop: 8 }}>{errorMsg}</p>
      )}
    </section>
  );
}

export default ModelSettingsPage;
