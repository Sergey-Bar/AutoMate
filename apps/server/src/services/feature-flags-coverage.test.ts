import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';

describe('feature-flags additional branch coverage', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('isEnabled returns false for unknown flag not in FLAG_DEFAULTS (line 29)', async () => {
    const { isEnabled } = await import('./feature-flags.js');
    // 'unknown-flag' is not in FLAG_DEFAULTS
    expect(isEnabled('unknown-flag' as 'mcp-client')).toBe(false);
  });

  it('resolveFlag returns true when env var is "1"', async () => {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.FEATURE_MCP_CLIENT = '1';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('mcp-client')).toBe(true);
  });

  it('resolveFlag returns false when env var is "false"', async () => {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.FEATURE_MCP_CLIENT = 'false';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('mcp-client')).toBe(false);
  });

  it('resolveFlag returns false when env var is "0"', async () => {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.FEATURE_MCP_CLIENT = '0';
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('mcp-client')).toBe(false);
  });

  it('requireFeature does NOT return 404 when NODE_ENV is "test" (line 35 early return)', async () => {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.NODE_ENV = 'test';
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.FEATURE_MCP_CLIENT = 'false'; // Feature disabled — but we're in test env
    const { requireFeature } = await import('./feature-flags.js');

    const status = vi.fn();
    const reply = { status } as unknown as Parameters<typeof requireFeature>[0];

    const guard = requireFeature('mcp-client');
    // In test env: should return undefined (early return), NOT call reply.status(404)
    await guard({} as never, reply as never);
    expect(status).not.toHaveBeenCalled();
  });

  it('requireFeature passes through when feature is enabled outside test env', async () => {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.NODE_ENV = 'development';
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.FEATURE_MCP_CLIENT = 'true';
    const { requireFeature } = await import('./feature-flags.js');

    const send = vi.fn();
    const status = vi.fn(() => ({ send }));
    const reply = { status } as unknown as Parameters<typeof requireFeature>[0];

    const guard = requireFeature('mcp-client');
    await guard({} as never, reply as never);
    // Feature is enabled — should NOT return 404
    expect(status).not.toHaveBeenCalled();
  });
});
