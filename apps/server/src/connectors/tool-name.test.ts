import { describe, expect, it } from 'vitest';
import { isValidToolName } from './tool-name.js';

describe('isValidToolName', () => {
  it('accepts valid dot-notation names', () => {
    expect(isValidToolName('github.create_issue')).toBe(true);
  });

  it('accepts names with hyphens in connector part', () => {
    expect(isValidToolName('sql-browser.run_query')).toBe(true);
  });

  it('accepts names with numbers', () => {
    expect(isValidToolName('jira2.get_ticket')).toBe(true);
  });

  it('rejects names without dot separator', () => {
    expect(isValidToolName('github_create_issue')).toBe(false);
  });

  it('rejects names starting with uppercase', () => {
    expect(isValidToolName('Github.create_issue')).toBe(false);
  });

  it('rejects names starting with number', () => {
    expect(isValidToolName('1github.create_issue')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidToolName('')).toBe(false);
  });

  it('rejects names with spaces', () => {
    expect(isValidToolName('github .create_issue')).toBe(false);
  });

  it('rejects double dots', () => {
    expect(isValidToolName('github..create_issue')).toBe(false);
  });

  it('accepts minimal valid name', () => {
    expect(isValidToolName('a.b')).toBe(true);
  });
});
