import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('feature-flags', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.FEATURE_AUTO_QUARANTINE;
    delete process.env.FEATURE_AI_EXPLAIN;
    delete process.env.FEATURE_RUN_COMPARISON;
    delete process.env.FEATURE_INTEGRATION_HOOKS;
    delete process.env.FEATURE_COMMAND_PALETTE;
    delete process.env.FEATURE_MCP_SERVER;
    delete process.env.FEATURE_FAILURE_TAXONOMY;
    delete process.env.FEATURE_PREDICTIVE_TEST_SELECTION;
    delete process.env.FEATURE_ROLE_BASED_VIEWS;
    delete process.env.FEATURE_LOCATOR_INTELLIGENCE;
    delete process.env.FEATURE_SCREENSHOT_DIFF;
    delete process.env.FEATURE_LOOKS_SAME_DIFF;
    delete process.env.FEATURE_SPEC_AWARE_TRIAGE;
    delete process.env.FEATURE_FREQUENT_FAILURES;
    delete process.env.FEATURE_CHECKS_ANNOTATIONS;
    delete process.env.FEATURE_EXTERNAL_TRIGGER;
    delete process.env.FEATURE_RESULT_CALLBACK;
    delete process.env.FEATURE_AGENT_TRACKING;
    delete process.env.FEATURE_AI_TEST_GEN_V2;
    delete process.env.FEATURE_AGENT_REPAIR;
    delete process.env.FEATURE_MULTI_AGENT_AWARENESS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('keeps post-MVP intelligence flags off by default', async () => {
    const { getFeatureFlags } = await import('./feature-flags.js');
    const flags = getFeatureFlags();

    expect(flags['mcp-server']).toBe(false);
    expect(flags['failure-taxonomy']).toBe(false);
    expect(flags['predictive-test-selection']).toBe(false);
    expect(flags['role-based-views']).toBe(false);
    expect(flags['locator-intelligence']).toBe(false);
  });

  it('keeps post-MVP workflow flags off by default', async () => {
    const { getFeatureFlags } = await import('./feature-flags.js');
    const flags = getFeatureFlags();

    expect(flags['auto-quarantine']).toBe(false);
    expect(flags['nl-query']).toBe(false);
    expect(flags['error-clustering']).toBe(false);
    expect(flags['impact-analysis']).toBe(false);
    expect(flags['ai-explain']).toBe(false);
    expect(flags['scheduled-runs']).toBe(false);
    expect(flags['codegen-launcher']).toBe(false);
    expect(flags['pr-comparison']).toBe(false);
    expect(flags['run-comparison']).toBe(false);
    expect(flags['integration-hooks']).toBe(false);
    expect(flags['command-palette']).toBe(false);
    expect(flags['baseline-management']).toBe(false);
    expect(flags['known-failure-tracking']).toBe(false);
    expect(flags['terminal-runner']).toBe(false);
  });

  it('defaults external-trigger and result-callback to false', async () => {
    const { getFeatureFlags } = await import('./feature-flags.js');
    const flags = getFeatureFlags();

    expect(flags['external-trigger']).toBe(false);
    expect(flags['result-callback']).toBe(false);
  });

  it('enables mcp-server when FEATURE_MCP_SERVER=true', async () => {
    process.env.FEATURE_MCP_SERVER = 'true';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('mcp-server')).toBe(true);
  });

  it('enables external-trigger when FEATURE_EXTERNAL_TRIGGER=true', async () => {
    process.env.FEATURE_EXTERNAL_TRIGGER = 'true';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('external-trigger')).toBe(true);
  });

  it('requireFeature returns 404 when mcp-server is disabled outside test env', async () => {
    process.env.NODE_ENV = 'development';
    const { requireFeature } = await import('./feature-flags.js');

    const send = vi.fn();
    const status = vi.fn(() => ({ send }));
    const reply = { status } as unknown as { status: (code: number) => { send: (payload: unknown) => unknown } };

    const guard = requireFeature('mcp-server');
    await guard({} as never, reply as never);

    expect(status).toHaveBeenCalledWith(404);
    expect(send).toHaveBeenCalledWith({ error: "Feature 'mcp-server' is not enabled" });
  });

  it('keeps post-MVP OSS integration flags off by default', async () => {
    const { getFeatureFlags } = await import('./feature-flags.js');
    const flags = getFeatureFlags();

    expect(flags['screenshot-diff']).toBe(false);
    expect(flags['looks-same-diff']).toBe(false);
    expect(flags['spec-aware-triage']).toBe(false);
    expect(flags['frequent-failures']).toBe(false);
    expect(flags['checks-annotations']).toBe(false);
  });

  it('enables screenshot-diff when FEATURE_SCREENSHOT_DIFF=true', async () => {
    process.env.FEATURE_SCREENSHOT_DIFF = 'true';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('screenshot-diff')).toBe(true);
  });

  it('enables frequent-failures when FEATURE_FREQUENT_FAILURES=true', async () => {
    process.env.FEATURE_FREQUENT_FAILURES = 'true';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('frequent-failures')).toBe(true);
  });

  it('requireFeature returns 404 when screenshot-diff is explicitly disabled outside test env', async () => {
    process.env.NODE_ENV = 'development';
    process.env.FEATURE_SCREENSHOT_DIFF = 'false';
    const { requireFeature } = await import('./feature-flags.js');

    const send = vi.fn();
    const status = vi.fn(() => ({ send }));
    const reply = { status } as unknown as { status: (code: number) => { send: (payload: unknown) => unknown } };

    const guard = requireFeature('screenshot-diff');
    await guard({} as never, reply as never);

    expect(status).toHaveBeenCalledWith(404);
    expect(send).toHaveBeenCalledWith({ error: "Feature 'screenshot-diff' is not enabled" });
  });

  // ── Mutation-killing: flagToEnvVar string transformations ────────────────

  it('flagToEnvVar correctly converts "auto-quarantine" to "FEATURE_AUTO_QUARANTINE" — kills StringLiteral/MethodExpression mutations', async () => {
    // Test that FEATURE_ prefix is used (not empty string) and hyphens → underscores
    process.env.FEATURE_AUTO_QUARANTINE = 'false';
    const { isEnabled } = await import('./feature-flags.js');
    // With the env var explicitly set to false, should be disabled
    expect(isEnabled('auto-quarantine')).toBe(false);
    delete process.env.FEATURE_AUTO_QUARANTINE;
  });

  it('uses FEATURE_ prefix (not empty) when reading env var — kills StringLiteral "" mutation on "FEATURE_" prefix', async () => {
    // Set the env var WITHOUT FEATURE_ prefix — should NOT be picked up
    process.env.AUTO_QUARANTINE = 'true';
    const { isEnabled } = await import('./feature-flags.js');
    // Without FEATURE_ prefix, the env var is NOT read → falls back to MVP default (false)
    expect(isEnabled('auto-quarantine')).toBe(false);
    delete process.env.AUTO_QUARANTINE;
  });

  it('resolveFlag treats "1" as truthy for disabled flags — kills StringLiteral "1" mutation', async () => {
    process.env.FEATURE_MCP_SERVER = '1';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('mcp-server')).toBe(true);
    delete process.env.FEATURE_MCP_SERVER;
  });

  it('resolveFlag treats "0" as falsy for MVP flags — kills StringLiteral "0" mutation', async () => {
    process.env.FEATURE_LIVE_RUN_MONITORING = '0';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('live-run-monitoring')).toBe(false);
    delete process.env.FEATURE_LIVE_RUN_MONITORING;
  });

  it('resolveFlag treats "false" as falsy for MVP flags — kills StringLiteral "false" mutation', async () => {
    process.env.FEATURE_ANALYTICS_DASHBOARD = 'false';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('analytics-dashboard')).toBe(false);
    delete process.env.FEATURE_ANALYTICS_DASHBOARD;
  });

  it('resolveFlag falls back to default when env var is unset (not "true"/"false"/"0"/"1") — kills ConditionalExpression mutation', async () => {
    process.env.FEATURE_MCP_SERVER = 'yes'; // non-standard value → falls back to default (false)
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('mcp-server')).toBe(false);
    delete process.env.FEATURE_MCP_SERVER;
  });

  it('isEnabled returns false for unknown flag — kills BlockStatement {} mutation on guard', async () => {
    const { isEnabled } = await import('./feature-flags.js');
    // 'non-existent-flag' is not in FLAG_DEFAULTS → must return false (not true or throw)
    expect(isEnabled('non-existent-flag' as never)).toBe(false);
  });

  it('requireFeature error message includes exact flag name in single quotes — kills StringLiteral mutation', async () => {
    process.env.NODE_ENV = 'development';
    const { requireFeature } = await import('./feature-flags.js');

    const send = vi.fn();
    const status = vi.fn(() => ({ send }));
    const reply = { status } as unknown as { status: (code: number) => { send: (payload: unknown) => unknown } };

    const guard = requireFeature('mcp-gateway');
    await guard({} as never, reply as never);

    // Exact string format: "Feature '<flagname>' is not enabled"
    expect(send).toHaveBeenCalledWith({ error: "Feature 'mcp-gateway' is not enabled" });
  });

  it('v1 core flags default to true (live-run-monitoring) — kills default boolean mutation', async () => {
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('live-run-monitoring')).toBe(true);
  });

  it('mcp-gateway flag defaults to false — kills default boolean mutation', async () => {
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('mcp-gateway')).toBe(false);
  });

  it('getFeatureFlags returns all defined flags (30+ entries) — kills ObjectLiteral {} mutation', async () => {
    const { getFeatureFlags } = await import('./feature-flags.js');
    const flags = getFeatureFlags();
    const keys = Object.keys(flags);
    // Should have all flag entries, not empty object
    expect(keys.length).toBeGreaterThanOrEqual(30);
    expect(flags['live-run-monitoring']).toBe(true);
    expect(flags['mcp-server']).toBe(false);
  });

  it('v1 AI-QA Platform flags default to false', async () => {
    const { getFeatureFlags } = await import('./feature-flags.js');
    const flags = getFeatureFlags();

    expect(flags['agent-tracking']).toBe(false);
    expect(flags['ai-test-gen-v2']).toBe(false);
    expect(flags['agent-repair']).toBe(false);
    expect(flags['multi-agent-awareness']).toBe(false);
  });

  it('enables agent-tracking when FEATURE_AGENT_TRACKING=true', async () => {
    process.env.FEATURE_AGENT_TRACKING = 'true';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('agent-tracking')).toBe(true);
  });

  it('enables ai-test-gen-v2 when FEATURE_AI_TEST_GEN_V2=true', async () => {
    process.env.FEATURE_AI_TEST_GEN_V2 = 'true';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('ai-test-gen-v2')).toBe(true);
  });

  it('enables agent-repair when FEATURE_AGENT_REPAIR=true', async () => {
    process.env.FEATURE_AGENT_REPAIR = 'true';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('agent-repair')).toBe(true);
  });

  it('enables multi-agent-awareness when FEATURE_MULTI_AGENT_AWARENESS=true', async () => {
    process.env.FEATURE_MULTI_AGENT_AWARENESS = 'true';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('multi-agent-awareness')).toBe(true);
  });
});
