import { describe, expect, it } from 'vitest';
import { githubAdapter } from './index.js';

describe('github adapter', () => {
  it('declares bounded repository and issue operations', () => {
    expect(githubAdapter.manifest.name).toBe('github');
    expect(githubAdapter.manifest.operations.createIssue?.sideEffecting).toBe(true);
  });
});
