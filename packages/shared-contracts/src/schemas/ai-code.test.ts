import { describe, expect, it } from 'vitest';
import { AiCodePullRequestSchema, PortfolioAiCodeSchema } from './ai-code.js';
import { AiGovernancePolicySchema, HealthPolicySchema } from './health.js';

describe('the aiGovernance policy block', () => {
  it('is off unless enabled, and reads back what a repository wrote', () => {
    expect(AiGovernancePolicySchema.parse({})).toEqual({ enabled: false });
    const policy = HealthPolicySchema.parse({
      aiGovernance: {
        enabled: true,
        agentLabels: ['agent'],
        requireTestsTouched: true,
        minDiffCoverage: 80,
        maxNewHighOrCritical: 0,
        applyTo: ['agent-authored', 'ai-assisted'],
        treatUnknownAs: 'agent-authored',
      },
    });
    expect(policy.aiGovernance).toMatchObject({ enabled: true, minDiffCoverage: 80 });
  });

  it('refuses a coverage above 100, a negative finding budget and an unknown mode', () => {
    expect(AiGovernancePolicySchema.safeParse({ minDiffCoverage: 101 }).success).toBe(false);
    expect(AiGovernancePolicySchema.safeParse({ maxNewHighOrCritical: -1 }).success).toBe(false);
    expect(AiGovernancePolicySchema.safeParse({ applyTo: ['human'] }).success).toBe(false);
    expect(AiGovernancePolicySchema.safeParse({ treatUnknownAs: 'ai-assisted' }).success).toBe(
      false,
    );
  });
});

describe('the ai-code responses carry no person', () => {
  it('strips an author field a careless producer adds', () => {
    const row = AiCodePullRequestSchema.parse({
      number: 7,
      title: 'Add login',
      state: 'merged',
      attribution: 'agent-authored',
      agent: 'claude-code',
      confidence: 0.95,
      signals: [{ kind: 'bot-login', detail: 'author claude[bot] is claude-code' }],
      attributionVersion: '2026-10-26',
      openedAt: '2026-10-01T00:00:00Z',
      mergedAt: '2026-10-02T00:00:00Z',
      authorLogin: 'someone',
    });
    expect(row).not.toHaveProperty('authorLogin');
  });

  it('bounds the share to a percentage', () => {
    const entry = {
      projectId: '00000000-0000-4000-8000-000000000001',
      name: 'service',
      slug: 'service',
      changes: 4,
      aiShare: 101,
      scorecard: { status: 'pass', score: 100 },
    };
    const parsed = PortfolioAiCodeSchema.safeParse({
      windowDays: 90,
      evaluatedAt: '2026-10-26T00:00:00Z',
      projects: [entry],
    });
    expect(parsed.success).toBe(false);
  });
});
