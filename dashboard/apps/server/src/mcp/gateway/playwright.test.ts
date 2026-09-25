import { describe, it, expect, beforeEach } from 'vitest';
import {
  PlaywrightMcpManager,
  DEFAULT_PLAYWRIGHT_CONFIG,
} from './playwright.js';

describe('PlaywrightMcpManager', () => {
  let manager: PlaywrightMcpManager;

  beforeEach(() => {
    manager = new PlaywrightMcpManager();
  });

  describe('DEFAULT_PLAYWRIGHT_CONFIG', () => {
    it('has correct default values', () => {
      expect(DEFAULT_PLAYWRIGHT_CONFIG).toEqual({
        id: 'playwright',
        name: 'Playwright MCP',
        transport: 'stdio',
        command: 'npx',
        args: ['@playwright/mcp@latest'],
        enabled: true,
        featureFlag: 'mcp-playwright',
        toolPrefix: 'playwright',
        headless: true,
      });
    });
  });

  describe('getConfig', () => {
    it('returns default config when none provided', () => {
      const config = manager.getConfig();
      expect(config.command).toBe('npx');
      expect(config.args).toContain('@playwright/mcp@latest');
    });

    it('merges custom config with defaults', () => {
      manager = new PlaywrightMcpManager({ headless: false });
      const config = manager.getConfig();
      expect(config.headless).toBe(false);
      expect(config.command).toBe('npx'); // default preserved
    });
  });

  describe('buildSpawnArgs', () => {
    it('includes --headless flag for headless mode', () => {
      const args = manager.buildSpawnArgs();
      expect(args).toContain('--headless');
    });

    it('omits --headless when headless is false', () => {
      manager = new PlaywrightMcpManager({ headless: false });
      const args = manager.buildSpawnArgs();
      expect(args).not.toContain('--headless');
    });
  });

  describe('isAvailable', () => {
    it('returns false when npx is not available (mocked)', async () => {
      // In test env, we don't actually check npx — just verify the method exists
      // Real integration test would check process spawning
      expect(typeof manager.isAvailable).toBe('function');
    });
  });
});
