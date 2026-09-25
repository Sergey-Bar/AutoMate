import * as ollamaProvider from 'ollama-ai-provider-v2';
import { openai, createOpenAI } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';

// ─── Public interfaces ─────────────────────────────────────────────────────────

export interface ProviderModelConfig {
  provider: string;
  model: string;
  endpoint: string;
  temperature?: number;
  maxTokens?: number;
}

export interface NotConfigured {
  type: 'not-configured';
  provider: string;
  reason: string;
}

export type ValidationResult = { valid: true } | { valid: false; reason: string };

/**
 * Minimal structural type satisfied by all AI SDK language model versions
 * (V1, V2, V3). We use this instead of importing `LanguageModel` from `ai`
 * because `ai@6` defines `LanguageModel = string | V2 | V3` while the SDK
 * provider packages (`@ai-sdk/openai@1.x`, `@ai-sdk/anthropic@1.x`) still
 * return `LanguageModelV1`. This structural type bridges the gap.
 */
export interface AnyLanguageModel {
  readonly specificationVersion: string;
  readonly provider: string;
  readonly modelId: string;
}

export interface ProviderAdapter {
  readonly name: string;
  buildModel(config: ProviderModelConfig): AnyLanguageModel | NotConfigured;
  validate(config: ProviderModelConfig): ValidationResult;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const _registry = new Map<string, ProviderAdapter>();

export function registerProvider(adapter: ProviderAdapter): void {
  _registry.set(adapter.name, adapter);
}

export function getProvider(name: string): ProviderAdapter | undefined {
  return _registry.get(name);
}

export function listProviders(): string[] {
  return Array.from(_registry.keys());
}

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isNotConfigured(value: unknown): value is NotConfigured {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as NotConfigured).type === 'not-configured'
  );
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Reads a function from a CommonJS-interop record, handling both direct export
 * and nested `.default` export shapes produced by dynamic `import()` of CJS modules.
 */
function readFn(
  record: Record<string, unknown>,
  key: string,
): ((...args: unknown[]) => unknown) | null {
  const direct = record[key];
  if (typeof direct === 'function') return direct as (...args: unknown[]) => unknown;
  const def = record.default;
  if (typeof def === 'object' && def !== null) {
    const nested = (def as Record<string, unknown>)[key];
    if (typeof nested === 'function') return nested as (...args: unknown[]) => unknown;
  }
  return null;
}

function validateNonEmptyModel(config: ProviderModelConfig): ValidationResult | null {
  if (typeof config.model !== 'string' || !config.model.trim()) {
    return { valid: false, reason: 'Model must be a non-empty string' };
  }
  return null;
}

// ─── Tier 1: Real AI SDK Adapters ─────────────────────────────────────────────

// ollama — ollama-ai-provider-v2
registerProvider({
  name: 'ollama',
  buildModel(config) {
    const normalized = config.endpoint.endsWith('/')
      ? config.endpoint.slice(0, -1)
      : config.endpoint;
    const record = ollamaProvider as Record<string, unknown>;
    const createFn = readFn(record, 'createOllama');
    const ollamaFn = readFn(record, 'ollama');
    const createModel =
      typeof createFn === 'function'
        ? (createFn as (opts: { baseURL: string }) => (id: string) => unknown)({
            baseURL: `${normalized}/api`,
          })
        : typeof ollamaFn === 'function'
          ? (ollamaFn as (id: string) => unknown)
          : (id: string) => ({ modelId: id });
    return createModel(config.model) as AnyLanguageModel;
  },
  validate(config) {
    const modelErr = validateNonEmptyModel(config);
    if (modelErr) return modelErr;
    try {
      new URL(config.endpoint);
    } catch {
      return { valid: false, reason: 'Endpoint must be a valid URL' };
    }
    return { valid: true };
  },
});

// openai — @ai-sdk/openai
registerProvider({
  name: 'openai',
  buildModel(config) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        type: 'not-configured',
        provider: 'openai',
        reason: 'Missing OPENAI_API_KEY environment variable',
      };
    }
    return openai(config.model);
  },
  validate(config) {
    const modelErr = validateNonEmptyModel(config);
    if (modelErr) return modelErr;
    return { valid: true };
  },
});

// anthropic — @ai-sdk/anthropic
registerProvider({
  name: 'anthropic',
  buildModel(config) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        type: 'not-configured',
        provider: 'anthropic',
        reason: 'Missing ANTHROPIC_API_KEY environment variable',
      };
    }
    return anthropic(config.model);
  },
  validate(config) {
    const modelErr = validateNonEmptyModel(config);
    if (modelErr) return modelErr;
    return { valid: true };
  },
});

// google — requires @ai-sdk/google (not installed)
registerProvider({
  name: 'google',
  buildModel(_config) {
    return {
      type: 'not-configured',
      provider: 'google',
      reason: 'Google provider requires @ai-sdk/google package (not installed)',
    };
  },
  validate(config) {
    const modelErr = validateNonEmptyModel(config);
    if (modelErr) return modelErr;
    return { valid: true };
  },
});

// azure-openai — requires @ai-sdk/azure (not installed)
registerProvider({
  name: 'azure-openai',
  buildModel(_config) {
    return {
      type: 'not-configured',
      provider: 'azure-openai',
      reason: 'Azure OpenAI provider requires @ai-sdk/azure package (not installed)',
    };
  },
  validate(config) {
    const modelErr = validateNonEmptyModel(config);
    if (modelErr) return modelErr;
    return { valid: true };
  },
});

// ─── Tier 2: OpenAI-compatible Adapters ────────────────────────────────────────

function createOpenAICompatAdapter(opts: {
  name: string;
  baseURL: string;
  envKey: string;
}): ProviderAdapter {
  return {
    name: opts.name,
    buildModel(config) {
      const apiKey = process.env[opts.envKey];
      if (!apiKey) {
        return {
          type: 'not-configured',
          provider: opts.name,
          reason: `Missing ${opts.envKey} environment variable`,
        };
      }
      const client = createOpenAI({ baseURL: opts.baseURL, apiKey });
      return client(config.model);
    },
    validate(config) {
      const modelErr = validateNonEmptyModel(config);
      if (modelErr) return modelErr;
      return { valid: true };
    },
  };
}

registerProvider(
  createOpenAICompatAdapter({
    name: 'groq',
    baseURL: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
  }),
);

registerProvider(
  createOpenAICompatAdapter({
    name: 'mistral',
    baseURL: 'https://api.mistral.ai/v1',
    envKey: 'MISTRAL_API_KEY',
  }),
);

registerProvider(
  createOpenAICompatAdapter({
    name: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
  }),
);

registerProvider(
  createOpenAICompatAdapter({
    name: 'cohere',
    baseURL: 'https://api.cohere.com/compatibility/v1',
    envKey: 'COHERE_API_KEY',
  }),
);

// ─── Tier 3: Feature-flagged Adapters ──────────────────────────────────────────

// bedrock — requires @ai-sdk/amazon-bedrock + AWS credentials (not yet available)
registerProvider({
  name: 'bedrock',
  buildModel(_config) {
    return {
      type: 'not-configured',
      provider: 'bedrock',
      reason:
        'Bedrock provider requires @ai-sdk/amazon-bedrock and AWS credentials (feature not yet available)',
    };
  },
  validate(_config) {
    return {
      valid: false,
      reason:
        'Bedrock provider is not currently supported. Install @ai-sdk/amazon-bedrock to enable.',
    };
  },
});
