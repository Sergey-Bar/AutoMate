import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeGateway } from './init.js';
import { McpServerRegistry } from './registry.js';

const featureFlagsMock = vi.hoisted(() => ({
  isEnabled: vi.fn<(flag: string) => boolean>(),
}));

vi.mock('../../services/feature-flags.js', () => ({
  isEnabled: featureFlagsMock.isEnabled,
}));

describe('initializeGateway', () => {
  beforeEach(() => {
    featureFlagsMock.isEnabled.mockReturnValue(false);
  });

  it('returns undefined when mcp-gateway is disabled', async () => {
    featureFlagsMock.isEnabled.mockImplementation((flag: string) => {
      return flag !== 'mcp-gateway';
    });

    const result = await initializeGateway();

    expect(result).toBeUndefined();
  });

  it('returns context with empty registry when mcp-gateway is enabled but mcp-playwright is disabled', async () => {
    featureFlagsMock.isEnabled.mockImplementation((flag: string) => {
      return flag === 'mcp-gateway';
    });

    const result = await initializeGateway();

    expect(result).toBeDefined();
    expect(result?.registry).toBeInstanceOf(McpServerRegistry);
    expect(result?.registry.getAll()).toHaveLength(0);
    expect(result?.lifecycle).toBeDefined();
    expect(result?.proxy).toBeDefined();
  });

  it('returns context with playwright registered when both mcp-gateway and mcp-playwright are enabled', async () => {
    featureFlagsMock.isEnabled.mockImplementation((flag: string) => {
      return flag === 'mcp-gateway' || flag === 'mcp-playwright';
    });

    const result = await initializeGateway();

    expect(result).toBeDefined();
    expect(result?.registry.getAll()).toHaveLength(1);

    const playwrightConfig = result?.registry.get('playwright');
    expect(playwrightConfig).toBeDefined();
    expect(playwrightConfig?.toolPrefix).toBe('playwright');
    expect(playwrightConfig?.id).toBe('playwright');
    expect(playwrightConfig?.enabled).toBe(true);
  });
});
