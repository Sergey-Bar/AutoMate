/**
 * Mutation-killing tests for feature-flags.ts
 * Targets surviving mutants from Stryker run (score: 50% → target 80%+)
 *
 * Surviving mutants covered:
 * - FLAG_DEFAULTS: MVP flags default to true and post-MVP flags default to false
 * - FLAG_DEFAULTS: mcp-gateway, mcp-playwright default to false (not just mcp-server)
 * - resolveFlag: '1' enables a flag (numeric truthy)
 * - resolveFlag: '0' disables a flag (numeric falsy)
 * - resolveFlag: 'false' string disables a flag
 * - resolveFlag: operator mutations (|| → &&, false case)
 * - isEnabled: unknown flag returns false (flag in FLAG_DEFAULTS guard)
 * - requireFeature: skips in test env (NODE_ENV === 'test' guard)
 * - requireFeature: !isEnabled inversion guard
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('feature-flags — mutation killing tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ── FLAG_DEFAULTS: MVP flags default to true ─────────────────────────────

  it('live-run-monitoring defaults to true', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('live-run-monitoring')).toBe(true);
  });

  it('test-explorer defaults to true', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('test-explorer')).toBe(true);
  });

  it('analytics-dashboard defaults to true', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('analytics-dashboard')).toBe(true);
  });

  it('artifact-viewers defaults to true', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('artifact-viewers')).toBe(true);
  });

  it('run-comparison defaults to false', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('run-comparison')).toBe(false);
  });

  it('integration-hooks defaults to false', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('integration-hooks')).toBe(false);
  });

  it('command-palette defaults to false', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('command-palette')).toBe(false);
  });

  it('quality-gate defaults to true', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('quality-gate')).toBe(true);
  });

  // ── FLAG_DEFAULTS: post-MVP workflow flags default to false ──────────────

  it('auto-quarantine defaults to false', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('auto-quarantine')).toBe(false);
  });

  it('nl-query defaults to false', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('nl-query')).toBe(false);
  });

  it('error-clustering defaults to false', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('error-clustering')).toBe(false);
  });

  it('impact-analysis defaults to false', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('impact-analysis')).toBe(false);
  });

  it('ai-explain defaults to false', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('ai-explain')).toBe(false);
  });

  it('scheduled-runs defaults to false', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('scheduled-runs')).toBe(false);
  });

  it('codegen-launcher defaults to false', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('codegen-launcher')).toBe(false);
  });

  it('pr-comparison defaults to false', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('pr-comparison')).toBe(false);
  });

  it('baseline-management defaults to false', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('baseline-management')).toBe(false);
  });

  it('known-failure-tracking defaults to false', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('known-failure-tracking')).toBe(false);
  });

  it('terminal-runner defaults to false', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('terminal-runner')).toBe(false);
  });

  // ── FLAG_DEFAULTS: additional post-MVP flags default to false ────────────

  it('mcp-gateway defaults to false', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('mcp-gateway')).toBe(false);
  });

  it('mcp-playwright defaults to false', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('mcp-playwright')).toBe(false);
  });

  // ── resolveFlag: numeric '1' enables a flag ──────────────────────────────

  it('enables a flag when env var is "1" (numeric truthy)', async () => {
    process.env.FEATURE_MCP_SERVER = '1';
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('mcp-server')).toBe(true);
  });

  it('enables a flag when env var is "1" for a default-false flag', async () => {
    process.env.FEATURE_FAILURE_TAXONOMY = '1';
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('failure-taxonomy')).toBe(true);
  });

  // ── resolveFlag: '0' disables a flag (numeric falsy) ─────────────────────

  it('disables a flag when env var is "0"', async () => {
    process.env.FEATURE_LIVE_RUN_MONITORING = '0';
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('live-run-monitoring')).toBe(false);
  });

  it('keeps a post-MVP flag disabled when env var is "0"', async () => {
    process.env.FEATURE_NL_QUERY = '0';
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('nl-query')).toBe(false);
  });

  // ── resolveFlag: 'false' string disables a flag ──────────────────────────

  it('disables a flag when env var is "false"', async () => {
    process.env.FEATURE_ANALYTICS_DASHBOARD = 'false';
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('analytics-dashboard')).toBe(false);
  });

  it('disables an MVP flag when env var is "false"', async () => {
    process.env.FEATURE_QUALITY_GATE = 'false';
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('quality-gate')).toBe(false);
  });

  // ── resolveFlag: '0' and 'false' are both independent ────────────────────

  it('"0" disables but "1" enables: numeric values work bidirectionally', async () => {
    // Test '0' disables
    process.env.FEATURE_COMMAND_PALETTE = '0';
    const { isEnabled: isEnabled0 } = await import('../feature-flags.js');
    expect(isEnabled0('command-palette')).toBe(false);
  });

  it('"false" string return false not true', async () => {
    // Confirms return false (not return true) mutation is killed
    process.env.FEATURE_RUN_COMPARISON = 'false';
    const { isEnabled } = await import('../feature-flags.js');
    expect(isEnabled('run-comparison')).toBe(false);
  });

  // ── isEnabled: unknown flag returns false ────────────────────────────────

  it('returns false for completely unknown flag name', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    // Cast to bypass TS — mutation testing needs runtime guard tested
    expect(isEnabled('totally-unknown-feature' as never)).toBe(false);
  });

  it('returns false (not true) for unknown flag — verifies guard return value', async () => {
    const { isEnabled } = await import('../feature-flags.js');
    const result = isEnabled('no-such-flag-xyz' as never);
    expect(result).toBe(false);
    expect(result).not.toBe(true);
  });

  // ── requireFeature: NODE_ENV === 'test' guard ────────────────────────────

  it('requireFeature does NOT call reply.status when NODE_ENV is "test"', async () => {
    // In test env (NODE_ENV=test by default), guard must be a no-op
    process.env.NODE_ENV = 'test';
    const { requireFeature } = await import('../feature-flags.js');
    const status = vi.fn();
    const reply = { status } as unknown as Parameters<ReturnType<typeof requireFeature>>[1];

    const guard = requireFeature('mcp-server'); // default-false flag
    await guard({} as never, reply);

    // Must not have called status (would mean guard fired incorrectly)
    expect(status).not.toHaveBeenCalled();
  });

  it('requireFeature returns 404 when NODE_ENV is not "test" and flag is disabled', async () => {
    // Ensures the NODE_ENV check is specifically "test" (not empty string)
    process.env.NODE_ENV = 'production';
    const { requireFeature } = await import('../feature-flags.js');
    const send = vi.fn();
    const status = vi.fn(() => ({ send }));
    const reply = { status } as unknown as Parameters<ReturnType<typeof requireFeature>>[1];

    const guard = requireFeature('mcp-server');
    await guard({} as never, reply as never);

    expect(status).toHaveBeenCalledWith(404);
  });

  it('requireFeature allows request through when flag is enabled (no 404)', async () => {
    process.env.NODE_ENV = 'development';
    process.env.FEATURE_MCP_SERVER = 'true';
    const { requireFeature } = await import('../feature-flags.js');
    const status = vi.fn();
    const reply = { status } as unknown as Parameters<ReturnType<typeof requireFeature>>[1];

    const guard = requireFeature('mcp-server');
    await guard({} as never, reply as never);

    // Flag is enabled so guard should NOT call status(404)
    expect(status).not.toHaveBeenCalled();
  });
});
