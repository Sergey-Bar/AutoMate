import { describe, expect, it } from 'vitest';
import { jiraAdapter } from './index.js';

describe('jira adapter', () => {
  it('declares bounded issue operations', () => {
    expect(jiraAdapter.manifest.name).toBe('jira');
    expect(jiraAdapter.manifest.operations.getIssue?.sideEffecting).toBe(false);
  });
});
