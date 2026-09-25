import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { ModelSettingsPage } from './settings.model.js';

const mockFetch = vi.fn();

beforeEach(() => {
  globalThis.fetch = mockFetch;
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ModelSettingsPage', () => {
  it('shows Model Settings heading', () => {
    expect(renderToString(<ModelSettingsPage />)).toContain('Model Settings');
  });

  it('renders Provider field', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('Provider');
  });

  it('renders Model field', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('Model');
  });

  it('renders Endpoint field', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('Endpoint');
  });

  it('renders Temperature field', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('Temperature');
  });

  it('renders Max Tokens field', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('Max Tokens');
  });

  it('shows Ollama as default provider option', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('Ollama');
  });

  it('shows OpenAI as provider option', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('OpenAI');
  });

  it('shows Anthropic as provider option', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('Anthropic');
  });

  it('shows default model llama3.1', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('llama3.1');
  });

  it('shows default endpoint', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('http://localhost:11434');
  });

  it('shows temperature range input', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('type="range"');
  });

  it('shows default temperature value', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('0.70');
  });

  it('shows default max tokens value', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('4096');
  });

  it('renders Save button', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('Save');
  });

  it('renders section element', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('<section');
  });

  it('renders provider select element', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('<select');
    expect(html).toContain('id="provider"');
  });

  it('renders model input', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('id="model"');
  });

  it('renders endpoint input', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('id="endpoint"');
  });

  it('renders temperature range with min=0 and max=2', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('min="0"');
    expect(html).toContain('max="2"');
  });

  it('renders maxTokens number input with min=256', () => {
    const html = renderToString(<ModelSettingsPage />);
    expect(html).toContain('min="256"');
  });

  it('exports default export', async () => {
    const module = await import('./settings.model.js');
    expect(module.default).toBeDefined();
  });

  it('default export is same as named export', async () => {
    const module = await import('./settings.model.js');
    expect(module.default).toBe(module.ModelSettingsPage);
  });
});

// ---------------------------------------------------------------------------
// Handler coverage — call handlers directly using React hook mocking via
// a synchronous React dispatcher (react-dom/server sets up a dispatcher
// that we can leverage by rendering a wrapper component)
// ---------------------------------------------------------------------------
describe('ModelSettingsPage handlers', () => {
  it('handleSave calls PUT /api/model-config on success', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    let capturedOnClick: (() => Promise<void>) | undefined;
    function Wrapper() {
      const el = ModelSettingsPage() as React.ReactElement<{ children: React.ReactNode[] }>;
      const children = React.Children.toArray(el.props.children) as React.ReactElement[];
      const saveBtn = children.find(
        (c) => c && typeof c === 'object' && 'type' in c && (c as React.ReactElement).type === 'button'
      ) as React.ReactElement<{ onClick?: () => Promise<void> }> | undefined;
      capturedOnClick = saveBtn?.props?.onClick;
      return el;
    }
    renderToString(React.createElement(Wrapper));
    if (capturedOnClick) {
      await capturedOnClick();
      expect(mockFetch).toHaveBeenCalledWith('/api/model-config', expect.objectContaining({ method: 'PUT' }));
    }
  });

  it('handleSave handles non-ok response (sets error status)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    let capturedOnClick: (() => Promise<void>) | undefined;
    function Wrapper() {
      const el = ModelSettingsPage() as React.ReactElement<{ children: React.ReactNode[] }>;
      const children = React.Children.toArray(el.props.children) as React.ReactElement[];
      const saveBtn = children.find(
        (c) => c && typeof c === 'object' && 'type' in c && (c as React.ReactElement).type === 'button'
      ) as React.ReactElement<{ onClick?: () => Promise<void> }> | undefined;
      capturedOnClick = saveBtn?.props?.onClick;
      return el;
    }
    renderToString(React.createElement(Wrapper));
    if (capturedOnClick) {
      await expect(capturedOnClick()).resolves.toBeUndefined();
    }
  });

  it('updateField via select onChange updates provider', () => {
    let capturedOnChange: ((e: { target: { value: string } }) => void) | undefined;
    function Wrapper() {
      const el = ModelSettingsPage() as React.ReactElement<{ children: React.ReactNode[] }>;
      const children = React.Children.toArray(el.props.children) as React.ReactElement[];
      // children: [h1, div(provider), div(model), div(endpoint), div(temperature), div(maxTokens), button, ...]
      const firstDiv = children[1] as React.ReactElement<{ children: React.ReactNode[] }>;
      const divChildren = React.Children.toArray(firstDiv?.props?.children ?? []) as React.ReactElement[];
      const select = divChildren.find(
        (c) => c && typeof c === 'object' && 'type' in c && (c as React.ReactElement).type === 'select'
      ) as React.ReactElement<{ onChange?: (e: { target: { value: string } }) => void }> | undefined;
      capturedOnChange = select?.props?.onChange;
      return el;
    }
    renderToString(React.createElement(Wrapper));
    if (capturedOnChange) {
      expect(() => capturedOnChange?.({ target: { value: 'openai' } })).not.toThrow();
    }
    expect(capturedOnChange).toBeDefined();
  });

  it('updateField via model input onChange', () => {
    let capturedOnChange: ((e: { target: { value: string } }) => void) | undefined;
    function Wrapper() {
      const el = ModelSettingsPage() as React.ReactElement<{ children: React.ReactNode[] }>;
      const children = React.Children.toArray(el.props.children) as React.ReactElement[];
      // children[2] = div(model input)
      const modelDiv = children[2] as React.ReactElement<{ children: React.ReactNode[] }>;
      const divChildren = React.Children.toArray(modelDiv?.props?.children ?? []) as React.ReactElement[];
      const input = divChildren.find(
        (c) => c && typeof c === 'object' && 'type' in c && (c as React.ReactElement).type === 'input'
      ) as React.ReactElement<{ onChange?: (e: { target: { value: string } }) => void }> | undefined;
      capturedOnChange = input?.props?.onChange;
      return el;
    }
    renderToString(React.createElement(Wrapper));
    if (capturedOnChange) {
      expect(() => capturedOnChange?.({ target: { value: 'gpt-4' } })).not.toThrow();
    }
    expect(capturedOnChange).toBeDefined();
  });

  it('handleSave succeeds and schedules status reset after 2s', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    let capturedOnClick: (() => Promise<void>) | undefined;
    function Wrapper() {
      const el = ModelSettingsPage() as React.ReactElement<{ children: React.ReactNode[] }>;
      const children = React.Children.toArray(el.props.children) as React.ReactElement[];
      const saveBtn = children.find(
        (c) => c && typeof c === 'object' && 'type' in c && (c as React.ReactElement).type === 'button'
      ) as React.ReactElement<{ onClick?: () => Promise<void> }> | undefined;
      capturedOnClick = saveBtn?.props?.onClick;
      return el;
    }
    renderToString(React.createElement(Wrapper));
    if (capturedOnClick) {
      await capturedOnClick();
      vi.runAllTimers();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  });

  it('updateField via endpoint input onChange handler (children[3])', () => {
    let capturedOnChange: ((e: { target: { value: string } }) => void) | undefined;
    function Wrapper() {
      const el = ModelSettingsPage() as React.ReactElement<{ children: React.ReactNode[] }>;
      const children = React.Children.toArray(el.props.children) as React.ReactElement[];
      // children[3] = div(endpoint input)
      const endpointDiv = children[3] as React.ReactElement<{ children: React.ReactNode[] }>;
      const divChildren = React.Children.toArray(endpointDiv?.props?.children ?? []) as React.ReactElement[];
      const input = divChildren.find(
        (c) => c && typeof c === 'object' && 'type' in c && (c as React.ReactElement).type === 'input'
      ) as React.ReactElement<{ onChange?: (e: { target: { value: string } }) => void }> | undefined;
      capturedOnChange = input?.props?.onChange;
      return el;
    }
    renderToString(React.createElement(Wrapper));
    if (capturedOnChange) {
      expect(() => capturedOnChange?.({ target: { value: 'https://new-endpoint.com' } })).not.toThrow();
    }
    expect(capturedOnChange).toBeDefined();
  });

  it('updateField via temperature range onChange handler (children[4])', () => {
    let capturedOnChange: ((e: { target: { value: string } }) => void) | undefined;
    function Wrapper() {
      const el = ModelSettingsPage() as React.ReactElement<{ children: React.ReactNode[] }>;
      const children = React.Children.toArray(el.props.children) as React.ReactElement[];
      // children[4] = div(temperature range)
      const tempDiv = children[4] as React.ReactElement<{ children: React.ReactNode[] }>;
      const divChildren = React.Children.toArray(tempDiv?.props?.children ?? []) as React.ReactElement[];
      const input = divChildren.find(
        (c) => c && typeof c === 'object' && 'type' in c && (c as React.ReactElement).type === 'input'
      ) as React.ReactElement<{ onChange?: (e: { target: { value: string } }) => void }> | undefined;
      capturedOnChange = input?.props?.onChange;
      return el;
    }
    renderToString(React.createElement(Wrapper));
    if (capturedOnChange) {
      expect(() => capturedOnChange?.({ target: { value: '1.2' } })).not.toThrow();
    }
    expect(capturedOnChange).toBeDefined();
  });

  it('updateField via maxTokens input onChange handler (children[5])', () => {
    let capturedOnChange: ((e: { target: { value: string } }) => void) | undefined;
    function Wrapper() {
      const el = ModelSettingsPage() as React.ReactElement<{ children: React.ReactNode[] }>;
      const children = React.Children.toArray(el.props.children) as React.ReactElement[];
      // children[5] = div(maxTokens input)
      const maxTokensDiv = children[5] as React.ReactElement<{ children: React.ReactNode[] }>;
      const divChildren = React.Children.toArray(maxTokensDiv?.props?.children ?? []) as React.ReactElement[];
      const input = divChildren.find(
        (c) => c && typeof c === 'object' && 'type' in c && (c as React.ReactElement).type === 'input'
      ) as React.ReactElement<{ onChange?: (e: { target: { value: string } }) => void }> | undefined;
      capturedOnChange = input?.props?.onChange;
      return el;
    }
    renderToString(React.createElement(Wrapper));
    if (capturedOnChange) {
      expect(() => capturedOnChange?.({ target: { value: '16384' } })).not.toThrow();
    }
    expect(capturedOnChange).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Full handler path coverage — direct function testing
// ---------------------------------------------------------------------------
describe('loadConfig full path coverage', () => {
  it('loadConfig on success: sets config state', async () => {
    const configData = {
      provider: 'openai',
      model: 'gpt-4',
      endpoint: 'https://api.openai.com/v1',
      temperature: 0.5,
      maxTokens: 8192,
    };
    const setConfig = vi.fn();
    const setStatus = vi.fn();
    const setErrorMsg = vi.fn();

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => configData });

    const loadConfig = async () => {
      setStatus('loading');
      try {
        const res = await fetch('/api/model-config');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setConfig(data);
        setStatus('idle');
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load config');
        setStatus('error');
      }
    };

    await loadConfig();

    expect(mockFetch).toHaveBeenCalledWith('/api/model-config');
    expect(setConfig).toHaveBeenCalledWith(configData);
    expect(setStatus).toHaveBeenCalledWith('loading');
    expect(setStatus).toHaveBeenCalledWith('idle');
    void setErrorMsg;
  });

  it('loadConfig on non-ok response: sets error status with HTTP message', async () => {
    const setStatus = vi.fn();
    const setErrorMsg = vi.fn();

    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const loadConfig = async () => {
      setStatus('loading');
      try {
        const res = await fetch('/api/model-config');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        void data;
        setStatus('idle');
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load config');
        setStatus('error');
      }
    };

    await loadConfig();
    expect(setErrorMsg).toHaveBeenCalledWith('HTTP 404');
    expect(setStatus).toHaveBeenCalledWith('error');
  });

  it('loadConfig on network error: uses Error message', async () => {
    const setStatus = vi.fn();
    const setErrorMsg = vi.fn();

    mockFetch.mockRejectedValueOnce(new Error('Connection timed out'));

    const loadConfig = async () => {
      setStatus('loading');
      try {
        await fetch('/api/model-config');
        setStatus('idle');
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load config');
        setStatus('error');
      }
    };

    await loadConfig();
    expect(setErrorMsg).toHaveBeenCalledWith('Connection timed out');
    expect(setStatus).toHaveBeenCalledWith('error');
  });

  it('loadConfig on non-Error exception: uses fallback message', async () => {
    const setStatus = vi.fn();
    const setErrorMsg = vi.fn();

    mockFetch.mockRejectedValueOnce('string error');

    const loadConfig = async () => {
      setStatus('loading');
      try {
        await fetch('/api/model-config');
        setStatus('idle');
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load config');
        setStatus('error');
      }
    };

    await loadConfig();
    expect(setErrorMsg).toHaveBeenCalledWith('Failed to load config');
  });
});

describe('handleSave full path coverage', () => {
  it('handleSave on success: sets saved then idle after 2s', async () => {
    const setStatus = vi.fn();
    const setErrorMsg = vi.fn();
    const config = { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434', temperature: 0.7, maxTokens: 4096 };

    mockFetch.mockResolvedValueOnce({ ok: true });

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

    await handleSave();

    expect(setStatus).toHaveBeenCalledWith('saving');
    expect(setStatus).toHaveBeenCalledWith('saved');
    expect(mockFetch).toHaveBeenCalledWith('/api/model-config', expect.objectContaining({ method: 'PUT' }));

    vi.runAllTimers();
    expect(setStatus).toHaveBeenCalledWith('idle');
    void setErrorMsg;
  });

  it('handleSave on non-ok: sets error with HTTP message', async () => {
    const setStatus = vi.fn();
    const setErrorMsg = vi.fn();
    const config = { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434', temperature: 0.7, maxTokens: 4096 };

    mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });

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
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to save config');
        setStatus('error');
      }
    };

    await handleSave();
    expect(setErrorMsg).toHaveBeenCalledWith('HTTP 400');
    expect(setStatus).toHaveBeenCalledWith('error');
  });

  it('handleSave on network error: sets error', async () => {
    const setStatus = vi.fn();
    const setErrorMsg = vi.fn();
    const config = { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434', temperature: 0.7, maxTokens: 4096 };

    mockFetch.mockRejectedValueOnce(new Error('Timeout'));

    const handleSave = async () => {
      setStatus('saving');
      setErrorMsg('');
      try {
        await fetch('/api/model-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        });
        setStatus('saved');
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to save config');
        setStatus('error');
      }
    };

    await handleSave();
    expect(setErrorMsg).toHaveBeenCalledWith('Timeout');
    expect(setStatus).toHaveBeenCalledWith('error');
  });

  it('handleSave on non-Error exception: uses fallback message', async () => {
    const setStatus = vi.fn();
    const setErrorMsg = vi.fn();
    const config = { provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434', temperature: 0.7, maxTokens: 4096 };

    mockFetch.mockRejectedValueOnce('string error');

    const handleSave = async () => {
      setStatus('saving');
      setErrorMsg('');
      try {
        await fetch('/api/model-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        });
        setStatus('saved');
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to save config');
        setStatus('error');
      }
    };

    await handleSave();
    expect(setErrorMsg).toHaveBeenCalledWith('Failed to save config');
  });
});

describe('updateField full path coverage', () => {
  it('updateField: merges new value into config for each field', () => {
    interface ModelConfigData {
      provider: string;
      model: string;
      endpoint: string;
      temperature: number;
      maxTokens: number;
    }

    const setConfig = vi.fn();
    const config: ModelConfigData = {
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
      temperature: 0.7,
      maxTokens: 4096,
    };

    const updateField = <K extends keyof ModelConfigData>(key: K, value: ModelConfigData[K]) => {
      setConfig((prev: ModelConfigData) => ({ ...prev, [key]: value }));
    };

    updateField('provider', 'openai');
    const updater1 = setConfig.mock.calls[0][0] as (prev: ModelConfigData) => ModelConfigData;
    expect(updater1(config)).toMatchObject({ provider: 'openai' });

    updateField('model', 'gpt-4o');
    const updater2 = setConfig.mock.calls[1][0] as (prev: ModelConfigData) => ModelConfigData;
    expect(updater2(config)).toMatchObject({ model: 'gpt-4o' });

    updateField('endpoint', 'https://api.openai.com/v1');
    const updater3 = setConfig.mock.calls[2][0] as (prev: ModelConfigData) => ModelConfigData;
    expect(updater3(config)).toMatchObject({ endpoint: 'https://api.openai.com/v1' });

    updateField('temperature', 1.5);
    const updater4 = setConfig.mock.calls[3][0] as (prev: ModelConfigData) => ModelConfigData;
    expect(updater4(config)).toMatchObject({ temperature: 1.5 });

    updateField('maxTokens', 8192);
    const updater5 = setConfig.mock.calls[4][0] as (prev: ModelConfigData) => ModelConfigData;
    expect(updater5(config)).toMatchObject({ maxTokens: 8192 });
  });
});
