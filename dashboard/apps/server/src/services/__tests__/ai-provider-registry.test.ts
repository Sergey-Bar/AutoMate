/**
 * apps/server/src/services/__tests__/ai-provider-registry.test.ts
 *
 * Tests for the provider registry: adapter lookup, validate(), createCompletion()
 * request shapes, and Tier 3 bedrock NotConfigured behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiProviderConfig } from '@automate/dashboard-shared';
import { ProviderRegistry, providerRegistry } from '../ai-provider-registry.js';

// ── fetch mock ────────────────────────────────────────────────────────────────

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOpenAiResponse(content: string) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

function makeAnthropicResponse(text: string) {
  return {
    ok: true,
    json: async () => ({ content: [{ text }] }),
  };
}

function makeErrorResponse(status: number, statusText: string) {
  return { ok: false, status, statusText };
}

// ── Registry ──────────────────────────────────────────────────────────────────

describe('ProviderRegistry', () => {
  it('returns undefined for an unregistered provider', () => {
    const reg = new ProviderRegistry();
    expect(reg.getAdapter('nonexistent')).toBeUndefined();
  });

  it('register() stores an adapter and getAdapter() retrieves it', () => {
    const reg = new ProviderRegistry();
    const adapter = { name: 'test', validate: () => true, createCompletion: async () => 'ok' };
    reg.register(adapter);
    expect(reg.getAdapter('test')).toBe(adapter);
  });

  it('register() returns this for chaining', () => {
    const reg = new ProviderRegistry();
    const result = reg.register({ name: 'a', validate: () => true, createCompletion: async () => 'x' });
    expect(result).toBe(reg);
  });

  it('getRegisteredProviders() lists all registered provider names', () => {
    const providers = providerRegistry.getRegisteredProviders();
    expect(providers).toEqual(
      expect.arrayContaining(['ollama', 'openai', 'anthropic', 'google', 'azure-openai', 'groq', 'mistral', 'openrouter', 'cohere', 'bedrock']),
    );
  });

  it('singleton providerRegistry has an adapter for every AiProvider value', () => {
    const expected = ['ollama', 'openai', 'anthropic', 'google', 'azure-openai', 'groq', 'mistral', 'openrouter', 'cohere', 'bedrock'];
    for (const name of expected) {
      expect(providerRegistry.getAdapter(name)).toBeDefined();
    }
  });
});

// ── validate() ────────────────────────────────────────────────────────────────

describe('adapter.validate()', () => {
  const providerNames = ['ollama', 'openai', 'anthropic', 'google', 'azure-openai', 'groq', 'mistral', 'openrouter', 'cohere', 'bedrock'];

  it.each(providerNames)('%s adapter returns true for its own provider', (name) => {
    const adapter = providerRegistry.getAdapter(name)!;
    expect(adapter.validate({ provider: name } as unknown as AiProviderConfig)).toBe(true);
  });

  it.each(providerNames)('%s adapter returns false for a different provider', (name) => {
    const adapter = providerRegistry.getAdapter(name)!;
    const other = providerNames.find((n) => n !== name)!;
    expect(adapter.validate({ provider: other } as unknown as AiProviderConfig)).toBe(false);
  });
});

// ── Tier 1 — Ollama ───────────────────────────────────────────────────────────

describe('OllamaAdapter', () => {
  const config: AiProviderConfig = { provider: 'ollama', model: 'llama3.1:8b' };
  const adapter = providerRegistry.getAdapter('ollama')!;

  it('calls the default local endpoint with OpenAI-compatible body (no auth header)', async () => {
    fetchMock.mockResolvedValue(makeOpenAiResponse('Ollama says hello test'));

    const result = await adapter.createCompletion('diagnose failure', config);

    expect(result).toBe('Ollama says hello test');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, opts] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['Authorization']).toBeUndefined();

    const body = JSON.parse(opts.body) as { model: string; messages: unknown[]; temperature: number; max_tokens: number };
    expect(body.model).toBe('llama3.1:8b');
    expect(body.messages).toHaveLength(2);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(500);
  });

  it('uses a custom baseUrl when provided', async () => {
    const customConfig: AiProviderConfig = { provider: 'ollama', model: 'mistral', baseUrl: 'http://ollama.internal:8080' };
    fetchMock.mockResolvedValue(makeOpenAiResponse('custom base test'));

    await adapter.createCompletion('prompt', customConfig);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://ollama.internal:8080/v1/chat/completions');
  });

  it('returns "No response from AI" when choices is empty', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) });
    const result = await adapter.createCompletion('p', config);
    expect(result).toBe('No response from AI');
  });

  it('throws when the API returns a non-OK status', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(503, 'Service Unavailable'));
    await expect(adapter.createCompletion('p', config)).rejects.toThrow('AI API error: 503 Service Unavailable');
  });

  it('throws for wrong provider config', async () => {
    await expect(adapter.createCompletion('p', { provider: 'openai', model: 'x', apiKey: 'k' })).rejects.toThrow(
      'Invalid config for ollama adapter',
    );
  });
});

// ── Tier 1 — OpenAI ───────────────────────────────────────────────────────────

describe('OpenAiAdapter', () => {
  const config: AiProviderConfig = { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test-key' };
  const adapter = providerRegistry.getAdapter('openai')!;

  it('calls the default OpenAI endpoint with Bearer auth and correct body', async () => {
    fetchMock.mockResolvedValue(makeOpenAiResponse('openai result for test'));

    const result = await adapter.createCompletion('diagnose', config);

    expect(result).toBe('openai result for test');

    const [url, opts] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(opts.headers['Authorization']).toBe('Bearer sk-test-key');
    expect(opts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(opts.body) as { model: string; messages: Array<{ role: string; content: string }> };
    expect(body.model).toBe('gpt-4o');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('test automation expert');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toBe('diagnose');
  });

  it('respects a custom baseUrl', async () => {
    const customConfig: AiProviderConfig = { provider: 'openai', model: 'gpt-4o', apiKey: 'k', baseUrl: 'https://proxy.example.com' };
    fetchMock.mockResolvedValue(makeOpenAiResponse('proxied test'));

    await adapter.createCompletion('p', customConfig);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://proxy.example.com/v1/chat/completions');
  });

  it('throws on API error', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(401, 'Unauthorized'));
    await expect(adapter.createCompletion('p', config)).rejects.toThrow('AI API error: 401 Unauthorized');
  });

  it('throws for wrong provider config', async () => {
    await expect(adapter.createCompletion('p', { provider: 'ollama', model: 'x' })).rejects.toThrow(
      'Invalid config for openai adapter',
    );
  });
});

// ── Tier 1 — Anthropic ────────────────────────────────────────────────────────

describe('AnthropicAdapter', () => {
  const config: AiProviderConfig = { provider: 'anthropic', model: 'claude-3-5-sonnet', apiKey: 'ant-key-xyz' };
  const adapter = providerRegistry.getAdapter('anthropic')!;

  it('calls the Anthropic messages endpoint with correct headers and body shape', async () => {
    fetchMock.mockResolvedValue(makeAnthropicResponse('anthropic result from test'));

    const result = await adapter.createCompletion('analyze failure', config);

    expect(result).toBe('anthropic result from test');

    const [url, opts] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('ant-key-xyz');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['Authorization']).toBeUndefined();

    const body = JSON.parse(opts.body) as {
      model: string;
      system: string;
      messages: Array<{ role: string; content: string }>;
      max_tokens: number;
    };
    expect(body.model).toBe('claude-3-5-sonnet');
    expect(body.system).toContain('test automation expert');
    expect(body.messages).toEqual([{ role: 'user', content: 'analyze failure' }]);
    expect(body.max_tokens).toBe(500);
  });

  it('returns "No response from AI" when content array is empty', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ content: [] }) });
    const result = await adapter.createCompletion('p', config);
    expect(result).toBe('No response from AI');
  });

  it('throws on non-OK response', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(429, 'Too Many Requests'));
    await expect(adapter.createCompletion('p', config)).rejects.toThrow('AI API error: 429 Too Many Requests');
  });

  it('throws for wrong provider config', async () => {
    await expect(adapter.createCompletion('p', { provider: 'openai', model: 'x', apiKey: 'k' })).rejects.toThrow(
      'Invalid config for anthropic adapter',
    );
  });
});

// ── Tier 2 — Google ───────────────────────────────────────────────────────────

describe('GoogleAdapter', () => {
  const config: AiProviderConfig = { provider: 'google', model: 'gemini-1.5-pro', apiKey: 'google-key' };
  const adapter = providerRegistry.getAdapter('google')!;

  it('calls the Google generativelanguage endpoint with Bearer auth', async () => {
    fetchMock.mockResolvedValue(makeOpenAiResponse('google test result'));

    await adapter.createCompletion('p', config);

    const [url, opts] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(opts.headers['Authorization']).toBe('Bearer google-key');
  });

  it('throws for wrong provider config', async () => {
    await expect(adapter.createCompletion('p', { provider: 'openai', model: 'x', apiKey: 'k' })).rejects.toThrow(
      'Invalid config for google adapter',
    );
  });
});

// ── Tier 2 — Azure OpenAI ─────────────────────────────────────────────────────

describe('AzureOpenAiAdapter', () => {
  const config: AiProviderConfig = {
    provider: 'azure-openai',
    model: 'gpt-4o',
    apiKey: 'azure-key',
    baseUrl: 'https://my-resource.openai.azure.com',
    apiVersion: '2024-02-01',
  };
  const adapter = providerRegistry.getAdapter('azure-openai')!;

  it('builds the deployment URL with api-version query param and uses api-key header', async () => {
    fetchMock.mockResolvedValue(makeOpenAiResponse('azure test result'));

    await adapter.createCompletion('prompt', config);

    const [url, opts] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://my-resource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-02-01');
    expect(opts.headers['api-key']).toBe('azure-key');
    expect(opts.headers['Authorization']).toBeUndefined();

    const body = JSON.parse(opts.body) as { messages: unknown[] };
    expect(body.messages).toHaveLength(2);
  });

  it('throws for wrong provider config', async () => {
    await expect(adapter.createCompletion('p', { provider: 'openai', model: 'x', apiKey: 'k' })).rejects.toThrow(
      'Invalid config for azure-openai adapter',
    );
  });
});

// ── Tier 2 — Groq ─────────────────────────────────────────────────────────────

describe('GroqAdapter', () => {
  const config: AiProviderConfig = { provider: 'groq', model: 'llama3-8b-8192', apiKey: 'groq-key' };
  const adapter = providerRegistry.getAdapter('groq')!;

  it('calls the Groq OpenAI-compatible endpoint with Bearer auth', async () => {
    fetchMock.mockResolvedValue(makeOpenAiResponse('groq test result'));

    await adapter.createCompletion('p', config);

    const [url, opts] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(opts.headers['Authorization']).toBe('Bearer groq-key');
  });

  it('throws for wrong provider config', async () => {
    await expect(adapter.createCompletion('p', { provider: 'openai', model: 'x', apiKey: 'k' })).rejects.toThrow(
      'Invalid config for groq adapter',
    );
  });
});

// ── Tier 2 — Mistral ──────────────────────────────────────────────────────────

describe('MistralAdapter', () => {
  const config: AiProviderConfig = { provider: 'mistral', model: 'mistral-large', apiKey: 'mistral-key' };
  const adapter = providerRegistry.getAdapter('mistral')!;

  it('calls the Mistral API endpoint with Bearer auth', async () => {
    fetchMock.mockResolvedValue(makeOpenAiResponse('mistral test result'));

    await adapter.createCompletion('p', config);

    const [url, opts] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(opts.headers['Authorization']).toBe('Bearer mistral-key');
  });

  it('throws for wrong provider config', async () => {
    await expect(adapter.createCompletion('p', { provider: 'openai', model: 'x', apiKey: 'k' })).rejects.toThrow(
      'Invalid config for mistral adapter',
    );
  });
});

// ── Tier 2 — OpenRouter ───────────────────────────────────────────────────────

describe('OpenRouterAdapter', () => {
  const config: AiProviderConfig = { provider: 'openrouter', model: 'openai/gpt-4o', apiKey: 'or-key' };
  const adapter = providerRegistry.getAdapter('openrouter')!;

  it('calls the OpenRouter endpoint with Bearer auth', async () => {
    fetchMock.mockResolvedValue(makeOpenAiResponse('openrouter test result'));

    await adapter.createCompletion('p', config);

    const [url, opts] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(opts.headers['Authorization']).toBe('Bearer or-key');
  });

  it('throws for wrong provider config', async () => {
    await expect(adapter.createCompletion('p', { provider: 'openai', model: 'x', apiKey: 'k' })).rejects.toThrow(
      'Invalid config for openrouter adapter',
    );
  });
});

// ── Tier 2 — Cohere ───────────────────────────────────────────────────────────

describe('CohereAdapter', () => {
  const config: AiProviderConfig = { provider: 'cohere', model: 'command-r-plus', apiKey: 'co-key' };
  const adapter = providerRegistry.getAdapter('cohere')!;

  it('calls the Cohere compatibility endpoint with Bearer auth', async () => {
    fetchMock.mockResolvedValue(makeOpenAiResponse('cohere test result'));

    await adapter.createCompletion('p', config);

    const [url, opts] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://api.cohere.com/compatibility/v1/chat/completions');
    expect(opts.headers['Authorization']).toBe('Bearer co-key');
  });

  it('throws for wrong provider config', async () => {
    await expect(adapter.createCompletion('p', { provider: 'openai', model: 'x', apiKey: 'k' })).rejects.toThrow(
      'Invalid config for cohere adapter',
    );
  });
});

// ── Tier 3 — Bedrock ──────────────────────────────────────────────────────────

describe('BedrockAdapter', () => {
  const config: AiProviderConfig = {
    provider: 'bedrock',
    model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    accessKeyId: 'AKID',
    secretAccessKey: 'secret',
    region: 'us-east-1',
  };
  const adapter = providerRegistry.getAdapter('bedrock')!;

  it('throws NotConfigured error without making any network call', async () => {
    await expect(adapter.createCompletion('p', config)).rejects.toThrow('Bedrock provider is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validate() returns true for bedrock config', () => {
    expect(adapter.validate(config)).toBe(true);
  });
});

// ── Cross-adapter: OpenAI-compat request body shape ───────────────────────────

describe('Tier 2 OpenAI-compatible request body shape', () => {
  const tier2Providers = [
    { provider: 'google' as const, key: 'google-key', model: 'gemini' },
    { provider: 'groq' as const, key: 'groq-key', model: 'llama3' },
    { provider: 'mistral' as const, key: 'mistral-key', model: 'mistral-large' },
    { provider: 'openrouter' as const, key: 'or-key', model: 'gpt-4o' },
    { provider: 'cohere' as const, key: 'co-key', model: 'command-r' },
  ];

  it.each(tier2Providers)('$provider sends OpenAI-compatible body with system message', async ({ provider, key, model }) => {
    fetchMock.mockResolvedValue(makeOpenAiResponse(`${provider} test ok`));

    const config = { provider, model, apiKey: key } as AiProviderConfig;
    const adapter = providerRegistry.getAdapter(provider)!;

    await adapter.createCompletion('test prompt', config);

    const [, opts] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(opts.body) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      temperature: number;
      max_tokens: number;
    };

    expect(body.model).toBe(model);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('test automation expert');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toBe('test prompt');
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(500);

    fetchMock.mockClear();
  });
});
