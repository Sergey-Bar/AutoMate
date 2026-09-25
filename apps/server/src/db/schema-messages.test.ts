import { describe, expect, it } from 'vitest';
import { messages } from './schema.js';

describe('schema messages', () => {
  it('includes tool fields', () => {
    expect(messages.toolCallId).toBeDefined();
    expect(messages.toolName).toBeDefined();
  });
});
