import {
  ConversationSchema,
  ConversationMessageSchema,
  ConversationCreateRequestSchema,
} from './conversations.js';

// ---------------------------------------------------------------------------
// ConversationSchema
// ---------------------------------------------------------------------------

describe('ConversationSchema', () => {
  it('accepts a valid conversation', () => {
    const result = ConversationSchema.safeParse({
      id: 'conv-001',
      title: 'Smoke test run',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T01:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a conversation without optional title and flowTemplateId', () => {
    const result = ConversationSchema.safeParse({
      id: 'conv-002',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when id is missing', () => {
    const result = ConversationSchema.safeParse({
      title: 'No id',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('id');
    }
  });

  it('rejects when createdAt is missing', () => {
    const result = ConversationSchema.safeParse({
      id: 'conv-003',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('createdAt');
    }
  });
});

// ---------------------------------------------------------------------------
// ConversationMessageSchema
// ---------------------------------------------------------------------------

describe('ConversationMessageSchema', () => {
  it('accepts a valid user message', () => {
    const result = ConversationMessageSchema.safeParse({
      id: 'msg-001',
      conversationId: 'conv-001',
      role: 'user',
      content: 'Run the smoke tests',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a tool message with all optional fields', () => {
    const result = ConversationMessageSchema.safeParse({
      id: 'msg-002',
      conversationId: 'conv-001',
      role: 'tool',
      content: '{"status": "done"}',
      toolCallId: 'call-abc',
      toolName: 'github.createIssue',
      metadata: { duration: 120 },
      createdAt: '2026-01-01T00:01:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid role', () => {
    const result = ConversationMessageSchema.safeParse({
      id: 'msg-003',
      conversationId: 'conv-001',
      role: 'bot',
      content: 'hi',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('role');
    }
  });

  it('rejects when conversationId is missing', () => {
    const result = ConversationMessageSchema.safeParse({
      id: 'msg-004',
      role: 'user',
      content: 'hello',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('conversationId');
    }
  });
});

// ---------------------------------------------------------------------------
// ConversationCreateRequestSchema
// ---------------------------------------------------------------------------

describe('ConversationCreateRequestSchema', () => {
  it('accepts an empty create request (all fields optional)', () => {
    const result = ConversationCreateRequestSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a full create request', () => {
    const result = ConversationCreateRequestSchema.safeParse({
      title: 'New conversation',
      flowTemplateId: 'tpl-001',
      systemPrompt: 'You are a QA assistant.',
      initialMessage: 'Hello!',
    });
    expect(result.success).toBe(true);
  });
});
