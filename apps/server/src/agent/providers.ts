import { getProvider, isNotConfigured } from './provider-registry.js';
import type { ProviderModelConfig } from './provider-registry.js';

// Re-export types so existing importers keep working without path changes
export type { ProviderModelConfig as ModelConfig } from './provider-registry.js';
export type {
  NotConfigured,
  ValidationResult,
  ProviderAdapter,
  ProviderModelConfig,
} from './provider-registry.js';
export { isNotConfigured, registerProvider, getProvider, listProviders } from './provider-registry.js';

// ─── Public constants ─────────────────────────────────────────────────────────

export const SUPPORTED_PROVIDERS = [
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
] as const;

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

// ─── Error types ──────────────────────────────────────────────────────────────

export class UnsupportedProviderError extends Error {
  provider: string;

  constructor(provider: string) {
    super(
      `Unsupported provider: ${provider}. Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`,
    );
    this.name = 'UnsupportedProviderError';
    this.provider = provider;
  }
}

export class ProviderNotConfiguredError extends Error {
  provider: string;
  reason: string;

  constructor(provider: string, reason: string) {
    super(`Provider '${provider}' is not configured: ${reason}`);
    this.name = 'ProviderNotConfiguredError';
    this.provider = provider;
    this.reason = reason;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isSupportedProvider(provider: string): provider is SupportedProvider {
  return SUPPORTED_PROVIDERS.includes(provider as SupportedProvider);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createModelForProvider(config: ProviderModelConfig): unknown {
  if (!isSupportedProvider(config.provider)) {
    throw new UnsupportedProviderError(config.provider);
  }
  const adapter = getProvider(config.provider);
  if (!adapter) {
    throw new UnsupportedProviderError(config.provider);
  }
  const model = adapter.buildModel(config);
  if (isNotConfigured(model)) {
    throw new ProviderNotConfiguredError(model.provider, model.reason);
  }
  return model;
}

export function validateModelConfig(
  config: ProviderModelConfig,
): { valid: true } | { valid: false; reason: string } {
  if (!isSupportedProvider(config.provider)) {
    return {
      valid: false,
      reason: `Unsupported provider: ${config.provider}. Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`,
    };
  }
  const adapter = getProvider(config.provider);
  if (!adapter) {
    return {
      valid: false,
      reason: `Unsupported provider: ${config.provider}. Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`,
    };
  }
  return adapter.validate(config);
}
