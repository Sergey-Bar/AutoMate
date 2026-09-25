import { describe, expect, it } from 'vitest';
import { createConversationStore } from './conversation-store.js';

describe('conversation store', () => {
  it('starts with null active conversation', () => {
    const store = createConversationStore();
    expect(store.getState().activeConversationId).toBeNull();
  });

  it('sets active conversation id', () => {
    const store = createConversationStore();
    store.getState().setActive('c1');
    expect(store.getState().activeConversationId).toBe('c1');
  });
});
