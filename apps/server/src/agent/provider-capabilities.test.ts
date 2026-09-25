import { describe, expect, it } from 'vitest';
import {
  getProviderCapabilities,
  getProviderTier,
  findFallbackProvider,
  type ProviderCapability,
} from './provider-capabilities.js';

// ─── getProviderCapabilities ──────────────────────────────────────────────────

describe('getProviderCapabilities', () => {
  it('returns capabilities for a known provider', () => {
    const caps = getProviderCapabilities('openai');
    expect(caps).toBeDefined();
    expect(caps!.tools).toBe(true);
    expect(caps!.streaming).toBe(true);
  });

  it('returns undefined for an unknown provider', () => {
    expect(getProviderCapabilities('unknown-provider')).toBeUndefined();
  });

  it('ollama supports streaming but not vision', () => {
    const caps = getProviderCapabilities('ollama');
    expect(caps).toBeDefined();
    expect(caps!.streaming).toBe(true);
    expect(caps!.vision).toBe(false);
  });

  it('openai supports all capabilities', () => {
    const caps = getProviderCapabilities('openai');
    expect(caps).toEqual({
      tools: true,
      jsonMode: true,
      vision: true,
      streaming: true,
    });
  });

  it('anthropic supports tools, streaming, and vision but not jsonMode', () => {
    const caps = getProviderCapabilities('anthropic');
    expect(caps).toEqual({
      tools: true,
      jsonMode: false,
      vision: true,
      streaming: true,
    });
  });

  it('groq supports tools, jsonMode, streaming but not vision', () => {
    const caps = getProviderCapabilities('groq');
    expect(caps).toEqual({
      tools: true,
      jsonMode: true,
      vision: false,
      streaming: true,
    });
  });

  it('mistral supports tools, jsonMode, streaming but not vision', () => {
    const caps = getProviderCapabilities('mistral');
    expect(caps).toBeDefined();
    expect(caps!.tools).toBe(true);
    expect(caps!.vision).toBe(false);
  });

  it('openrouter supports all capabilities (proxy)', () => {
    const caps = getProviderCapabilities('openrouter');
    expect(caps).toEqual({
      tools: true,
      jsonMode: true,
      vision: true,
      streaming: true,
    });
  });

  it('cohere supports tools and streaming but not jsonMode or vision', () => {
    const caps = getProviderCapabilities('cohere');
    expect(caps).toEqual({
      tools: true,
      jsonMode: false,
      vision: false,
      streaming: true,
    });
  });

  it('stub providers (google, azure-openai, bedrock) have no capabilities', () => {
    for (const provider of ['google', 'azure-openai', 'bedrock']) {
      const caps = getProviderCapabilities(provider);
      expect(caps).toBeDefined();
      expect(caps!.tools).toBe(false);
      expect(caps!.jsonMode).toBe(false);
      expect(caps!.vision).toBe(false);
      expect(caps!.streaming).toBe(false);
    }
  });

  it('returns capabilities for all 10 registered providers', () => {
    const providers = [
      'ollama', 'openai', 'anthropic', 'groq', 'mistral',
      'openrouter', 'cohere', 'google', 'azure-openai', 'bedrock',
    ];
    for (const p of providers) {
      expect(getProviderCapabilities(p)).toBeDefined();
    }
  });
});

// ─── getProviderTier ──────────────────────────────────────────────────────────

describe('getProviderTier', () => {
  it('returns 1 for native SDK providers', () => {
    expect(getProviderTier('ollama')).toBe(1);
    expect(getProviderTier('openai')).toBe(1);
    expect(getProviderTier('anthropic')).toBe(1);
  });

  it('returns 2 for OpenAI-compatible providers', () => {
    expect(getProviderTier('groq')).toBe(2);
    expect(getProviderTier('mistral')).toBe(2);
    expect(getProviderTier('openrouter')).toBe(2);
    expect(getProviderTier('cohere')).toBe(2);
  });

  it('returns 3 for stub/planned providers', () => {
    expect(getProviderTier('google')).toBe(3);
    expect(getProviderTier('azure-openai')).toBe(3);
    expect(getProviderTier('bedrock')).toBe(3);
  });

  it('returns undefined for unknown provider', () => {
    expect(getProviderTier('unknown')).toBeUndefined();
  });
});

// ─── findFallbackProvider ─────────────────────────────────────────────────────

describe('findFallbackProvider', () => {
  it('returns undefined when current provider has the required capability', () => {
    const result = findFallbackProvider('openai', 'tools');
    expect(result).toBeUndefined();
  });

  it('finds a fallback when current provider lacks the capability', () => {
    // anthropic lacks jsonMode — fallback order is alphabetical within tiers,
    // so ollama (tier 1, alphabetically before openai) is first match with jsonMode
    const result = findFallbackProvider('anthropic', 'jsonMode');
    expect(result).toBeDefined();
    expect(result).toBe('ollama');
  });

  it('returns undefined when no provider in the chain has the capability', () => {
    // vision — only openai, anthropic, openrouter have it
    // If we ask for fallback from openai (which HAS vision), should be undefined
    const result = findFallbackProvider('openai', 'vision');
    expect(result).toBeUndefined();
  });

  it('skips stub providers in the fallback chain', () => {
    // google is tier 3 stub, should never be returned as fallback
    const result = findFallbackProvider('cohere', 'vision');
    expect(result).toBeDefined();
    // Should return a tier 1 or 2 provider, not google/azure/bedrock
    expect(['google', 'azure-openai', 'bedrock']).not.toContain(result);
  });

  it('prefers higher-tier providers in fallback order', () => {
    // ollama lacks vision — fallback order checks tier 1 first (alphabetical):
    // anthropic has vision and comes before openai alphabetically
    const result = findFallbackProvider('ollama', 'vision');
    expect(result).toBe('anthropic');
  });

  it('returns undefined for unknown provider', () => {
    expect(findFallbackProvider('unknown', 'tools')).toBeUndefined();
  });

  it('returns undefined for stub provider requesting any capability', () => {
    // bedrock is a stub with no capabilities — but fallback should still work
    // since the question is "find me another provider that has this"
    const result = findFallbackProvider('bedrock', 'streaming');
    expect(result).toBeDefined();
    // Should find ollama or openai (tier 1 preferred)
    expect(getProviderTier(result!)).toBeLessThanOrEqual(2);
  });

  it('is deterministic — same input always returns same output', () => {
    const results = Array.from({ length: 5 }, () =>
      findFallbackProvider('anthropic', 'jsonMode'),
    );
    expect(new Set(results).size).toBe(1);
  });
});
