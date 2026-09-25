import { describe, it } from 'vitest';
import fc from 'fast-check';
import {
  ConversationSchema,
  MessageSchema,
  ConnectorConfigSchema,
  FlowTemplateSchema,
  ExecutionLogSchema,
  ModelConfigSchema,
} from '../index.js';

// Deterministic seed for reproducible runs
fc.configureGlobal({ seed: 42, numRuns: 50 });

// ─── Shared arbitraries ──────────────────────────────────────────────────────

const str = fc.string({ minLength: 1, maxLength: 40 });
const nullableStr = fc.option(fc.string({ minLength: 0, maxLength: 40 }), { nil: null });

const isoDate = fc.constantFrom(
  '2026-01-01T00:00:00.000Z',
  '2025-06-15T12:30:00.000Z',
  '2024-12-31T23:59:59.000Z',
);

const messageRoleArb = fc.constantFrom(
  'user' as const,
  'assistant' as const,
  'system' as const,
  'tool' as const,
);

const executionStatusArb = fc.constantFrom(
  'running' as const,
  'success' as const,
  'error' as const,
  'timeout' as const,
);

const providerArb = fc.constantFrom(
  'ollama' as const,
  'openai' as const,
  'anthropic' as const,
  'google' as const,
  'azure-openai' as const,
  'groq' as const,
  'mistral' as const,
  'openrouter' as const,
  'cohere' as const,
  'bedrock' as const,
);

const validUrlArb = fc.constantFrom(
  'http://localhost:11434',
  'https://api.openai.com/v1',
  'https://api.anthropic.com',
  'http://127.0.0.1:3000',
);

const positiveNumberArb = fc.float({ min: 0, max: 2, noNaN: true });
const positiveIntArb = fc.integer({ min: 1, max: 8192 });
const nullableNumberArb = fc.option(fc.integer({ min: 0, max: 60000 }), { nil: null });

// ─── Arbitraries per schema ──────────────────────────────────────────────────

const conversationArb = fc.record({
  id: str,
  title: nullableStr,
  flowTemplateId: nullableStr,
  createdAt: isoDate,
  updatedAt: isoDate,
});

const messageArb = fc.record({
  id: str,
  conversationId: str,
  role: messageRoleArb,
  content: fc.string({ minLength: 0, maxLength: 200 }),
  toolCallId: nullableStr,
  toolName: nullableStr,
  metadata: nullableStr,
  createdAt: isoDate,
});

const connectorConfigArb = fc.record({
  id: str,
  connectorName: str,
  enabled: fc.boolean(),
  credentialRef: nullableStr,
  settings: nullableStr,
  updatedAt: isoDate,
});

const flowTemplateArb = fc.record({
  id: str,
  name: str,
  description: nullableStr,
  systemPrompt: fc.string({ minLength: 0, maxLength: 500 }),
  steps: nullableStr,
  category: nullableStr,
  isBuiltIn: fc.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

const executionLogArb = fc.record({
  id: str,
  conversationId: nullableStr,
  toolName: str,
  input: fc.string({ minLength: 0, maxLength: 200 }),
  output: nullableStr,
  status: executionStatusArb,
  durationMs: nullableNumberArb,
  errorMessage: nullableStr,
  createdAt: isoDate,
});

const modelConfigArb = fc.record({
  id: str,
  provider: providerArb,
  model: str,
  endpoint: validUrlArb,
  temperature: positiveNumberArb,
  maxTokens: positiveIntArb,
  systemPrompt: nullableStr,
  updatedAt: isoDate,
});

// ─── ConversationSchema ──────────────────────────────────────────────────────

describe('ConversationSchema — property tests', () => {
  it('roundtrip: parse never throws for generated valid data', () => {
    fc.assert(
      fc.property(conversationArb, (data) => {
        ConversationSchema.parse(data);
      }),
    );
  });

  it('JSON serialization: JSON.parse(JSON.stringify(parsed)) still passes schema', () => {
    fc.assert(
      fc.property(conversationArb, (data) => {
        const parsed = ConversationSchema.parse(data);
        ConversationSchema.parse(JSON.parse(JSON.stringify(parsed)));
      }),
    );
  });
});

// ─── MessageSchema ───────────────────────────────────────────────────────────

describe('MessageSchema — property tests', () => {
  it('roundtrip: parse never throws for generated valid data', () => {
    fc.assert(
      fc.property(messageArb, (data) => {
        MessageSchema.parse(data);
      }),
    );
  });

  it('JSON serialization: JSON.parse(JSON.stringify(parsed)) still passes schema', () => {
    fc.assert(
      fc.property(messageArb, (data) => {
        const parsed = MessageSchema.parse(data);
        MessageSchema.parse(JSON.parse(JSON.stringify(parsed)));
      }),
    );
  });
});

// ─── ConnectorConfigSchema ───────────────────────────────────────────────────

describe('ConnectorConfigSchema — property tests', () => {
  it('roundtrip: parse never throws for generated valid data', () => {
    fc.assert(
      fc.property(connectorConfigArb, (data) => {
        ConnectorConfigSchema.parse(data);
      }),
    );
  });

  it('JSON serialization: JSON.parse(JSON.stringify(parsed)) still passes schema', () => {
    fc.assert(
      fc.property(connectorConfigArb, (data) => {
        const parsed = ConnectorConfigSchema.parse(data);
        ConnectorConfigSchema.parse(JSON.parse(JSON.stringify(parsed)));
      }),
    );
  });
});

// ─── FlowTemplateSchema ──────────────────────────────────────────────────────

describe('FlowTemplateSchema — property tests', () => {
  it('roundtrip: parse never throws for generated valid data', () => {
    fc.assert(
      fc.property(flowTemplateArb, (data) => {
        FlowTemplateSchema.parse(data);
      }),
    );
  });

  it('JSON serialization: JSON.parse(JSON.stringify(parsed)) still passes schema', () => {
    fc.assert(
      fc.property(flowTemplateArb, (data) => {
        const parsed = FlowTemplateSchema.parse(data);
        FlowTemplateSchema.parse(JSON.parse(JSON.stringify(parsed)));
      }),
    );
  });
});

// ─── ExecutionLogSchema ──────────────────────────────────────────────────────

describe('ExecutionLogSchema — property tests', () => {
  it('roundtrip: parse never throws for generated valid data', () => {
    fc.assert(
      fc.property(executionLogArb, (data) => {
        ExecutionLogSchema.parse(data);
      }),
    );
  });

  it('JSON serialization: JSON.parse(JSON.stringify(parsed)) still passes schema', () => {
    fc.assert(
      fc.property(executionLogArb, (data) => {
        const parsed = ExecutionLogSchema.parse(data);
        ExecutionLogSchema.parse(JSON.parse(JSON.stringify(parsed)));
      }),
    );
  });
});

// ─── ModelConfigSchema ───────────────────────────────────────────────────────

describe('ModelConfigSchema — property tests', () => {
  it('roundtrip: parse never throws for generated valid data', () => {
    fc.assert(
      fc.property(modelConfigArb, (data) => {
        ModelConfigSchema.parse(data);
      }),
    );
  });

  it('JSON serialization: JSON.parse(JSON.stringify(parsed)) still passes schema', () => {
    fc.assert(
      fc.property(modelConfigArb, (data) => {
        const parsed = ModelConfigSchema.parse(data);
        ModelConfigSchema.parse(JSON.parse(JSON.stringify(parsed)));
      }),
    );
  });
});
