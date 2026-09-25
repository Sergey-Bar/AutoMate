import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('feature-flags', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    delete process.env.FEATURE_MCP_CLIENT;
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    delete process.env.FEATURE_OPENAPI_PARSING;
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    delete process.env.FEATURE_CONTRACT_TEST_GEN;
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    delete process.env.FEATURE_AI_TEST_GEN;
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    delete process.env.FEATURE_POSTMAN_IMPORT;
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    delete process.env.FEATURE_DASHBOARD_CONNECTOR;
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    delete process.env.FEATURE_UNIFIED_HEALTH;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('includes mcp-client and defaults it to false', async () => {
    const { getFeatureFlags } = await import('./feature-flags.js');
    const flags = getFeatureFlags();
    expect(flags['mcp-client']).toBe(false);
  });

  it('defaults dashboard-connector and unified-health to false', async () => {
    const { getFeatureFlags } = await import('./feature-flags.js');
    const flags = getFeatureFlags();

    expect(flags['dashboard-connector']).toBe(false);
    expect(flags['unified-health']).toBe(false);
  });

  it('enables mcp-client when FEATURE_MCP_CLIENT=true', async () => {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.FEATURE_MCP_CLIENT = 'true';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('mcp-client')).toBe(true);
  });

  it('enables dashboard-connector when FEATURE_DASHBOARD_CONNECTOR=true', async () => {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.FEATURE_DASHBOARD_CONNECTOR = 'true';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('dashboard-connector')).toBe(true);
  });

  it('requireFeature returns 404 when mcp-client is disabled outside test env', async () => {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.NODE_ENV = 'development';
    const { requireFeature } = await import('./feature-flags.js');

    const send = vi.fn();
    const status = vi.fn(() => ({ send }));
    const reply = { status } as unknown as { status: (code: number) => { send: (payload: unknown) => unknown } };

    const guard = requireFeature('mcp-client');
    await guard({} as never, reply as never);

    expect(status).toHaveBeenCalledWith(404);
    expect(send).toHaveBeenCalledWith({ error: "Feature 'mcp-client' is not enabled" });
  });

  it('v2.2+ OSS integration flags default to false', async () => {
    const { getFeatureFlags } = await import('./feature-flags.js');
    const flags = getFeatureFlags();

    expect(flags['openapi-parsing']).toBe(false);
    expect(flags['contract-test-gen']).toBe(false);
    expect(flags['ai-test-gen']).toBe(false);
    expect(flags['postman-import']).toBe(false);
  });

  it('enables openapi-parsing when FEATURE_OPENAPI_PARSING=true', async () => {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.FEATURE_OPENAPI_PARSING = 'true';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('openapi-parsing')).toBe(true);
  });

  it('enables ai-test-gen when FEATURE_AI_TEST_GEN=true', async () => {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.FEATURE_AI_TEST_GEN = 'true';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('ai-test-gen')).toBe(true);
  });

  it('requireFeature returns 404 when openapi-parsing is disabled outside test env', async () => {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.NODE_ENV = 'development';
    const { requireFeature } = await import('./feature-flags.js');

    const send = vi.fn();
    const status = vi.fn(() => ({ send }));
    const reply = { status } as unknown as { status: (code: number) => { send: (payload: unknown) => unknown } };

    const guard = requireFeature('openapi-parsing');
    await guard({} as never, reply as never);

    expect(status).toHaveBeenCalledWith(404);
    expect(send).toHaveBeenCalledWith({ error: "Feature 'openapi-parsing' is not enabled" });
  });
});
