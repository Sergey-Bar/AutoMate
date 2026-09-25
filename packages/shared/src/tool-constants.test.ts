import { describe, expect, it } from 'vitest';
import { TOOL_NAME_PATTERN } from './index.js';

describe('TOOL_NAME_PATTERN', () => {
  it('matches connector.tool format', () => {
    expect(TOOL_NAME_PATTERN.test('github.create_issue')).toBe(true);
    expect(TOOL_NAME_PATTERN.test('create_issue')).toBe(false);
  });
});
