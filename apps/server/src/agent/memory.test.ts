import { describe, expect, it, beforeEach } from 'vitest';
import { createMemoryRepository } from './memory.js';

describe('createMemoryRepository', () => {
  describe('saveConversation + getConversation round-trip', () => {
    it('saves and retrieves a conversation by id', async () => {
      const repo = createMemoryRepository();
      await repo.saveConversation({ id: 'conv-1', title: 'Test Conversation' });

      const result = await repo.getConversation('conv-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('conv-1');
      expect(result!.title).toBe('Test Conversation');
      expect(result!.createdAt).toBeDefined();
    });

    it('saves a conversation with null title', async () => {
      const repo = createMemoryRepository();
      await repo.saveConversation({ id: 'conv-null', title: null });

      const result = await repo.getConversation('conv-null');

      expect(result).not.toBeNull();
      expect(result!.title).toBeNull();
    });

    it('stores a valid ISO createdAt timestamp', async () => {
      const repo = createMemoryRepository();
      // eslint-disable-next-line test-flakiness/no-random-data
      const before = new Date().toISOString();
      await repo.saveConversation({ id: 'conv-ts', title: 'Timestamps' });
      // eslint-disable-next-line test-flakiness/no-random-data
      const after = new Date().toISOString();

      const result = await repo.getConversation('conv-ts');

      expect(result!.createdAt >= before).toBe(true);
      expect(result!.createdAt <= after).toBe(true);
    });
  });

  describe('getConversation', () => {
    it('returns null for an unknown id', async () => {
      const repo = createMemoryRepository();

      const result = await repo.getConversation('does-not-exist');

      expect(result).toBeNull();
    });

    it('returns null when no conversations have been saved', async () => {
      const repo = createMemoryRepository();

      const result = await repo.getConversation('anything');

      expect(result).toBeNull();
    });
  });

  describe('listConversations', () => {
    let repo: ReturnType<typeof createMemoryRepository>;

    beforeEach(async () => {
      repo = createMemoryRepository();
      await repo.saveConversation({ id: 'c1', title: 'First' });
      await repo.saveConversation({ id: 'c2', title: 'Second' });
      await repo.saveConversation({ id: 'c3', title: 'Third' });
    });

    it('returns all conversations when called with no args', async () => {
      const result = await repo.listConversations();

      expect(result).toHaveLength(3);
      expect(result.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    });

    it('returns empty array when no conversations exist', async () => {
      const emptyRepo = createMemoryRepository();
      const result = await emptyRepo.listConversations();

      expect(result).toEqual([]);
    });

    it('limits results when limit is provided', async () => {
      const result = await repo.listConversations({ limit: 2 });

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('c1');
      expect(result[1]!.id).toBe('c2');
    });

    it('skips results when offset is provided', async () => {
      const result = await repo.listConversations({ offset: 1 });

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('c2');
      expect(result[1]!.id).toBe('c3');
    });

    it('applies both limit and offset together', async () => {
      const result = await repo.listConversations({ limit: 1, offset: 1 });

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('c2');
    });

    it('returns empty array when offset exceeds total count', async () => {
      const result = await repo.listConversations({ offset: 10 });

      expect(result).toEqual([]);
    });

    it('returns all conversations when limit is larger than count', async () => {
      const result = await repo.listConversations({ limit: 100 });

      expect(result).toHaveLength(3);
    });

    it('returns all from offset when only offset provided (no limit)', async () => {
      const result = await repo.listConversations({ offset: 2 });

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('c3');
    });
  });

  describe('deleteConversation', () => {
    it('removes the conversation from the store', async () => {
      const repo = createMemoryRepository();
      await repo.saveConversation({ id: 'del-1', title: 'To Delete' });

      await repo.deleteConversation('del-1');

      const result = await repo.getConversation('del-1');
      expect(result).toBeNull();
    });

    it('cascades deletion to messages belonging to that conversation', async () => {
      const repo = createMemoryRepository();
      await repo.saveConversation({ id: 'conv-cascade', title: 'Cascade' });
      await repo.saveMessage({ id: 'm1', conversationId: 'conv-cascade', role: 'user', content: 'Hi' });
      await repo.saveMessage({ id: 'm2', conversationId: 'conv-cascade', role: 'assistant', content: 'Hello' });

      await repo.deleteConversation('conv-cascade');

      const msgs = await repo.listMessages('conv-cascade');
      expect(msgs).toEqual([]);
    });

    it('does not affect messages from other conversations when deleting', async () => {
      const repo = createMemoryRepository();
      await repo.saveConversation({ id: 'conv-a', title: 'A' });
      await repo.saveConversation({ id: 'conv-b', title: 'B' });
      await repo.saveMessage({ id: 'ma1', conversationId: 'conv-a', role: 'user', content: 'In A' });
      await repo.saveMessage({ id: 'mb1', conversationId: 'conv-b', role: 'user', content: 'In B' });

      await repo.deleteConversation('conv-a');

      const remaining = await repo.listMessages('conv-b');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.id).toBe('mb1');
    });

    it('does not throw when deleting a non-existent conversation', async () => {
      const repo = createMemoryRepository();

      await expect(repo.deleteConversation('ghost-id')).resolves.not.toThrow();
    });

    it('removes only the target conversation leaving others intact', async () => {
      const repo = createMemoryRepository();
      await repo.saveConversation({ id: 'keep-1', title: 'Keep' });
      await repo.saveConversation({ id: 'remove-1', title: 'Remove' });

      await repo.deleteConversation('remove-1');

      const all = await repo.listConversations();
      expect(all).toHaveLength(1);
      expect(all[0]!.id).toBe('keep-1');
    });
  });

  describe('saveMessage + listMessages round-trip', () => {
    it('saves and retrieves a message', async () => {
      const repo = createMemoryRepository();
      await repo.saveMessage({
        id: 'msg-1',
        conversationId: 'conv-x',
        role: 'user',
        content: 'Hello world',
      });

      const msgs = await repo.listMessages('conv-x');

      expect(msgs).toHaveLength(1);
      expect(msgs[0]!.id).toBe('msg-1');
      expect(msgs[0]!.conversationId).toBe('conv-x');
      expect(msgs[0]!.role).toBe('user');
      expect(msgs[0]!.content).toBe('Hello world');
    });

    it('defaults optional fields toolCallId, toolName, metadata to null', async () => {
      const repo = createMemoryRepository();
      await repo.saveMessage({
        id: 'msg-defaults',
        conversationId: 'conv-y',
        role: 'assistant',
        content: 'Response',
      });

      const msgs = await repo.listMessages('conv-y');

      expect(msgs[0]!.toolCallId).toBeNull();
      expect(msgs[0]!.toolName).toBeNull();
      expect(msgs[0]!.metadata).toBeNull();
    });

    it('stores provided toolCallId, toolName, and metadata', async () => {
      const repo = createMemoryRepository();
      await repo.saveMessage({
        id: 'msg-tool',
        conversationId: 'conv-z',
        role: 'tool',
        content: '{"result": "ok"}',
        toolCallId: 'call-abc',
        toolName: 'github_search',
        metadata: '{"extra": 1}',
      });

      const msgs = await repo.listMessages('conv-z');

      expect(msgs[0]!.toolCallId).toBe('call-abc');
      expect(msgs[0]!.toolName).toBe('github_search');
      expect(msgs[0]!.metadata).toBe('{"extra": 1}');
    });

    it('stores a valid ISO createdAt timestamp', async () => {
      const repo = createMemoryRepository();
      // eslint-disable-next-line test-flakiness/no-random-data
      const before = new Date().toISOString();
      await repo.saveMessage({ id: 'msg-ts', conversationId: 'conv-ts', role: 'user', content: 'ts' });
      // eslint-disable-next-line test-flakiness/no-random-data
      const after = new Date().toISOString();

      const msgs = await repo.listMessages('conv-ts');

      expect(msgs[0]!.createdAt >= before).toBe(true);
      expect(msgs[0]!.createdAt <= after).toBe(true);
    });
  });

  describe('listMessages', () => {
    let repo: ReturnType<typeof createMemoryRepository>;

    beforeEach(async () => {
      repo = createMemoryRepository();
      await repo.saveMessage({ id: 'msg-1', conversationId: 'conv-1', role: 'user', content: 'One' });
      await repo.saveMessage({ id: 'msg-2', conversationId: 'conv-1', role: 'assistant', content: 'Two' });
      await repo.saveMessage({ id: 'msg-3', conversationId: 'conv-1', role: 'user', content: 'Three' });
    });

    it('returns all messages for a conversation when called with no opts', async () => {
      const result = await repo.listMessages('conv-1');

      expect(result).toHaveLength(3);
      expect(result.map((m) => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
    });

    it('limits results when limit is provided', async () => {
      const result = await repo.listMessages('conv-1', { limit: 2 });

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('msg-1');
      expect(result[1]!.id).toBe('msg-2');
    });

    it('skips results when offset is provided', async () => {
      const result = await repo.listMessages('conv-1', { offset: 1 });

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('msg-2');
    });

    it('applies both limit and offset', async () => {
      const result = await repo.listMessages('conv-1', { limit: 1, offset: 2 });

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('msg-3');
    });

    it('filters by conversationId — does not return messages from other conversations', async () => {
      await repo.saveMessage({ id: 'other-1', conversationId: 'conv-2', role: 'user', content: 'Other' });

      const result = await repo.listMessages('conv-1');

      expect(result).toHaveLength(3);
      expect(result.every((m) => m.conversationId === 'conv-1')).toBe(true);
    });

    it('returns empty array for unknown conversationId', async () => {
      const result = await repo.listMessages('unknown-conv');

      expect(result).toEqual([]);
    });

    it('returns empty array when offset exceeds message count', async () => {
      const result = await repo.listMessages('conv-1', { offset: 100 });

      expect(result).toEqual([]);
    });
  });
});
