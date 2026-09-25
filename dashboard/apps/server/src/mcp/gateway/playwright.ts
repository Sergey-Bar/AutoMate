import type { StdioMcpServerConfig } from './registry.js';

export interface PlaywrightMcpConfig extends StdioMcpServerConfig {
  headless: boolean;
}

export const DEFAULT_PLAYWRIGHT_CONFIG: PlaywrightMcpConfig = {
  id: 'playwright',
  name: 'Playwright MCP',
  transport: 'stdio',
  command: 'npx',
  args: ['@playwright/mcp@latest'],
  enabled: true,
  featureFlag: 'mcp-playwright',
  toolPrefix: 'playwright',
  headless: true,
};

export class PlaywrightMcpManager {
  private readonly config: PlaywrightMcpConfig;

  constructor(overrides?: Partial<PlaywrightMcpConfig>) {
    this.config = { ...DEFAULT_PLAYWRIGHT_CONFIG, ...overrides };
  }

  getConfig(): PlaywrightMcpConfig {
    return { ...this.config };
  }

  buildSpawnArgs(): string[] {
    const args = [...this.config.args];
    if (this.config.headless) {
      args.push('--headless');
    }
    return args;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { execSync } = await import('node:child_process');
      execSync('npx --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}
