import { describe, expect, it } from 'vitest';
import { MessageRoleSchema } from './index.js';

describe('MessageRoleSchema', () => {
  it('accepts user assistant system tool', () => {
    expect(MessageRoleSchema.parse('user')).toBe('user');
    expect(MessageRoleSchema.parse('assistant')).toBe('assistant');
    expect(MessageRoleSchema.parse('system')).toBe('system');
    expect(MessageRoleSchema.parse('tool')).toBe('tool');
  });
});
