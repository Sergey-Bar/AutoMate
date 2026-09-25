import { AiProviderSchema, AiProviderConfigSchema } from './ai-provider-schema.js';
import type { AiProvider, AiProviderConfig } from './ai-provider-schema.js';

// ─── AiProviderSchema ─────────────────────────────────────────────────────

describe('AiProviderSchema', () => {
  const validProviders = [
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

  it.each(validProviders)('parses valid provider: %s', (provider: string) => {
    const result = AiProviderSchema.safeParse(provider);
    expect(result.success).toBe(true);
  });

  it('rejects an unknown provider', () => {
    expect(AiProviderSchema.safeParse('gemini').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(AiProviderSchema.safeParse('').success).toBe(false);
  });

  it('rejects null', () => {
    expect(AiProviderSchema.safeParse(null).success).toBe(false);
  });

  it('rejects undefined', () => {
    expect(AiProviderSchema.safeParse(undefined).success).toBe(false);
  });

  it('rejects number', () => {
    expect(AiProviderSchema.safeParse(42).success).toBe(false);
  });

  it('is case-sensitive — rejects OpenAI (uppercase)', () => {
    expect(AiProviderSchema.safeParse('OpenAI').success).toBe(false);
  });

  it('is case-sensitive — rejects OLLAMA (uppercase)', () => {
    expect(AiProviderSchema.safeParse('OLLAMA').success).toBe(false);
  });

  it('rejects "azure_openai" (underscore instead of hyphen)', () => {
    expect(AiProviderSchema.safeParse('azure_openai').success).toBe(false);
  });

  it('rejects "open-ai" (hyphenated instead of solid)', () => {
    expect(AiProviderSchema.safeParse('open-ai').success).toBe(false);
  });

  it('rejects boolean', () => {
    expect(AiProviderSchema.safeParse(true).success).toBe(false);
  });

  it('infers AiProvider type', () => {
    const p: AiProvider = 'ollama';
    expect(AiProviderSchema.safeParse(p).success).toBe(true);
  });
});

// ─── AiProviderConfigSchema — ollama ─────────────────────────────────────

describe('AiProviderConfigSchema — ollama', () => {
  it('parses minimal ollama config (no baseUrl)', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'ollama',
      model: 'llama3.1',
    });
    expect(result.success).toBe(true);
  });

  it('parses ollama config with baseUrl', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'ollama',
      model: 'llama3.1',
      baseUrl: 'http://localhost:11434',
    });
    expect(result.success).toBe(true);
  });

  it('parses ollama config with custom remote baseUrl', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'ollama',
      model: 'mistral',
      baseUrl: 'https://my-ollama.example.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects ollama config missing model', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'ollama',
    });
    expect(result.success).toBe(false);
  });

  it('rejects ollama config with invalid baseUrl', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'ollama',
      model: 'llama3.1',
      baseUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('rejects ollama config with non-string model', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'ollama',
      model: 42,
    });
    expect(result.success).toBe(false);
  });
});

// ─── AiProviderConfigSchema — openai ─────────────────────────────────────

describe('AiProviderConfigSchema — openai', () => {
  it('parses minimal openai config', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-abc123',
    });
    expect(result.success).toBe(true);
  });

  it('parses openai config with optional baseUrl', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-abc123',
      baseUrl: 'https://api.openai.com/v1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects openai config missing apiKey', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'openai',
      model: 'gpt-4o',
    });
    expect(result.success).toBe(false);
  });

  it('rejects openai config missing model', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'openai',
      apiKey: 'sk-abc123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects openai config with invalid baseUrl', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-abc123',
      baseUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });
});

// ─── AiProviderConfigSchema — anthropic ──────────────────────────────────

describe('AiProviderConfigSchema — anthropic', () => {
  it('parses valid anthropic config', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      apiKey: 'sk-ant-abc123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects anthropic config missing apiKey', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
    });
    expect(result.success).toBe(false);
  });

  it('rejects anthropic config missing model', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'anthropic',
      apiKey: 'sk-ant-abc123',
    });
    expect(result.success).toBe(false);
  });
});

// ─── AiProviderConfigSchema — google ─────────────────────────────────────

describe('AiProviderConfigSchema — google', () => {
  it('parses valid google config', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'google',
      model: 'gemini-1.5-pro',
      apiKey: 'AIzaSy-abc123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects google config missing apiKey', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'google',
      model: 'gemini-1.5-pro',
    });
    expect(result.success).toBe(false);
  });

  it('rejects google config missing model', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'google',
      apiKey: 'AIzaSy-abc123',
    });
    expect(result.success).toBe(false);
  });
});

// ─── AiProviderConfigSchema — azure-openai ───────────────────────────────

describe('AiProviderConfigSchema — azure-openai', () => {
  it('parses valid azure-openai config', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'azure-openai',
      model: 'gpt-4o',
      apiKey: 'azure-key-abc',
      baseUrl: 'https://my-resource.openai.azure.com',
      apiVersion: '2024-02-01',
    });
    expect(result.success).toBe(true);
  });

  it('rejects azure-openai config missing apiVersion', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'azure-openai',
      model: 'gpt-4o',
      apiKey: 'azure-key-abc',
      baseUrl: 'https://my-resource.openai.azure.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects azure-openai config missing baseUrl', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'azure-openai',
      model: 'gpt-4o',
      apiKey: 'azure-key-abc',
      apiVersion: '2024-02-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects azure-openai config with invalid baseUrl', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'azure-openai',
      model: 'gpt-4o',
      apiKey: 'azure-key-abc',
      baseUrl: 'not-a-url',
      apiVersion: '2024-02-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects azure-openai config missing apiKey', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'azure-openai',
      model: 'gpt-4o',
      baseUrl: 'https://my-resource.openai.azure.com',
      apiVersion: '2024-02-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects azure-openai config missing model', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'azure-openai',
      apiKey: 'azure-key-abc',
      baseUrl: 'https://my-resource.openai.azure.com',
      apiVersion: '2024-02-01',
    });
    expect(result.success).toBe(false);
  });
});

// ─── AiProviderConfigSchema — groq ───────────────────────────────────────

describe('AiProviderConfigSchema — groq', () => {
  it('parses valid groq config', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'groq',
      model: 'llama-3.1-70b-versatile',
      apiKey: 'gsk_abc123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects groq config missing apiKey', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'groq',
      model: 'llama-3.1-70b-versatile',
    });
    expect(result.success).toBe(false);
  });

  it('rejects groq config missing model', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'groq',
      apiKey: 'gsk_abc123',
    });
    expect(result.success).toBe(false);
  });
});

// ─── AiProviderConfigSchema — mistral ────────────────────────────────────

describe('AiProviderConfigSchema — mistral', () => {
  it('parses valid mistral config', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'mistral',
      model: 'mistral-large-latest',
      apiKey: 'mist-abc123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects mistral config missing apiKey', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'mistral',
      model: 'mistral-large-latest',
    });
    expect(result.success).toBe(false);
  });

  it('rejects mistral config missing model', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'mistral',
      apiKey: 'mist-abc123',
    });
    expect(result.success).toBe(false);
  });
});

// ─── AiProviderConfigSchema — openrouter ─────────────────────────────────

describe('AiProviderConfigSchema — openrouter', () => {
  it('parses valid openrouter config', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'openrouter',
      model: 'openai/gpt-4o',
      apiKey: 'sk-or-abc123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects openrouter config missing apiKey', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'openrouter',
      model: 'openai/gpt-4o',
    });
    expect(result.success).toBe(false);
  });

  it('rejects openrouter config missing model', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'openrouter',
      apiKey: 'sk-or-abc123',
    });
    expect(result.success).toBe(false);
  });
});

// ─── AiProviderConfigSchema — cohere ─────────────────────────────────────

describe('AiProviderConfigSchema — cohere', () => {
  it('parses valid cohere config', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'cohere',
      model: 'command-r-plus',
      apiKey: 'co-abc123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects cohere config missing apiKey', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'cohere',
      model: 'command-r-plus',
    });
    expect(result.success).toBe(false);
  });

  it('rejects cohere config missing model', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'cohere',
      apiKey: 'co-abc123',
    });
    expect(result.success).toBe(false);
  });
});

// ─── AiProviderConfigSchema — bedrock ────────────────────────────────────

describe('AiProviderConfigSchema — bedrock', () => {
  it('parses valid bedrock config (no sessionToken)', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'bedrock',
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      accessKeyId: 'TESTACCESSKEYID',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
    });
    expect(result.success).toBe(true);
  });

  it('parses bedrock config with optional sessionToken', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'bedrock',
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      accessKeyId: 'TESTACCESSKEYID',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      sessionToken: 'my-session-token',
    });
    expect(result.success).toBe(true);
  });

  it('rejects bedrock config missing accessKeyId', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'bedrock',
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects bedrock config missing secretAccessKey', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'bedrock',
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      accessKeyId: 'TESTACCESSKEYID',
      region: 'us-east-1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects bedrock config missing region', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'bedrock',
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      accessKeyId: 'TESTACCESSKEYID',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });
    expect(result.success).toBe(false);
  });

  it('rejects bedrock config missing model', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'bedrock',
      accessKeyId: 'TESTACCESSKEYID',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
    });
    expect(result.success).toBe(false);
  });
});

// ─── AiProviderConfigSchema — discriminated union rejection ───────────────

describe('AiProviderConfigSchema — unknown/invalid provider', () => {
  it('rejects config with unknown provider', () => {
    const result = AiProviderConfigSchema.safeParse({
      provider: 'gemini',
      model: 'gemini-pro',
      apiKey: 'key',
    });
    expect(result.success).toBe(false);
  });

  it('rejects config with missing provider', () => {
    const result = AiProviderConfigSchema.safeParse({
      model: 'gpt-4o',
      apiKey: 'key',
    });
    expect(result.success).toBe(false);
  });

  it('rejects null', () => {
    expect(AiProviderConfigSchema.safeParse(null).success).toBe(false);
  });

  it('rejects undefined', () => {
    expect(AiProviderConfigSchema.safeParse(undefined).success).toBe(false);
  });

  it('rejects empty object', () => {
    expect(AiProviderConfigSchema.safeParse({}).success).toBe(false);
  });

  it('rejects array', () => {
    expect(AiProviderConfigSchema.safeParse([]).success).toBe(false);
  });
});

// ─── AiProviderConfigSchema — type inference ─────────────────────────────

describe('AiProviderConfigSchema — TypeScript type inference', () => {
  it('infers AiProviderConfig type for ollama', () => {
    const config = AiProviderConfigSchema.parse({
      provider: 'ollama',
      model: 'llama3.1',
    }) as AiProviderConfig;
    expect(config.provider).toBe('ollama');
    expect(config.model).toBe('llama3.1');
  });

  it('infers AiProviderConfig type for openai', () => {
    const config = AiProviderConfigSchema.parse({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-abc',
    }) as AiProviderConfig;
    expect(config.provider).toBe('openai');
  });

  it('infers AiProviderConfig type for bedrock', () => {
    const config = AiProviderConfigSchema.parse({
      provider: 'bedrock',
      model: 'amazon.titan-text-express-v1',
      accessKeyId: 'TESTACCESSKEYID',
      secretAccessKey: 'secret',
      region: 'us-west-2',
    }) as AiProviderConfig;
    expect(config.provider).toBe('bedrock');
  });
});

// ─── StringLiteral mutation-killing tests ─────────────────────────────────

describe('AiProviderSchema — StringLiteral mutations', () => {
  it('rejects "open-router" (hyphen variant) — kills StringLiteral mutation on "openrouter"', () => {
    expect(AiProviderSchema.safeParse('open-router').success).toBe(false);
  });

  it('parses exactly "openrouter" — kills StringLiteral mutation', () => {
    expect(AiProviderSchema.safeParse('openrouter').success).toBe(true);
  });

  it('rejects "azure_openai" (underscore) — kills StringLiteral mutation on "azure-openai"', () => {
    expect(AiProviderSchema.safeParse('azure_openai').success).toBe(false);
  });

  it('parses exactly "azure-openai" — kills StringLiteral mutation', () => {
    expect(AiProviderSchema.safeParse('azure-openai').success).toBe(true);
  });

  it('rejects "aws-bedrock" — kills StringLiteral mutation on "bedrock"', () => {
    expect(AiProviderSchema.safeParse('aws-bedrock').success).toBe(false);
  });

  it('parses exactly "bedrock" — kills StringLiteral mutation', () => {
    expect(AiProviderSchema.safeParse('bedrock').success).toBe(true);
  });

  it('rejects "coherent" — kills StringLiteral mutation on "cohere"', () => {
    expect(AiProviderSchema.safeParse('coherent').success).toBe(false);
  });

  it('parses exactly "cohere" — kills StringLiteral mutation', () => {
    expect(AiProviderSchema.safeParse('cohere').success).toBe(true);
  });
});

describe('AiProviderConfigSchema — azure-specific field mutations', () => {
  const baseAzure = {
    provider: 'azure-openai' as const,
    model: 'gpt-4o',
    apiKey: 'key',
    baseUrl: 'https://resource.openai.azure.com',
    apiVersion: '2024-02-01',
  };

  it('rejects when apiVersion is missing from azure-openai — kills optional-vs-required mutation', () => {
    const { apiVersion: _v, ...withoutApiVersion } = baseAzure;
    expect(AiProviderConfigSchema.safeParse(withoutApiVersion).success).toBe(false);
  });

  it('rejects when baseUrl is missing from azure-openai — kills optional-vs-required mutation', () => {
    const { baseUrl: _u, ...withoutBaseUrl } = baseAzure;
    expect(AiProviderConfigSchema.safeParse(withoutBaseUrl).success).toBe(false);
  });

  it('parses azure-openai with all required fields — kills false-mutation', () => {
    expect(AiProviderConfigSchema.safeParse(baseAzure).success).toBe(true);
  });
});

describe('AiProviderConfigSchema — bedrock-specific field mutations', () => {
  const baseBedrock = {
    provider: 'bedrock' as const,
    model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    accessKeyId: 'AKID',
    secretAccessKey: 'secret',
    region: 'us-east-1',
  };

  it('rejects when accessKeyId missing — kills field-required mutation', () => {
    const { accessKeyId: _a, ...without } = baseBedrock;
    expect(AiProviderConfigSchema.safeParse(without).success).toBe(false);
  });

  it('rejects when secretAccessKey missing — kills field-required mutation', () => {
    const { secretAccessKey: _s, ...without } = baseBedrock;
    expect(AiProviderConfigSchema.safeParse(without).success).toBe(false);
  });

  it('rejects when region missing — kills field-required mutation', () => {
    const { region: _r, ...without } = baseBedrock;
    expect(AiProviderConfigSchema.safeParse(without).success).toBe(false);
  });

  it('sessionToken is optional on bedrock — parses without it', () => {
    expect(AiProviderConfigSchema.safeParse(baseBedrock).success).toBe(true);
  });

  it('sessionToken is optional on bedrock — parses with it', () => {
    expect(AiProviderConfigSchema.safeParse({ ...baseBedrock, sessionToken: 'tok' }).success).toBe(true);
  });
});

describe('AiProviderConfigSchema — ollama baseUrl optional mutation', () => {
  it('parses ollama WITHOUT baseUrl (optional) — kills required-mutation', () => {
    expect(
      AiProviderConfigSchema.safeParse({ provider: 'ollama', model: 'llama3' }).success,
    ).toBe(true);
  });

  it('parses ollama WITH baseUrl (optional present) — kills optional-always-absent mutation', () => {
    expect(
      AiProviderConfigSchema.safeParse({
        provider: 'ollama',
        model: 'llama3',
        baseUrl: 'http://localhost:11434',
      }).success,
    ).toBe(true);
  });
});

describe('AiProviderConfigSchema — dualAgentRca optional field', () => {
  const providers = [
    { provider: 'ollama', model: 'llama3' },
    { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
    { provider: 'anthropic', apiKey: 'ant-key', model: 'claude-3-sonnet' },
    { provider: 'google', apiKey: 'goog-key', model: 'gemini-1.5-pro' },
    { provider: 'azure-openai', apiKey: 'az-key', model: 'gpt-4o', baseUrl: 'https://resource.openai.azure.com', apiVersion: '2024-02-01' },
    { provider: 'groq', apiKey: 'groq-key', model: 'llama3-70b-8192' },
    { provider: 'mistral', apiKey: 'mist-key', model: 'mistral-large-latest' },
    { provider: 'openrouter', apiKey: 'or-key', model: 'openai/gpt-4o' },
    { provider: 'cohere', apiKey: 'coh-key', model: 'command-r-plus' },
    { provider: 'bedrock', accessKeyId: 'AKID', secretAccessKey: 'secret', region: 'us-east-1', model: 'anthropic.claude-3' },
  ] as const;

  it.each(providers)('accepts dualAgentRca: true for provider $provider', (base) => {
    const result = AiProviderConfigSchema.safeParse({ ...base, dualAgentRca: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dualAgentRca).toBe(true);
    }
  });

  it.each(providers)('accepts dualAgentRca: false for provider $provider', (base) => {
    const result = AiProviderConfigSchema.safeParse({ ...base, dualAgentRca: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dualAgentRca).toBe(false);
    }
  });

  it.each(providers)('accepts missing dualAgentRca (undefined) for provider $provider', (base) => {
    const result = AiProviderConfigSchema.safeParse({ ...base });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dualAgentRca).toBeUndefined();
    }
  });

  it('rejects non-boolean dualAgentRca', () => {
    const result = AiProviderConfigSchema.safeParse({ provider: 'openai', apiKey: 'sk', model: 'gpt-4o', dualAgentRca: 'true' });
    expect(result.success).toBe(false);
  });
});
