import { describe, expect, it } from 'vitest';
import { ConversationSchema } from './index.js';

describe('ConversationSchema', () => {
  it('parses persisted conversation row', () => {
    const row = ConversationSchema.parse({
      id: 'c1',
      title: 'Regression Gate',
      flowTemplateId: null,
      createdAt: '2026-03-12T00:00:00.000Z',
      updatedAt: '2026-03-12T00:00:00.000Z',
    });
    expect(row.id).toBe('c1');
  });
});
