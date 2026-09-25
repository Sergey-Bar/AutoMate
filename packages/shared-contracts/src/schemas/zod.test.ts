import {
  TriggerRunRequestSchema,
  RunResultCallbackSchema,
  ServiceHealthStatusSchema,
  UnifiedAuthTokenSchema,
} from './zod.js';

// ---------------------------------------------------------------------------
// TriggerRunRequest
// ---------------------------------------------------------------------------

describe('TriggerRunRequestSchema', () => {
  it('accepts a valid payload', () => {
    const result = TriggerRunRequestSchema.safeParse({
      specCode: 'test("smoke", async ({ page }) => {})',
      specFileName: 'smoke.spec.ts',
      baseUrl: 'https://example.com',
      browser: 'chromium',
      metadata: { env: 'ci', branch: 'main' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a minimal valid payload (only required fields)', () => {
    const result = TriggerRunRequestSchema.safeParse({
      specCode: 'test("min", async ({ page }) => {})',
      specFileName: 'min.spec.ts',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when specCode is missing', () => {
    const result = TriggerRunRequestSchema.safeParse({
      specFileName: 'smoke.spec.ts',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path[0]);
      expect(fields).toContain('specCode');
    }
  });

  it('rejects when specFileName is missing', () => {
    const result = TriggerRunRequestSchema.safeParse({
      specCode: 'test("x", async () => {})',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path[0]);
      expect(fields).toContain('specFileName');
    }
  });

  it('rejects an invalid browser value', () => {
    const result = TriggerRunRequestSchema.safeParse({
      specCode: 'test("x", async () => {})',
      specFileName: 'x.spec.ts',
      browser: 'safari',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path[0]);
      expect(fields).toContain('browser');
    }
  });
});

// ---------------------------------------------------------------------------
// RunResultCallback
// ---------------------------------------------------------------------------

describe('RunResultCallbackSchema', () => {
  it('accepts a valid payload', () => {
    const result = RunResultCallbackSchema.safeParse({
      runId: 'run-abc-123',
      status: 'completed',
      duration: 12340,
      total: 10,
      passed: 9,
      failed: 1,
      skipped: 0,
      errors: [{ testName: 'login test', message: 'assertion failed', stack: 'Error at ...' }],
      triggeredBy: 'ci-pipeline',
      triggeredAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:12.340Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a payload without optional errors field', () => {
    const result = RunResultCallbackSchema.safeParse({
      runId: 'run-xyz',
      status: 'failed',
      duration: 5000,
      total: 5,
      passed: 0,
      failed: 5,
      skipped: 0,
      triggeredBy: 'manual',
      triggeredAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:05.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when runId is missing', () => {
    const result = RunResultCallbackSchema.safeParse({
      status: 'completed',
      duration: 1000,
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      triggeredBy: 'ci',
      triggeredAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path[0]);
      expect(fields).toContain('runId');
    }
  });

  it('rejects an invalid status string', () => {
    const result = RunResultCallbackSchema.safeParse({
      runId: 'run-001',
      status: 'cancelled',
      duration: 1000,
      total: 1,
      passed: 0,
      failed: 0,
      skipped: 1,
      triggeredBy: 'ci',
      triggeredAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path[0]);
      expect(fields).toContain('status');
    }
  });
});

// ---------------------------------------------------------------------------
// ServiceHealthStatus
// ---------------------------------------------------------------------------

describe('ServiceHealthStatusSchema', () => {
  it('accepts a valid full payload', () => {
    const result = ServiceHealthStatusSchema.safeParse({
      status: 'healthy',
      version: '1.2.3',
      uptime: 86400,
      checks: {
        db: { status: 'ok' },
        cache: { status: 'error', message: 'connection refused' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a minimal payload (only required status)', () => {
    const result = ServiceHealthStatusSchema.safeParse({ status: 'degraded' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid status string', () => {
    const result = ServiceHealthStatusSchema.safeParse({ status: 'unknown' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path[0]);
      expect(fields).toContain('status');
    }
  });

  it('rejects when status is missing', () => {
    const result = ServiceHealthStatusSchema.safeParse({ version: '1.0.0' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UnifiedAuthToken
// ---------------------------------------------------------------------------

describe('UnifiedAuthTokenSchema', () => {
  it('accepts a valid authenticated token (valid:true)', () => {
    const result = UnifiedAuthTokenSchema.safeParse({
      valid: true,
      userId: 'user-42',
      expiresAt: '2026-12-31T23:59:59.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a minimal invalid token (valid:false only)', () => {
    const result = UnifiedAuthTokenSchema.safeParse({ valid: false });
    expect(result.success).toBe(true);
  });

  it('rejects when valid is missing', () => {
    const result = UnifiedAuthTokenSchema.safeParse({
      userId: 'user-42',
      expiresAt: '2026-12-31T23:59:59.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path[0]);
      expect(fields).toContain('valid');
    }
  });

  it('rejects when valid is not a boolean', () => {
    const result = UnifiedAuthTokenSchema.safeParse({ valid: 'yes' });
    expect(result.success).toBe(false);
  });
});
