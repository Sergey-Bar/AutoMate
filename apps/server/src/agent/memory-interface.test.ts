import { describe, expect, it } from 'vitest';
import type { MemoryRepository } from './memory.js';

describe('MemoryRepository interface', () => {
  it('requires conversation CRUD methods', () => {
    // Type-check: this should compile if the interface is correct
    const repo: MemoryRepository = {
      saveConversation: async () => {},
      getConversation: async () => null,
      listConversations: async () => [],
      deleteConversation: async () => {},
      saveMessage: async () => {},
      listMessages: async () => [],
      insertExecutionLog: async () => {},
    };
    expect(repo).toBeDefined();
  });
});
