import {
  AIProviderNameSchema,
  AIProviderConfigSchema,
  AIModelInfoSchema,
  ChatMessageSchema,
  ToolCallSchema,
  ToolResultSchema,
  ChatStreamEventSchema,
} from './ai.js';

// ---------------------------------------------------------------------------
// AIProviderNameSchema
// ---------------------------------------------------------------------------

describe('AIProviderNameSchema', () => {
  it('accepts all defined providers', () => {
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
    ];
    for (const p of providers) {
      expect(AIProviderNameSchema.safeParse(p).success).toBe(true);
    }
  });

  it('rejects an unknown provider', () => {
    expect(AIProviderNameSchema.safeParse('huggingface').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AIProviderConfigSchema
// ---------------------------------------------------------------------------

describe('AIProviderConfigSchema', () => {
  it('accepts a valid full config', () => {
    const result = AIProviderConfigSchema.safeParse({
      provider: 'openai',
      model: 'gpt-4o',
      endpoint: 'https://api.openai.com/v1',
      temperature: 0.7,
      maxTokens: 4096,
      apiKey: 'sk-test',
    });
    expect(result.success).toBe(true);
  });

  it('accepts minimal config without optional fields', () => {
    const result = AIProviderConfigSchema.safeParse({
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when model is missing', () => {
    const result = AIProviderConfigSchema.safeParse({
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('model');
    }
  });

  it('rejects when endpoint is not a valid URL', () => {
    const result = AIProviderConfigSchema.safeParse({
      provider: 'openai',
      model: 'gpt-4o',
      endpoint: 'not-a-url',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('endpoint');
    }
  });
});

// ---------------------------------------------------------------------------
// AIModelInfoSchema
// ---------------------------------------------------------------------------

describe('AIModelInfoSchema', () => {
  it('accepts a valid model info', () => {
    const result = AIModelInfoSchema.safeParse({
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
      contextWindow: 128000,
      supportsTools: true,
      supportsStreaming: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects when supportsTools is missing', () => {
    const result = AIModelInfoSchema.safeParse({
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
      supportsStreaming: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('supportsTools');
    }
  });
});

// ---------------------------------------------------------------------------
// ChatMessageSchema
// ---------------------------------------------------------------------------

describe('ChatMessageSchema', () => {
  it('accepts a valid user message', () => {
    const result = ChatMessageSchema.safeParse({ role: 'user', content: 'Hello' });
    expect(result.success).toBe(true);
  });

  it('accepts a tool message with toolCallId', () => {
    const result = ChatMessageSchema.safeParse({
      role: 'tool',
      content: '{"result": "ok"}',
      toolCallId: 'call-1',
      toolName: 'github.createIssue',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid role', () => {
    const result = ChatMessageSchema.safeParse({ role: 'bot', content: 'hi' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('role');
    }
  });

  it('rejects when content is missing', () => {
    const result = ChatMessageSchema.safeParse({ role: 'user' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('content');
    }
  });
});

// ---------------------------------------------------------------------------
// ToolCallSchema
// ---------------------------------------------------------------------------

describe('ToolCallSchema', () => {
  it('accepts a valid tool call', () => {
    const result = ToolCallSchema.safeParse({
      id: 'call-abc',
      toolName: 'github.createIssue',
      args: { title: 'Bug', body: 'Details' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects when toolName is missing', () => {
    const result = ToolCallSchema.safeParse({ id: 'call-1', args: {} });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('toolName');
    }
  });
});

// ---------------------------------------------------------------------------
// ToolResultSchema
// ---------------------------------------------------------------------------

describe('ToolResultSchema', () => {
  it('accepts a successful tool result', () => {
    const result = ToolResultSchema.safeParse({
      toolCallId: 'call-abc',
      toolName: 'github.createIssue',
      result: { issueNumber: 42, url: 'https://github.com/org/repo/issues/42' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an error tool result', () => {
    const result = ToolResultSchema.safeParse({
      toolCallId: 'call-xyz',
      toolName: 'jira.createIssue',
      result: null,
      error: 'Unauthorized',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when toolCallId is missing', () => {
    const result = ToolResultSchema.safeParse({ toolName: 'tool', result: {} });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('toolCallId');
    }
  });
});

// ---------------------------------------------------------------------------
// ChatStreamEventSchema
// ---------------------------------------------------------------------------

describe('ChatStreamEventSchema', () => {
  it('accepts a text-delta event', () => {
    const result = ChatStreamEventSchema.safeParse({ type: 'text-delta', delta: 'Hello' });
    expect(result.success).toBe(true);
  });

  it('accepts a finish event with finishReason', () => {
    const result = ChatStreamEventSchema.safeParse({ type: 'finish', finishReason: 'stop' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown event type', () => {
    const result = ChatStreamEventSchema.safeParse({ type: 'heartbeat' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('type');
    }
  });
});
