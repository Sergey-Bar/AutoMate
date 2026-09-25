import { describe, expect, it } from 'vitest';
import {
  CreateAgentSessionBodySchema,
  RepairPayloadSchema,
} from './index.js';

describe('agent session shared schemas', () => {
  it('parses a valid RepairPayload and preserves nested fields', () => {
    const result = RepairPayloadSchema.safeParse({
      protocolVersion: '1.0',
      failureId: 'f-1',
      originatingAgent: 'copilot',
      failedTests: [
        {
          testId: 't-1',
          title: 'login works',
          errorMessage: 'expected true to be false',
        },
      ],
      repairAttemptNumber: 1,
      maxRepairAttempts: 3,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.failedTests[0]).toEqual({
      testId: 't-1',
      title: 'login works',
      errorMessage: 'expected true to be false',
    });
  });

  it('rejects RepairPayload missing failedTests', () => {
    const result = RepairPayloadSchema.safeParse({
      protocolVersion: '1.0',
      failureId: 'f-1',
      originatingAgent: 'copilot',
      repairAttemptNumber: 1,
      maxRepairAttempts: 3,
    });

    expect(result.success).toBe(false);
  });

  it('rejects RepairPayload with repairAttemptNumber greater than 3', () => {
    const result = RepairPayloadSchema.safeParse({
      protocolVersion: '1.0',
      failureId: 'f-1',
      originatingAgent: 'copilot',
      failedTests: [
        {
          testId: 't-1',
          title: 'login works',
          errorMessage: 'expected true to be false',
        },
      ],
      repairAttemptNumber: 4,
      maxRepairAttempts: 3,
    });

    expect(result.success).toBe(false);
  });

  it('parses a valid CreateAgentSessionBody', () => {
    const result = CreateAgentSessionBodySchema.safeParse({
      provider: 'github',
      repository: 'owner/repo',
      prNumber: 42,
      prBranch: 'copilot/fix-login',
      agentName: 'copilot',
    });

    expect(result.success).toBe(true);
  });

  it('rejects CreateAgentSessionBody with empty prBranch', () => {
    const result = CreateAgentSessionBodySchema.safeParse({
      provider: 'github',
      repository: 'owner/repo',
      prNumber: 42,
      prBranch: '',
      agentName: 'copilot',
    });

    expect(result.success).toBe(false);
  });
});
