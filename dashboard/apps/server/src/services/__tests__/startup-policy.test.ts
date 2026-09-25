/**
 * apps/server/src/services/__tests__/startup-policy.test.ts
 *
 * Tests for the startup-policy service.
 * globals: true in vitest.config.ts — no vitest imports needed for describe/it/expect.
 */

import { vi } from 'vitest';
import type { StartupPolicyViolation } from '../startup-policy.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProductionEnv(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    COOKIE_SECRET: 'super-secure-cookie-secret-1234567890abcdef',
    AUTOMATE_DASHBOARD_API_KEY: 'secure-api-key-1234567890abcdef',
    CORS_ORIGIN: 'https://dashboard.example.com',
    REPORTER_SECRET: 'reporter-secret-xyz',
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('checkStartupPolicy()', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Snapshot original env and reset for each test
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    vi.resetModules();
  });

  it('returns empty violations when NODE_ENV is not "production"', async () => {
    process.env.NODE_ENV = 'development';
    const { checkStartupPolicy } = await import('../startup-policy.js');
    expect(checkStartupPolicy()).toEqual([]);
  });

  it('returns empty violations when NODE_ENV is "test"', async () => {
    process.env.NODE_ENV = 'test';
    const { checkStartupPolicy } = await import('../startup-policy.js');
    expect(checkStartupPolicy()).toEqual([]);
  });

  it('returns empty violations when NODE_ENV is undefined (non-production)', async () => {
    delete process.env.NODE_ENV;
    const { checkStartupPolicy } = await import('../startup-policy.js');
    expect(checkStartupPolicy()).toEqual([]);
  });

  it('returns empty violations when all production env vars are properly configured', async () => {
    Object.assign(process.env, makeProductionEnv());
    const { checkStartupPolicy } = await import('../startup-policy.js');
    const violations = checkStartupPolicy();
    expect(violations).toEqual([]);
  });

  // ── COOKIE_SECRET ───────────────────────────────────────────────────────────

  it('returns fatal violation when COOKIE_SECRET is missing in production', async () => {
    Object.assign(process.env, makeProductionEnv());
    delete process.env.COOKIE_SECRET;
    const { checkStartupPolicy } = await import('../startup-policy.js');
    const violations = checkStartupPolicy();
    const v = violations.find((x: StartupPolicyViolation) => x.field === 'COOKIE_SECRET');
    expect(v).toBeDefined();
    expect(v?.severity).toBe('fatal');
  });

  it('returns fatal violation when COOKIE_SECRET is the dev fallback value', async () => {
    Object.assign(process.env, makeProductionEnv());
    process.env.COOKIE_SECRET = 'automate-dev-secret';
    const { checkStartupPolicy } = await import('../startup-policy.js');
    const violations = checkStartupPolicy();
    const v = violations.find((x: StartupPolicyViolation) => x.field === 'COOKIE_SECRET');
    expect(v).toBeDefined();
    expect(v?.severity).toBe('fatal');
    expect(v?.message).toContain('automate-dev-secret');
  });

  // ── AUTOMATE_DASHBOARD_API_KEY ──────────────────────────────────────────────

  it('returns fatal violation when AUTOMATE_DASHBOARD_API_KEY is missing in production', async () => {
    Object.assign(process.env, makeProductionEnv());
    delete process.env.AUTOMATE_DASHBOARD_API_KEY;
    const { checkStartupPolicy } = await import('../startup-policy.js');
    const violations = checkStartupPolicy();
    const v = violations.find((x: StartupPolicyViolation) => x.field === 'AUTOMATE_DASHBOARD_API_KEY');
    expect(v).toBeDefined();
    expect(v?.severity).toBe('fatal');
  });

  it('returns fatal violation when AUTOMATE_DASHBOARD_API_KEY is "changeme"', async () => {
    Object.assign(process.env, makeProductionEnv());
    process.env.AUTOMATE_DASHBOARD_API_KEY = 'changeme';
    const { checkStartupPolicy } = await import('../startup-policy.js');
    const violations = checkStartupPolicy();
    const v = violations.find((x: StartupPolicyViolation) => x.field === 'AUTOMATE_DASHBOARD_API_KEY');
    expect(v).toBeDefined();
    expect(v?.severity).toBe('fatal');
    expect(v?.message).toContain('changeme');
  });

  // ── CORS_ORIGIN ─────────────────────────────────────────────────────────────

  it('returns warning when CORS_ORIGIN is "*" in production', async () => {
    Object.assign(process.env, makeProductionEnv());
    process.env.CORS_ORIGIN = '*';
    const { checkStartupPolicy } = await import('../startup-policy.js');
    const violations = checkStartupPolicy();
    const v = violations.find((x: StartupPolicyViolation) => x.field === 'CORS_ORIGIN');
    expect(v).toBeDefined();
    expect(v?.severity).toBe('warning');
  });

  it('returns warning when CORS_ORIGIN is not set in production', async () => {
    Object.assign(process.env, makeProductionEnv());
    delete process.env.CORS_ORIGIN;
    const { checkStartupPolicy } = await import('../startup-policy.js');
    const violations = checkStartupPolicy();
    const v = violations.find((x: StartupPolicyViolation) => x.field === 'CORS_ORIGIN');
    expect(v).toBeDefined();
    expect(v?.severity).toBe('warning');
  });

  it('returns no CORS violation when CORS_ORIGIN is a valid URL', async () => {
    Object.assign(process.env, makeProductionEnv());
    process.env.CORS_ORIGIN = 'https://dashboard.example.com';
    const { checkStartupPolicy } = await import('../startup-policy.js');
    const violations = checkStartupPolicy();
    const v = violations.find((x: StartupPolicyViolation) => x.field === 'CORS_ORIGIN');
    expect(v).toBeUndefined();
  });

  // ── REPORTER_SECRET ─────────────────────────────────────────────────────────

  it('returns fatal violation when REPORTER_SECRET is not set in production', async () => {
    Object.assign(process.env, makeProductionEnv());
    delete process.env.REPORTER_SECRET;
    const { checkStartupPolicy } = await import('../startup-policy.js');
    const violations = checkStartupPolicy();
    const v = violations.find((x: StartupPolicyViolation) => x.field === 'REPORTER_SECRET');
    expect(v).toBeDefined();
    expect(v?.severity).toBe('fatal');
  });

  it('returns no REPORTER_SECRET violation when REPORTER_SECRET is set in production', async () => {
    Object.assign(process.env, makeProductionEnv());
    process.env.REPORTER_SECRET = 'some-secret';
    const { checkStartupPolicy } = await import('../startup-policy.js');
    const violations = checkStartupPolicy();
    const v = violations.find((x: StartupPolicyViolation) => x.field === 'REPORTER_SECRET');
    expect(v).toBeUndefined();
  });

  it('returns no REPORTER_SECRET violation in non-production even when secret is absent', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.REPORTER_SECRET;
    const { checkStartupPolicy } = await import('../startup-policy.js');
    const violations = checkStartupPolicy();
    expect(violations).toEqual([]);
  });
});

// ── enforceStartupPolicy() ────────────────────────────────────────────────────

describe('enforceStartupPolicy()', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    exitSpy.mockRestore();
    vi.resetModules();
  });

  it('calls process.exit(1) when fatal violations exist', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      // missing COOKIE_SECRET and API_KEY → fatals
    });
    delete process.env.COOKIE_SECRET;
    delete process.env.AUTOMATE_DASHBOARD_API_KEY;

    const { enforceStartupPolicy } = await import('../startup-policy.js');
    expect(() => enforceStartupPolicy()).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does NOT call process.exit when there are only warnings', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      COOKIE_SECRET: 'super-secure-cookie-secret-1234567890abcdef',
      AUTOMATE_DASHBOARD_API_KEY: 'secure-api-key-1234567890abcdef',
      REPORTER_SECRET: 'secure-reporter-secret-xyz',
      // CORS_ORIGIN intentionally omitted → warning only
    });
    delete process.env.CORS_ORIGIN;

    const { enforceStartupPolicy } = await import('../startup-policy.js');
    expect(() => enforceStartupPolicy()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does NOT call process.exit in non-production environments', async () => {
    process.env.NODE_ENV = 'development';

    const { enforceStartupPolicy } = await import('../startup-policy.js');
    expect(() => enforceStartupPolicy()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('logs warnings via the provided logger', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      COOKIE_SECRET: 'super-secure-cookie-secret-1234567890abcdef',
      AUTOMATE_DASHBOARD_API_KEY: 'secure-api-key-1234567890abcdef',
      REPORTER_SECRET: 'secure-reporter-secret-xyz',
      // Missing CORS_ORIGIN → warning
    });
    delete process.env.CORS_ORIGIN;

    const { enforceStartupPolicy } = await import('../startup-policy.js');

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    enforceStartupPolicy(logger);

    // Should have warned about CORS_ORIGIN only
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const warnMessages = logger.warn.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(warnMessages.some((m: string) => m.includes('CORS_ORIGIN'))).toBe(true);
    // No exit
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not log warnings when all production vars are properly configured', async () => {
    Object.assign(process.env, makeProductionEnv());

    const { enforceStartupPolicy } = await import('../startup-policy.js');

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    enforceStartupPolicy(logger);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

// ── checkServiceSecret() ──────────────────────────────────────────────────────

describe('checkServiceSecret()', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it('returns null when no service features are enabled', async () => {
    delete process.env.FEATURE_EXTERNAL_TRIGGER;
    delete process.env.FEATURE_SESSION_VALIDATE;
    delete process.env.AUTOMATE_SERVICE_SECRET;
    const { checkServiceSecret } = await import('../startup-policy.js');
    expect(checkServiceSecret()).toBeNull();
  });

  it('returns null when FEATURE_EXTERNAL_TRIGGER is enabled and service secret is set', async () => {
    process.env.FEATURE_EXTERNAL_TRIGGER = 'true';
    process.env.AUTOMATE_SERVICE_SECRET = 'secure-secret-xyz';
    const { checkServiceSecret } = await import('../startup-policy.js');
    expect(checkServiceSecret()).toBeNull();
  });

  it('returns null when FEATURE_SESSION_VALIDATE is enabled and service secret is set', async () => {
    process.env.FEATURE_SESSION_VALIDATE = 'true';
    process.env.AUTOMATE_SERVICE_SECRET = 'secure-secret-xyz';
    const { checkServiceSecret } = await import('../startup-policy.js');
    expect(checkServiceSecret()).toBeNull();
  });

  it('returns fatal violation when FEATURE_EXTERNAL_TRIGGER is enabled without service secret', async () => {
    process.env.FEATURE_EXTERNAL_TRIGGER = 'true';
    delete process.env.AUTOMATE_SERVICE_SECRET;
    const { checkServiceSecret } = await import('../startup-policy.js');
    const v = checkServiceSecret();
    expect(v).not.toBeNull();
    expect(v?.field).toBe('AUTOMATE_SERVICE_SECRET');
    expect(v?.severity).toBe('fatal');
    expect(v?.message).toContain('AUTOMATE_SERVICE_SECRET');
  });

  it('returns fatal violation when FEATURE_SESSION_VALIDATE is enabled without service secret', async () => {
    process.env.FEATURE_SESSION_VALIDATE = 'true';
    delete process.env.AUTOMATE_SERVICE_SECRET;
    const { checkServiceSecret } = await import('../startup-policy.js');
    const v = checkServiceSecret();
    expect(v).not.toBeNull();
    expect(v?.field).toBe('AUTOMATE_SERVICE_SECRET');
    expect(v?.severity).toBe('fatal');
  });

  it('returns fatal violation when both service features enabled without service secret', async () => {
    process.env.FEATURE_EXTERNAL_TRIGGER = 'true';
    process.env.FEATURE_SESSION_VALIDATE = 'true';
    delete process.env.AUTOMATE_SERVICE_SECRET;
    const { checkServiceSecret } = await import('../startup-policy.js');
    const v = checkServiceSecret();
    expect(v).not.toBeNull();
    expect(v?.severity).toBe('fatal');
  });
});

// ── checkStartupPolicy() — service secret integration ─────────────────────────

describe('checkStartupPolicy() — AUTOMATE_SERVICE_SECRET', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it('returns empty violations when service features are disabled (default)', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      COOKIE_SECRET: 'super-secure-cookie-secret-1234567890abcdef',
      AUTOMATE_DASHBOARD_API_KEY: 'secure-api-key-1234567890abcdef',
      CORS_ORIGIN: 'https://dashboard.example.com',
      REPORTER_SECRET: 'reporter-secret-xyz',
    });
    delete process.env.FEATURE_EXTERNAL_TRIGGER;
    delete process.env.FEATURE_SESSION_VALIDATE;
    delete process.env.AUTOMATE_SERVICE_SECRET;

    const { checkStartupPolicy } = await import('../startup-policy.js');
    const violations = checkStartupPolicy();
    const v = violations.find((x) => x.field === 'AUTOMATE_SERVICE_SECRET');
    expect(v).toBeUndefined();
  });

  it('includes AUTOMATE_SERVICE_SECRET fatal violation when external-trigger enabled without secret', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      COOKIE_SECRET: 'super-secure-cookie-secret-1234567890abcdef',
      AUTOMATE_DASHBOARD_API_KEY: 'secure-api-key-1234567890abcdef',
      CORS_ORIGIN: 'https://dashboard.example.com',
      REPORTER_SECRET: 'reporter-secret-xyz',
      FEATURE_EXTERNAL_TRIGGER: 'true',
    });
    delete process.env.AUTOMATE_SERVICE_SECRET;

    const { checkStartupPolicy } = await import('../startup-policy.js');
    const violations = checkStartupPolicy();
    const v = violations.find((x) => x.field === 'AUTOMATE_SERVICE_SECRET');
    expect(v).toBeDefined();
    expect(v?.severity).toBe('fatal');
  });
});
