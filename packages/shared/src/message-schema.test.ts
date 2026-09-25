import { describe, expect, it } from 'vitest';
import { MessageSchema } from './index.js';

describe('MessageSchema', () => {
  it('parses tool result messages with metadata', () => {
    const msg = MessageSchema.parse({
      id: 'm1',
      conversationId: 'c1',
      role: 'tool',
      content: '{"ok":true}',
      toolCallId: 'call-1',
      toolName: 'github.create_issue',
      metadata: '{"latencyMs":120}',
      createdAt: '2026-03-12T00:00:00.000Z',
    });
    expect(msg.role).toBe('tool');
  });
});
