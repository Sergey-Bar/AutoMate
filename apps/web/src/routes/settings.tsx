import React, { useState, useEffect } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as rootRoute } from './__root.js';
import { defaultApiClient, type ModelConfig } from '../lib/api.js';

export function parseFiniteTemperatureInput(rawValue: string): number | null {
  if (rawValue.trim() === '') return null;
  const value = parseFloat(rawValue);
  return Number.isFinite(value) ? value : null;
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsComponent,
});

function SettingsComponent() {
  const [config, setConfig] = useState<ModelConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [temperatureError, setTemperatureError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await defaultApiClient.getModelConfig();
      setConfig(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;

    if (temperatureError || !Number.isFinite(config.temperature)) {
      setError('Temperature must be a valid number between 0 and 2');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccess(false);
      const data = await defaultApiClient.updateModelConfig(config);
      setConfig(data);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="settings-page" className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      
      {loading ? (
        <p>Loading configuration...</p>
      ) : config ? (
        <form onSubmit={handleSave} className="space-y-4">
          {error && <div className="bg-red-100 text-red-700 p-3 rounded">{error}</div>}
          {success && <div className="bg-green-100 text-green-700 p-3 rounded">Settings saved successfully!</div>}
          
          <div>
            <label className="block text-sm font-medium mb-1">Model Name</label>
            <input
              type="text"
              data-testid="model-input"
              className="w-full border rounded p-2"
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Temperature</label>
            <input
              type="number"
              data-testid="temperature-input"
              step="0.1"
              min="0"
              max="2"
              className="w-full border rounded p-2"
              value={config.temperature}
              onChange={(e) => {
                const value = parseFiniteTemperatureInput(e.target.value);
                if (value === null) {
                  setTemperatureError('Temperature must be a valid number between 0 and 2');
                  return;
                }
                setTemperatureError(null);
                setError(null);
                setConfig({ ...config, temperature: value });
              }}
              required
            />
          </div>
          
          <button
            type="submit"
            data-testid="save-settings"
            className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </form>
      ) : (
        <div>
          <p>Failed to load configuration.</p>
          {error && <p className="text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
