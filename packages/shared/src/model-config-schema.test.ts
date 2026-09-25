import { describe, expect, it } from 'vitest';
import { ModelConfigSchema, ProviderSchema } from './index.js';

const BASE_CONFIG = {
  id: 'default',
  model: 'llama3.1',
  endpoint: 'http://localhost:11434',
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: null,
  updatedAt: '2026-03-12T00:00:00.000Z',
};

describe('ProviderSchema', () => {
  it('accepts all 10 providers individually', () => {
    const providers = [
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

    for (const provider of providers) {
      const result = ProviderSchema.safeParse(provider);
      expect(result.success, `Expected provider "${provider}" to be valid`).toBe(true);
      if (result.success) expect(result.data).toBe(provider);
    }
  });

  it('has exactly 10 valid options', () => {
    expect(ProviderSchema.options).toHaveLength(10);
    expect(ProviderSchema.options).toContain('ollama');
    expect(ProviderSchema.options).toContain('openai');
    expect(ProviderSchema.options).toContain('anthropic');
    expect(ProviderSchema.options).toContain('google');
    expect(ProviderSchema.options).toContain('azure-openai');
    expect(ProviderSchema.options).toContain('groq');
    expect(ProviderSchema.options).toContain('mistral');
    expect(ProviderSchema.options).toContain('openrouter');
    expect(ProviderSchema.options).toContain('cohere');
    expect(ProviderSchema.options).toContain('bedrock');
  });

  it('rejects unknown providers', () => {
    expect(ProviderSchema.safeParse('unknown').success).toBe(false);
    expect(ProviderSchema.safeParse('').success).toBe(false);
    expect(ProviderSchema.safeParse('huggingface').success).toBe(false);
  });

  it('accepts ollama — kills StringLiteral mutant', () => {
    const result = ProviderSchema.safeParse('ollama');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('ollama');
  });

  it('accepts openai — kills StringLiteral mutant', () => {
    const result = ProviderSchema.safeParse('openai');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('openai');
  });

  it('accepts anthropic — kills StringLiteral mutant', () => {
    const result = ProviderSchema.safeParse('anthropic');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('anthropic');
  });

  it('accepts google — kills StringLiteral mutant', () => {
    const result = ProviderSchema.safeParse('google');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('google');
  });

  it('accepts azure-openai — kills StringLiteral mutant', () => {
    const result = ProviderSchema.safeParse('azure-openai');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('azure-openai');
  });

  it('accepts groq — kills StringLiteral mutant', () => {
    const result = ProviderSchema.safeParse('groq');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('groq');
  });

  it('accepts mistral — kills StringLiteral mutant', () => {
    const result = ProviderSchema.safeParse('mistral');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('mistral');
  });

  it('accepts openrouter — kills StringLiteral mutant', () => {
    const result = ProviderSchema.safeParse('openrouter');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('openrouter');
  });

  it('accepts cohere — kills StringLiteral mutant', () => {
    const result = ProviderSchema.safeParse('cohere');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('cohere');
  });

  it('accepts bedrock — kills StringLiteral mutant', () => {
    const result = ProviderSchema.safeParse('bedrock');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('bedrock');
  });
});

describe('ModelConfigSchema', () => {
  it('accepts ollama provider', () => {
    const cfg = ModelConfigSchema.parse({ ...BASE_CONFIG, provider: 'ollama' });
    expect(cfg.provider).toBe('ollama');
  });

  it('accepts openai provider', () => {
    const cfg = ModelConfigSchema.parse({ ...BASE_CONFIG, provider: 'openai' });
    expect(cfg.provider).toBe('openai');
  });

  it('accepts anthropic provider', () => {
    const cfg = ModelConfigSchema.parse({ ...BASE_CONFIG, provider: 'anthropic' });
    expect(cfg.provider).toBe('anthropic');
  });

  it('accepts google provider', () => {
    const cfg = ModelConfigSchema.parse({ ...BASE_CONFIG, provider: 'google' });
    expect(cfg.provider).toBe('google');
  });

  it('accepts azure-openai provider', () => {
    const cfg = ModelConfigSchema.parse({ ...BASE_CONFIG, provider: 'azure-openai' });
    expect(cfg.provider).toBe('azure-openai');
  });

  it('accepts groq provider', () => {
    const cfg = ModelConfigSchema.parse({ ...BASE_CONFIG, provider: 'groq' });
    expect(cfg.provider).toBe('groq');
  });

  it('accepts mistral provider', () => {
    const cfg = ModelConfigSchema.parse({ ...BASE_CONFIG, provider: 'mistral' });
    expect(cfg.provider).toBe('mistral');
  });

  it('accepts openrouter provider', () => {
    const cfg = ModelConfigSchema.parse({ ...BASE_CONFIG, provider: 'openrouter' });
    expect(cfg.provider).toBe('openrouter');
  });

  it('accepts cohere provider', () => {
    const cfg = ModelConfigSchema.parse({ ...BASE_CONFIG, provider: 'cohere' });
    expect(cfg.provider).toBe('cohere');
  });

  it('accepts bedrock provider', () => {
    const cfg = ModelConfigSchema.parse({ ...BASE_CONFIG, provider: 'bedrock' });
    expect(cfg.provider).toBe('bedrock');
  });

  it('rejects unknown provider', () => {
    const result = ModelConfigSchema.safeParse({ ...BASE_CONFIG, provider: 'unknown' });
    expect(result.success).toBe(false);
  });
});
