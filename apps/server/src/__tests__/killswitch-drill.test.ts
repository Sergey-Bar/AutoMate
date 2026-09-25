import { afterEach, describe, expect, it, vi } from 'vitest';
import { isEnabled } from '../services/feature-flags.js';

const MCP_CLIENT_ENV_VAR = 'FEATURE_MCP_CLIENT';

describe('kill-switch drill (platform feature flags)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to false when env var is unset', () => {
    expect(isEnabled('mcp-client')).toBe(false);
  });

  it('enables mcp-client when env var is true', () => {
    vi.stubEnv(MCP_CLIENT_ENV_VAR, 'true');
    expect(isEnabled('mcp-client')).toBe(true);
  });

  it('disables mcp-client when env var is false', () => {
    vi.stubEnv(MCP_CLIENT_ENV_VAR, 'false');
    expect(isEnabled('mcp-client')).toBe(false);
  });

  it('falls back to false after unsetting env var', () => {
    vi.stubEnv(MCP_CLIENT_ENV_VAR, 'true');
    expect(isEnabled('mcp-client')).toBe(true);

    vi.stubEnv(MCP_CLIENT_ENV_VAR, '');
    delete process.env[MCP_CLIENT_ENV_VAR]; // eslint-disable-line test-flakiness/no-global-state-mutation
    expect(isEnabled('mcp-client')).toBe(false);
  });
});
