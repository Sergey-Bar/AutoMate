import { afterEach, describe, expect, it, vi } from 'vitest';

const createOllamaMock = vi.hoisted(() =>
  vi.fn((opts: { baseURL: string }) => (modelId: string) => ({ provider: 'ollama', modelId, baseURL: opts.baseURL })),
);
const ollamaMock = vi.hoisted(() =>
  vi.fn((modelId: string) => ({ provider: 'legacy-ollama', modelId })),
);
const openaiMock = vi.hoisted(() =>
  vi.fn((modelId: string) => ({ provider: 'openai', modelId })),
);
const openAIClientMock = vi.hoisted(() =>
  vi.fn((modelId: string) => ({ provider: 'openai-compat', modelId })),
);
const createOpenAIMock = vi.hoisted(() => vi.fn((_opts: unknown) => openAIClientMock));
const anthropicMock = vi.hoisted(() =>
  vi.fn((modelId: string) => ({ provider: 'anthropic', modelId })),
);

vi.mock('ollama-ai-provider-v2', () => ({
  createOllama: createOllamaMock,
  ollama: ollamaMock,
}));

vi.mock('@ai-sdk/openai', () => ({
  openai: openaiMock,
  createOpenAI: createOpenAIMock,
}));

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: anthropicMock,
}));

import {
  ProviderNotConfiguredError,
  SUPPORTED_PROVIDERS,
  UnsupportedProviderError,
  createModelForProvider,
  isSupportedProvider,
  validateModelConfig,
} from './providers.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('providers', () => {
  // ── SUPPORTED_PROVIDERS constant ────────────────────────────────────────────

  it('SUPPORTED_PROVIDERS lists all 10 registered providers', () => {
    expect(SUPPORTED_PROVIDERS).toEqual([
      'ollama',
      'openai',
      'anthropic',
      'google',
      'azure-openai',
      'groq',
      'mistral',
      'openrouter',
      'cohere',
      'bedrock',
    ]);
  });

  // ── isSupportedProvider ─────────────────────────────────────────────────────

  it('isSupportedProvider returns true for all supported providers', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(isSupportedProvider(provider)).toBe(true);
    }
  });

  it('isSupportedProvider returns false for unknown providers', () => {
    expect(isSupportedProvider('unknown-llm')).toBe(false);
    expect(isSupportedProvider('')).toBe(false);
    expect(isSupportedProvider('chatgpt')).toBe(false);
  });

  // ── createModelForProvider: Tier 1 success paths ────────────────────────────

  it('createModelForProvider succeeds for ollama config', () => {
    const model = createModelForProvider({
      provider: 'ollama',
      model: 'llama3.1:8b',
      endpoint: 'http://localhost:11434/',
    });

    expect(model).toEqual({
      provider: 'ollama',
      modelId: 'llama3.1:8b',
      baseURL: 'http://localhost:11434/api',
    });
  });

  it('createModelForProvider succeeds for openai config', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    const model = createModelForProvider({
      provider: 'openai',
      model: 'gpt-4o-mini',
      endpoint: 'https://api.openai.com/v1',
    });

    expect(openaiMock).toHaveBeenCalledWith('gpt-4o-mini');
    expect(model).toEqual({ provider: 'openai', modelId: 'gpt-4o-mini' });
  });

  it('createModelForProvider succeeds for anthropic config', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const model = createModelForProvider({
      provider: 'anthropic',
      model: 'claude-3-5-haiku-20241022',
      endpoint: 'https://api.anthropic.com',
    });

    expect(anthropicMock).toHaveBeenCalledWith('claude-3-5-haiku-20241022');
    expect(model).toEqual({ provider: 'anthropic', modelId: 'claude-3-5-haiku-20241022' });
  });

  // ── createModelForProvider: Tier 2 success path ─────────────────────────────

  it('createModelForProvider succeeds for groq when GROQ_API_KEY is set', () => {
    vi.stubEnv('GROQ_API_KEY', 'gsk-test');
    const model = createModelForProvider({
      provider: 'groq',
      model: 'llama3-8b-8192',
      endpoint: 'https://api.groq.com',
    });

    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.groq.com/openai/v1', apiKey: 'gsk-test' }),
    );
    expect(model).toEqual({ provider: 'openai-compat', modelId: 'llama3-8b-8192' });
  });

  // ── createModelForProvider: error paths ─────────────────────────────────────

  it('createModelForProvider throws UnsupportedProviderError for truly unknown provider', () => {
    expect(() =>
      createModelForProvider({
        provider: 'unknown-llm',
        model: 'some-model',
        endpoint: 'https://example.com',
      }),
    ).toThrowError(UnsupportedProviderError);

    expect(() =>
      createModelForProvider({
        provider: 'unknown-llm',
        model: 'some-model',
        endpoint: 'https://example.com',
      }),
    ).toThrow('Unsupported provider: unknown-llm');
  });

  it('createModelForProvider throws ProviderNotConfiguredError when API key is missing', () => {
    delete process.env.GROQ_API_KEY;
    expect(() =>
      createModelForProvider({
        provider: 'groq',
        model: 'llama3-8b-8192',
        endpoint: 'https://api.groq.com',
      }),
    ).toThrowError(ProviderNotConfiguredError);
  });

  it('createModelForProvider throws ProviderNotConfiguredError for not-yet-available providers', () => {
    expect(() =>
      createModelForProvider({
        provider: 'google',
        model: 'gemini-pro',
        endpoint: 'https://generativelanguage.googleapis.com',
      }),
    ).toThrowError(ProviderNotConfiguredError);
  });

  // ── validateModelConfig ─────────────────────────────────────────────────────

  it('validateModelConfig returns valid for ollama config', () => {
    expect(
      validateModelConfig({
        provider: 'ollama',
        model: 'llama3.1',
        endpoint: 'http://localhost:11434',
      }),
    ).toEqual({ valid: true });
  });

  it('validateModelConfig returns valid for openai config (no endpoint check)', () => {
    expect(
      validateModelConfig({
        provider: 'openai',
        model: 'gpt-4o-mini',
        endpoint: '',
      }),
    ).toEqual({ valid: true });
  });

  it('validateModelConfig returns valid for anthropic config (no endpoint check)', () => {
    expect(
      validateModelConfig({
        provider: 'anthropic',
        model: 'claude-3-5-haiku-20241022',
        endpoint: '',
      }),
    ).toEqual({ valid: true });
  });

  it('validateModelConfig returns valid for tier 2 provider with non-empty model', () => {
    expect(
      validateModelConfig({
        provider: 'groq',
        model: 'llama3-8b-8192',
        endpoint: 'https://api.groq.com',
      }),
    ).toEqual({ valid: true });
  });

  it('validateModelConfig returns invalid for truly unsupported provider', () => {
    const result = validateModelConfig({
      provider: 'unknown-llm',
      model: 'some-model',
      endpoint: 'https://example.com',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain('Unsupported provider');
    }
  });

  it('validateModelConfig returns invalid for invalid ollama endpoint URL', () => {
    const result = validateModelConfig({
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'not-a-url',
    });

    expect(result).toEqual({ valid: false, reason: 'Endpoint must be a valid URL' });
  });

  it('validateModelConfig returns invalid for empty model', () => {
    const result = validateModelConfig({
      provider: 'ollama',
      model: '   ',
      endpoint: 'http://localhost:11434',
    });

    expect(result).toEqual({ valid: false, reason: 'Model must be a non-empty string' });
  });

  it('validateModelConfig returns invalid for bedrock (not yet supported)', () => {
    const result = validateModelConfig({
      provider: 'bedrock',
      model: 'anthropic.claude-v2',
      endpoint: '',
    });

    expect(result.valid).toBe(false);
  });
});
