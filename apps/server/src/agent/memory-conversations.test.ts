import { describe, expect, it } from 'vitest';
import { createMemoryRepository } from './memory.js';

describe('memory conversations', () => {
  it('stores and lists conversations', async () => {
    const repo = createMemoryRepository();
    await repo.saveConversation({ id: 'c1', title: 't1' });
    const list = await repo.listConversations();
    expect(list[0].id).toBe('c1');
  });
});
