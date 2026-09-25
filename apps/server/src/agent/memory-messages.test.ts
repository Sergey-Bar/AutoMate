import { describe, expect, it } from 'vitest';
import { createMemoryRepository } from './memory.js';

describe('memory messages', () => {
  it('persists and filters by conversation', async () => {
    const repo = createMemoryRepository();
    await repo.saveMessage({ id: 'm1', conversationId: 'c1', role: 'user', content: 'hi' });
    await repo.saveMessage({ id: 'm2', conversationId: 'c2', role: 'user', content: 'yo' });
    const c1 = await repo.listMessages('c1');
    expect(c1).toHaveLength(1);
    expect(c1[0].content).toBe('hi');
  });
});
