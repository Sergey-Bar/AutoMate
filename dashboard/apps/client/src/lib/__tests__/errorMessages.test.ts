import { describe, it, expect } from 'vitest';
import { getUserFriendlyError, sanitizeErrorMessage } from '../errorMessages';

describe('getUserFriendlyError', () => {
  it('maps SQLite errors to friendly message', () => {
    expect(getUserFriendlyError('SQLITE_ERROR: no such table: runs'))
      .toBe('A database error occurred. Please try again or contact support.');
  });

  it('maps SQLITE_CONSTRAINT errors', () => {
    expect(getUserFriendlyError('SQLITE_CONSTRAINT: UNIQUE constraint failed'))
      .toBe('A database error occurred. Please try again or contact support.');
  });

  it('maps network errors', () => {
    expect(getUserFriendlyError('Failed to fetch'))
      .toBe('Unable to connect to the server. Check your network connection.');
  });

  it('maps NetworkError', () => {
    expect(getUserFriendlyError('NetworkError when attempting to fetch resource'))
      .toBe('Unable to connect to the server. Check your network connection.');
  });

  it('maps abort/timeout errors', () => {
    expect(getUserFriendlyError('AbortError: The operation was aborted'))
      .toBe('The request timed out. Please try again.');
  });

  it('maps JSON parse errors', () => {
    expect(getUserFriendlyError('SyntaxError: Unexpected token < in JSON'))
      .toBe('Received an invalid response from the server.');
  });

  it('maps file system errors', () => {
    expect(getUserFriendlyError('ENOENT: no such file or directory'))
      .toBe('An unexpected error occurred.');
  });

  it('passes through safe, short messages', () => {
    expect(getUserFriendlyError('Run not found'))
      .toBe('Run not found');
  });

  it('passes through user-facing messages', () => {
    expect(getUserFriendlyError('No tests matched the filter'))
      .toBe('No tests matched the filter');
  });
});

describe('sanitizeErrorMessage', () => {
  it('strips SQL keywords from messages', () => {
    expect(sanitizeErrorMessage('Error: SELECT * FROM users WHERE id = 1'))
      .toBe('An unexpected error occurred.');
  });

  it('strips file paths (Unix)', () => {
    expect(sanitizeErrorMessage('Error reading /var/data/db.sqlite'))
      .toBe('An unexpected error occurred.');
  });

  it('strips file paths (Windows)', () => {
    expect(sanitizeErrorMessage('Error reading C:\\Users\\data\\db.sqlite'))
      .toBe('An unexpected error occurred.');
  });

  it('strips stack traces', () => {
    const msg = 'Error: something failed\n    at Object.<anonymous> (/app/src/index.ts:10:5)\n    at Module._compile (node:internal/modules/cjs/loader:1356:14)';
    expect(sanitizeErrorMessage(msg)).toBe('Error: something failed');
  });

  it('keeps clean messages intact', () => {
    expect(sanitizeErrorMessage('Test run completed with failures'))
      .toBe('Test run completed with failures');
  });

  it('handles empty string', () => {
    expect(sanitizeErrorMessage('')).toBe('');
  });
});
