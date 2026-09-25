import { describe, expect, it } from 'vitest';
import { ExecutionLogSchema } from './index.js';

describe('ExecutionLogSchema', () => {
  it('accepts timeout status', () => {
    const row = ExecutionLogSchema.parse({
      id: 'e1',
      conversationId: 'c1',
      toolName: 'jira.create_issue',
      input: '{}',
      output: null,
      status: 'timeout',
      durationMs: 30000,
      errorMessage: 'timed out',
      createdAt: '2026-03-12T00:00:00.000Z',
    });
    expect(row.status).toBe('timeout');
  });
});
