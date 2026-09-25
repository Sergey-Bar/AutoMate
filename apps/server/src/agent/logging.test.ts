import { describe, expect, it } from 'vitest';
import { buildExecutionLogRow } from './logging.js';

describe('execution log row', () => {
  it('captures all fields for a successful tool call', () => {
    const row = buildExecutionLogRow('c1', 'github.create_issue', { title: 'bug' }, { text: 'created' }, 'success', 150, null);
    expect(row.conversationId).toBe('c1');
    expect(row.toolName).toBe('github.create_issue');
    expect(row.status).toBe('success');
    expect(row.durationMs).toBe(150);
    expect(row.id).toBeDefined();
    expect(row.input).toBe(JSON.stringify({ title: 'bug' }));
    expect(row.output).toBe(JSON.stringify({ text: 'created' }));
    expect(row.errorMessage).toBeNull();
    expect(row.createdAt).toBeDefined();
  });

  it('captures error details on failure', () => {
    const row = buildExecutionLogRow('c1', 'github.create_issue', {}, null, 'error', 50, 'auth failed');
    expect(row.status).toBe('error');
    expect(row.errorMessage).toBe('auth failed');
    expect(row.output).toBeNull();
  });
});
