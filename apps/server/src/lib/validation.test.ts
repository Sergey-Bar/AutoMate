import { describe, expect, it } from 'vitest';

import { formatValidationError } from './validation.js';

describe('formatValidationError', () => {
  it('formats a single issue with a path', () => {
    const issues = [
      { path: ['content'], message: 'Required', code: 'invalid_type' as const, input: undefined, expected: 'string' },
    ];
    expect(formatValidationError(issues as never[])).toBe('content: Required');
  });

  it('formats a single issue with a nested path', () => {
    const issues = [
      { path: ['body', 'name'], message: 'Too short', code: 'too_small' as const, input: '', minimum: 1 },
    ];
    expect(formatValidationError(issues as never[])).toBe('body.name: Too short');
  });

  it('formats a top-level issue (empty path) as "body"', () => {
    const issues = [
      { path: [], message: 'Invalid input', code: 'custom' as const, input: undefined },
    ];
    expect(formatValidationError(issues as never[])).toBe('body: Invalid input');
  });

  it('joins multiple issues with semicolons', () => {
    const issues = [
      { path: ['name'], message: 'Required', code: 'invalid_type' as const, input: undefined, expected: 'string' },
      { path: ['age'], message: 'Must be positive', code: 'too_small' as const, input: -1, minimum: 0 },
    ];
    expect(formatValidationError(issues as never[])).toBe('name: Required; age: Must be positive');
  });

  it('returns empty string for empty issues array', () => {
    expect(formatValidationError([])).toBe('');
  });

  it('handles numeric path segments', () => {
    const issues = [
      { path: ['items', 0, 'id'], message: 'Invalid', code: 'custom' as const, input: undefined },
    ];
    expect(formatValidationError(issues as never[])).toBe('items.0.id: Invalid');
  });
});
