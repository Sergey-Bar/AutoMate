// ─── Capability types ─────────────────────────────────────────────────────────

export interface ProviderCapability {
  /** Supports tool/function calling */
  tools: boolean;
  /** Supports JSON mode (structured output) */
  jsonMode: boolean;
  /** Supports vision (image input) */
  vision: boolean;
  /** Supports streaming responses */
  streaming: boolean;
}

export type CapabilityName = keyof ProviderCapability;

type ProviderTier = 1 | 2 | 3;

interface ProviderMeta {
  capabilities: ProviderCapability;
  tier: ProviderTier;
}

// ─── Capability registry ──────────────────────────────────────────────────────

const PROVIDER_META: Record<string, ProviderMeta> = {
  // Tier 1: Native SDK adapters
  ollama: {
    tier: 1,
    capabilities: { tools: true, jsonMode: true, vision: false, streaming: true },
  },
  openai: {
    tier: 1,
    capabilities: { tools: true, jsonMode: true, vision: true, streaming: true },
  },
  anthropic: {
    tier: 1,
    capabilities: { tools: true, jsonMode: false, vision: true, streaming: true },
  },

  // Tier 2: OpenAI-compatible adapters
  groq: {
    tier: 2,
    capabilities: { tools: true, jsonMode: true, vision: false, streaming: true },
  },
  mistral: {
    tier: 2,
    capabilities: { tools: true, jsonMode: true, vision: false, streaming: true },
  },
  openrouter: {
    tier: 2,
    capabilities: { tools: true, jsonMode: true, vision: true, streaming: true },
  },
  cohere: {
    tier: 2,
    capabilities: { tools: true, jsonMode: false, vision: false, streaming: true },
  },

  // Tier 3: Stubs (not yet available — all capabilities false)
  google: {
    tier: 3,
    capabilities: { tools: false, jsonMode: false, vision: false, streaming: false },
  },
  'azure-openai': {
    tier: 3,
    capabilities: { tools: false, jsonMode: false, vision: false, streaming: false },
  },
  bedrock: {
    tier: 3,
    capabilities: { tools: false, jsonMode: false, vision: false, streaming: false },
  },
};

// ─── Deterministic fallback order ─────────────────────────────────────────────
// Tier 1 first, then Tier 2. Tier 3 stubs are excluded since they can't serve
// any capability. Within a tier, order is alphabetical for determinism.

const FALLBACK_ORDER: readonly string[] = [
  // Tier 1
  'anthropic',
  'ollama',
  'openai',
  // Tier 2
  'cohere',
  'groq',
  'mistral',
  'openrouter',
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns capability flags for a registered provider, or `undefined` if the
 * provider is unknown.
 */
export function getProviderCapabilities(
  provider: string,
): ProviderCapability | undefined {
  return PROVIDER_META[provider]?.capabilities;
}

/**
 * Returns the tier (1 = native SDK, 2 = OpenAI-compatible, 3 = stub) for a
 * registered provider, or `undefined` if the provider is unknown.
 */
export function getProviderTier(provider: string): ProviderTier | undefined {
  return PROVIDER_META[provider]?.tier;
}

/**
 * Finds a fallback provider when `currentProvider` lacks `requiredCapability`.
 *
 * Returns `undefined` when:
 * - The current provider already has the capability (no fallback needed).
 * - The current provider is unknown.
 * - No other provider in the fallback chain has the capability.
 *
 * The search is deterministic: Tier 1 providers are checked first (alphabetical),
 * then Tier 2 (alphabetical). Tier 3 stubs are never returned as fallbacks.
 */
export function findFallbackProvider(
  currentProvider: string,
  requiredCapability: CapabilityName,
): string | undefined {
  const currentCaps = PROVIDER_META[currentProvider]?.capabilities;

  // Unknown provider — can't determine fallback
  if (!currentCaps) return undefined;

  // Current provider already has the capability — no fallback needed
  if (currentCaps[requiredCapability]) return undefined;

  // Search fallback chain, skipping the current provider
  for (const candidate of FALLBACK_ORDER) {
    if (candidate === currentProvider) continue;
    const candidateCaps = PROVIDER_META[candidate]?.capabilities;
    if (candidateCaps?.[requiredCapability]) {
      return candidate;
    }
  }

  return undefined;
}
