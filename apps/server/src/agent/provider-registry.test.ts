import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const createOllamaMock = vi.hoisted(() =>
  vi.fn(
    (opts: { baseURL: string }) =>
      (modelId: string) => ({ provider: 'ollama', modelId, baseURL: opts.baseURL }),
  ),
);
const ollamaMock = vi.hoisted(() =>
  vi.fn((modelId: string) => ({ provider: 'legacy-ollama', modelId })),
);

// createOpenAI returns a "client" function — call it with a model ID to get a model object.
// We need a separate spy for the returned client so we can assert calls on it.
const openAIClientMock = vi.hoisted(() =>
  vi.fn((modelId: string) => ({ provider: 'openai-compat', modelId })),
);
const createOpenAIMock = vi.hoisted(() => vi.fn((_opts: unknown) => openAIClientMock));
const openaiMock = vi.hoisted(() => vi.fn((modelId: string) => ({ provider: 'openai', modelId })));

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

// ─── Imports (must follow mocks) ──────────────────────────────────────────────

import {
  getProvider,
  isNotConfigured,
  listProviders,
  registerProvider,
} from './provider-registry.js';
import type { ProviderAdapter, ProviderModelConfig } from './provider-registry.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeConfig(overrides: Partial<ProviderModelConfig> = {}): ProviderModelConfig {
  return {
    provider: 'ollama',
    model: 'test-model',
    endpoint: 'http://localhost:11434',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('provider-registry', () => {
  // ── Registry utilities ────────────────────────────────────────────────────

  describe('listProviders', () => {
    it('returns all 10 registered providers', () => {
      const providers = listProviders();
      expect(providers).toHaveLength(10);
    });

    it('contains all expected provider names', () => {
      const providers = listProviders();
      for (const name of [
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
      ]) {
        expect(providers).toContain(name);
      }
    });
  });

  describe('getProvider', () => {
    it('returns the adapter for each registered provider', () => {
      for (const name of listProviders()) {
        const adapter = getProvider(name);
        expect(adapter).toBeDefined();
        expect(adapter?.name).toBe(name);
      }
    });

    it('returns undefined for an unknown provider', () => {
      expect(getProvider('unknown-provider')).toBeUndefined();
      expect(getProvider('')).toBeUndefined();
    });
  });

  describe('registerProvider', () => {
    it('adds a new adapter that is immediately retrievable', () => {
      const adapter: ProviderAdapter = {
        name: '__test_adapter__',
        buildModel: vi.fn(),
        validate: vi.fn(),
      };
      registerProvider(adapter);
      expect(getProvider('__test_adapter__')).toBe(adapter);
      expect(listProviders()).toContain('__test_adapter__');
    });

    it('overwrites an existing adapter with the same name', () => {
      const first: ProviderAdapter = {
        name: '__overwrite_test__',
        buildModel: vi.fn(),
        validate: vi.fn(),
      };
      const second: ProviderAdapter = {
        name: '__overwrite_test__',
        buildModel: vi.fn(),
        validate: vi.fn(),
      };
      registerProvider(first);
      registerProvider(second);
      expect(getProvider('__overwrite_test__')).toBe(second);
    });
  });

  // ── isNotConfigured type guard ─────────────────────────────────────────────

  describe('isNotConfigured', () => {
    it('returns true for a valid NotConfigured object', () => {
      expect(
        isNotConfigured({ type: 'not-configured', provider: 'openai', reason: 'missing key' }),
      ).toBe(true);
    });

    it('returns false for null', () => {
      expect(isNotConfigured(null)).toBe(false);
    });

    it('returns false for a plain object without type field', () => {
      expect(isNotConfigured({ provider: 'openai' })).toBe(false);
    });

    it('returns false for an object with a different type', () => {
      expect(isNotConfigured({ type: 'something-else', provider: 'openai', reason: 'x' })).toBe(
        false,
      );
    });

    it('returns false for a primitive value', () => {
      expect(isNotConfigured('not-configured')).toBe(false);
      expect(isNotConfigured(42)).toBe(false);
    });
  });

  // ── ollama adapter ─────────────────────────────────────────────────────────

  describe('ollama adapter', () => {
    const adapter = () => getProvider('ollama')!;

    describe('buildModel', () => {
      it('creates a model via createOllama with /api appended to endpoint', () => {
        const model = adapter().buildModel(
          makeConfig({ provider: 'ollama', model: 'llama3.1:8b', endpoint: 'http://localhost:11434' }),
        );
        expect(createOllamaMock).toHaveBeenCalledWith({
          baseURL: 'http://localhost:11434/api',
        });
        expect(model).toEqual({
          provider: 'ollama',
          modelId: 'llama3.1:8b',
          baseURL: 'http://localhost:11434/api',
        });
      });

      it('strips trailing slash from endpoint before appending /api', () => {
        adapter().buildModel(
          makeConfig({ provider: 'ollama', endpoint: 'http://localhost:11434/' }),
        );
        expect(createOllamaMock).toHaveBeenCalledWith({
          baseURL: 'http://localhost:11434/api',
        });
      });
    });

    describe('validate', () => {
      it('returns valid for a correct config', () => {
        expect(
          adapter().validate(
            makeConfig({ provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' }),
          ),
        ).toEqual({ valid: true });
      });

      it('returns invalid for an empty model', () => {
        expect(
          adapter().validate(makeConfig({ provider: 'ollama', model: '   ', endpoint: 'http://localhost:11434' })),
        ).toEqual({ valid: false, reason: 'Model must be a non-empty string' });
      });

      it('returns invalid for a non-URL endpoint', () => {
        expect(
          adapter().validate(makeConfig({ provider: 'ollama', model: 'llama3.1', endpoint: 'not-a-url' })),
        ).toEqual({ valid: false, reason: 'Endpoint must be a valid URL' });
      });

      it('returns invalid for an empty endpoint', () => {
        expect(
          adapter().validate(makeConfig({ provider: 'ollama', model: 'llama3.1', endpoint: '' })),
        ).toEqual({ valid: false, reason: 'Endpoint must be a valid URL' });
      });
    });
  });

  // ── openai adapter ─────────────────────────────────────────────────────────

  describe('openai adapter', () => {
    const adapter = () => getProvider('openai')!;

    describe('buildModel', () => {
      it('returns NotConfigured when OPENAI_API_KEY is not set', () => {
        delete process.env.OPENAI_API_KEY;
        const result = adapter().buildModel(makeConfig({ provider: 'openai', model: 'gpt-4o-mini' }));
        expect(isNotConfigured(result)).toBe(true);
        if (isNotConfigured(result)) {
          expect(result.provider).toBe('openai');
          expect(result.reason).toContain('OPENAI_API_KEY');
        }
      });

      it('calls openai() with the model id when OPENAI_API_KEY is set', () => {
        vi.stubEnv('OPENAI_API_KEY', 'sk-test');
        const result = adapter().buildModel(makeConfig({ provider: 'openai', model: 'gpt-4o-mini' }));
        expect(openaiMock).toHaveBeenCalledWith('gpt-4o-mini');
        expect(result).toEqual({ provider: 'openai', modelId: 'gpt-4o-mini' });
      });
    });

    describe('validate', () => {
      it('returns valid for a non-empty model', () => {
        expect(adapter().validate(makeConfig({ provider: 'openai', model: 'gpt-4o', endpoint: '' }))).toEqual({
          valid: true,
        });
      });

      it('returns invalid for an empty model', () => {
        expect(adapter().validate(makeConfig({ provider: 'openai', model: '' }))).toEqual({
          valid: false,
          reason: 'Model must be a non-empty string',
        });
      });
    });
  });

  // ── anthropic adapter ──────────────────────────────────────────────────────

  describe('anthropic adapter', () => {
    const adapter = () => getProvider('anthropic')!;

    describe('buildModel', () => {
      it('returns NotConfigured when ANTHROPIC_API_KEY is not set', () => {
        delete process.env.ANTHROPIC_API_KEY;
        const result = adapter().buildModel(
          makeConfig({ provider: 'anthropic', model: 'claude-3-5-haiku-20241022' }),
        );
        expect(isNotConfigured(result)).toBe(true);
        if (isNotConfigured(result)) {
          expect(result.provider).toBe('anthropic');
          expect(result.reason).toContain('ANTHROPIC_API_KEY');
        }
      });

      it('calls anthropic() with the model id when ANTHROPIC_API_KEY is set', () => {
        vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
        const result = adapter().buildModel(
          makeConfig({ provider: 'anthropic', model: 'claude-3-5-haiku-20241022' }),
        );
        expect(anthropicMock).toHaveBeenCalledWith('claude-3-5-haiku-20241022');
        expect(result).toEqual({ provider: 'anthropic', modelId: 'claude-3-5-haiku-20241022' });
      });
    });

    describe('validate', () => {
      it('returns valid for a non-empty model', () => {
        expect(
          adapter().validate(makeConfig({ provider: 'anthropic', model: 'claude-3-5-haiku-20241022' })),
        ).toEqual({ valid: true });
      });

      it('returns invalid for an empty model', () => {
        expect(
          adapter().validate(makeConfig({ provider: 'anthropic', model: '  ' })),
        ).toEqual({ valid: false, reason: 'Model must be a non-empty string' });
      });
    });
  });

  // ── google adapter ─────────────────────────────────────────────────────────

  describe('google adapter', () => {
    const adapter = () => getProvider('google')!;

    describe('buildModel', () => {
      it('always returns NotConfigured (package not installed)', () => {
        const result = adapter().buildModel(makeConfig({ provider: 'google', model: 'gemini-pro' }));
        expect(isNotConfigured(result)).toBe(true);
        if (isNotConfigured(result)) {
          expect(result.provider).toBe('google');
          expect(result.reason).toContain('@ai-sdk/google');
        }
      });
    });

    describe('validate', () => {
      it('returns valid for a non-empty model', () => {
        expect(adapter().validate(makeConfig({ provider: 'google', model: 'gemini-pro' }))).toEqual({
          valid: true,
        });
      });

      it('returns invalid for an empty model', () => {
        expect(adapter().validate(makeConfig({ provider: 'google', model: '' }))).toEqual({
          valid: false,
          reason: 'Model must be a non-empty string',
        });
      });
    });
  });

  // ── azure-openai adapter ───────────────────────────────────────────────────

  describe('azure-openai adapter', () => {
    const adapter = () => getProvider('azure-openai')!;

    describe('buildModel', () => {
      it('always returns NotConfigured (package not installed)', () => {
        const result = adapter().buildModel(
          makeConfig({ provider: 'azure-openai', model: 'gpt-4o' }),
        );
        expect(isNotConfigured(result)).toBe(true);
        if (isNotConfigured(result)) {
          expect(result.provider).toBe('azure-openai');
          expect(result.reason).toContain('@ai-sdk/azure');
        }
      });
    });

    describe('validate', () => {
      it('returns valid for a non-empty model', () => {
        expect(
          adapter().validate(makeConfig({ provider: 'azure-openai', model: 'gpt-4o' })),
        ).toEqual({ valid: true });
      });

      it('returns invalid for an empty model', () => {
        expect(
          adapter().validate(makeConfig({ provider: 'azure-openai', model: '' })),
        ).toEqual({ valid: false, reason: 'Model must be a non-empty string' });
      });
    });
  });

  // ── Tier 2 OpenAI-compatible adapters ─────────────────────────────────────

  describe.each([
    { name: 'groq', envKey: 'GROQ_API_KEY', baseURL: 'https://api.groq.com/openai/v1' },
    { name: 'mistral', envKey: 'MISTRAL_API_KEY', baseURL: 'https://api.mistral.ai/v1' },
    { name: 'openrouter', envKey: 'OPENROUTER_API_KEY', baseURL: 'https://openrouter.ai/api/v1' },
    {
      name: 'cohere',
      envKey: 'COHERE_API_KEY',
      baseURL: 'https://api.cohere.com/compatibility/v1',
    },
  ])('$name adapter', ({ name, envKey, baseURL }) => {
    const adapter = () => getProvider(name)!;

    describe('buildModel', () => {
      it(`returns NotConfigured when ${envKey} is not set`, () => {
        delete process.env[envKey];
        const result = adapter().buildModel(makeConfig({ provider: name, model: 'some-model' }));
        expect(isNotConfigured(result)).toBe(true);
        if (isNotConfigured(result)) {
          expect(result.provider).toBe(name);
          expect(result.reason).toContain(envKey);
        }
      });

      it(`calls createOpenAI with the correct baseURL when ${envKey} is set`, () => {
        vi.stubEnv(envKey, 'test-api-key');
        createOpenAIMock.mockClear();
        openAIClientMock.mockClear();

        const result = adapter().buildModel(makeConfig({ provider: name, model: 'test-model' }));

        expect(createOpenAIMock).toHaveBeenCalledWith(
          expect.objectContaining({ baseURL, apiKey: 'test-api-key' }),
        );
        expect(openAIClientMock).toHaveBeenCalledWith('test-model');
        expect(result).toEqual({ provider: 'openai-compat', modelId: 'test-model' });
      });
    });

    describe('validate', () => {
      it('returns valid for a non-empty model', () => {
        expect(adapter().validate(makeConfig({ provider: name, model: 'some-model' }))).toEqual({
          valid: true,
        });
      });

      it('returns invalid for an empty model', () => {
        expect(adapter().validate(makeConfig({ provider: name, model: '' }))).toEqual({
          valid: false,
          reason: 'Model must be a non-empty string',
        });
      });

      it('returns invalid for a whitespace-only model', () => {
        expect(adapter().validate(makeConfig({ provider: name, model: '   ' }))).toEqual({
          valid: false,
          reason: 'Model must be a non-empty string',
        });
      });
    });
  });

  // ── bedrock adapter (Tier 3) ───────────────────────────────────────────────

  describe('bedrock adapter', () => {
    const adapter = () => getProvider('bedrock')!;

    describe('buildModel', () => {
      it('always returns NotConfigured', () => {
        const result = adapter().buildModel(makeConfig({ provider: 'bedrock', model: 'some-model' }));
        expect(isNotConfigured(result)).toBe(true);
        if (isNotConfigured(result)) {
          expect(result.provider).toBe('bedrock');
          expect(result.reason).toBeTruthy();
        }
      });
    });

    describe('validate', () => {
      it('returns invalid regardless of config (feature not available)', () => {
        const result = adapter().validate(makeConfig({ provider: 'bedrock', model: 'some-model' }));
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toBeTruthy();
        }
      });

      it('returns invalid even with valid-looking config', () => {
        expect(
          adapter().validate(makeConfig({ provider: 'bedrock', model: 'anthropic.claude-v2' })),
        ).toEqual(expect.objectContaining({ valid: false }));
      });
    });
  });
});
