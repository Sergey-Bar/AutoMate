import {
  AgentDomainSchema,
  AgentRequestSchema,
  AgentTestItemSchema,
  AgentArtifactsSchema,
  AgentResultSchema,
  AgentNotImplementedSchema,
} from './agents.js';

// ---------------------------------------------------------------------------
// AgentDomainSchema
// ---------------------------------------------------------------------------

describe('AgentDomainSchema', () => {
  it('accepts all 5 defined agent domains', () => {
    const domains = ['browser', 'api', 'load', 'security', 'mobile'];
    for (const d of domains) {
      expect(AgentDomainSchema.safeParse(d).success).toBe(true);
    }
  });

  it('rejects an unknown domain', () => {
    expect(AgentDomainSchema.safeParse('desktop').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AgentRequestSchema
// ---------------------------------------------------------------------------

describe('AgentRequestSchema', () => {
  it('accepts a browser generate request', () => {
    const result = AgentRequestSchema.safeParse({
      domain: 'browser',
      action: 'generate',
      prompt: 'Generate tests for the login page',
      targetUrl: 'https://example.com/login',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an api run request with minimal fields', () => {
    const result = AgentRequestSchema.safeParse({
      domain: 'api',
      action: 'run',
      specPath: '/specs/api-collection.json',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a security scan request', () => {
    const result = AgentRequestSchema.safeParse({
      domain: 'security',
      action: 'scan',
      targetUrl: 'https://example.com',
      metadata: { depth: 3, auth: 'bearer-token' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects when domain is missing', () => {
    const result = AgentRequestSchema.safeParse({ action: 'run' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('domain');
    }
  });

  it('rejects when action is missing', () => {
    const result = AgentRequestSchema.safeParse({ domain: 'load' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('action');
    }
  });

  it('rejects an invalid action', () => {
    const result = AgentRequestSchema.safeParse({ domain: 'mobile', action: 'delete' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('action');
    }
  });
});

// ---------------------------------------------------------------------------
// AgentTestItemSchema
// ---------------------------------------------------------------------------

describe('AgentTestItemSchema', () => {
  it('accepts a valid test item', () => {
    const result = AgentTestItemSchema.safeParse({
      id: 'item-001',
      name: 'Login flow - valid credentials',
      status: 'passed',
      durationMs: 1200,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid status', () => {
    const result = AgentTestItemSchema.safeParse({
      id: 'item-002',
      name: 'Some test',
      status: 'running',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('status');
    }
  });
});

// ---------------------------------------------------------------------------
// AgentArtifactsSchema
// ---------------------------------------------------------------------------

describe('AgentArtifactsSchema', () => {
  it('accepts a full artifacts object', () => {
    const result = AgentArtifactsSchema.safeParse({
      allureResultsPath: '/results/run-1/allure',
      screenshots: ['/results/run-1/screenshots/fail_01.png'],
      rawOutputPath: '/results/run-1/raw.json',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty artifacts object (all optional)', () => {
    const result = AgentArtifactsSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AgentResultSchema (PRD §7.4 unified result)
// ---------------------------------------------------------------------------

describe('AgentResultSchema', () => {
  it('accepts a valid browser agent result', () => {
    const result = AgentResultSchema.safeParse({
      runId: 'run-uuid-001',
      agent: 'browser',
      status: 'passed',
      startedAt: '2026-01-01T00:00:00.000Z',
      durationMs: 4200,
      summary: { total: 24, passed: 22, failed: 2, skipped: 0 },
      aiNarrative: '22 of 24 tests passed. Two failures in the checkout flow.',
      tests: [
        { id: 'test-1', name: 'Login', status: 'passed', durationMs: 900 },
        { id: 'test-2', name: 'Checkout', status: 'failed', durationMs: 1200 },
      ],
      artifacts: {
        allureResultsPath: '/results/run-uuid-001/allure',
        screenshots: ['/results/run-uuid-001/screenshots/fail_01.png'],
        rawOutputPath: '/results/run-uuid-001/raw.json',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a minimal result without optional fields', () => {
    const result = AgentResultSchema.safeParse({
      runId: 'run-uuid-002',
      agent: 'load',
      status: 'failed',
      startedAt: '2026-01-01T00:00:00.000Z',
      durationMs: 30000,
      summary: { total: 1, passed: 0, failed: 1, skipped: 0 },
    });
    expect(result.success).toBe(true);
  });

  it('supports all 5 agent domains in results', () => {
    const domains = ['browser', 'api', 'load', 'security', 'mobile'] as const;
    for (const agent of domains) {
      const result = AgentResultSchema.safeParse({
        runId: `run-${agent}`,
        agent,
        status: 'passed',
        startedAt: '2026-01-01T00:00:00.000Z',
        durationMs: 1000,
        summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects when runId is missing', () => {
    const result = AgentResultSchema.safeParse({
      agent: 'api',
      status: 'passed',
      startedAt: '2026-01-01T00:00:00.000Z',
      durationMs: 1000,
      summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('runId');
    }
  });

  it('rejects an invalid result status', () => {
    const result = AgentResultSchema.safeParse({
      runId: 'run-003',
      agent: 'browser',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      durationMs: 0,
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('status');
    }
  });
});

// ---------------------------------------------------------------------------
// AgentNotImplementedSchema
// ---------------------------------------------------------------------------

describe('AgentNotImplementedSchema', () => {
  it('accepts a valid not-implemented sentinel', () => {
    const result = AgentNotImplementedSchema.safeParse({
      domain: 'mobile',
      implemented: false,
      message: 'Mobile agent is not yet implemented in this deployment',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.implemented).toBe(false);
      expect(result.data.domain).toBe('mobile');
    }
  });

  it('accepts not-implemented for each domain', () => {
    const domains = ['browser', 'api', 'load', 'security', 'mobile'] as const;
    for (const domain of domains) {
      const result = AgentNotImplementedSchema.safeParse({
        domain,
        implemented: false,
        message: `${domain} not implemented`,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects when implemented is true (not the sentinel)', () => {
    const result = AgentNotImplementedSchema.safeParse({
      domain: 'browser',
      implemented: true,
      message: 'Actually implemented',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when domain is missing', () => {
    const result = AgentNotImplementedSchema.safeParse({
      implemented: false,
      message: 'Not implemented',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('domain');
    }
  });
});
