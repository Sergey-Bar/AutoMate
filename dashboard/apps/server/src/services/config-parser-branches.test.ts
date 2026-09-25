/**
 * config-parser-branches.test.ts
 *
 * Additional branch coverage for config-parser.ts
 * - inferBrowserFromChannel with an unknown channel returns the channel name itself
 */
/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { parsePlaywrightConfig } from './config-parser.js';
import * as fs from 'fs';

const mockedExistsSync = vi.mocked(fs.existsSync);
const mockedReadFileSync = vi.mocked(fs.readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('config-parser — additional branch coverage', () => {
  it('inferBrowserFromChannel falls through and returns the channel name for unknown channels', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
      export default defineConfig({
        projects: [
          {
            name: 'Custom Browser',
            use: {
              channel: 'custom-experimental',
            },
          },
        ],
      });
    `);

    const config = parsePlaywrightConfig('/project/playwright.config.ts');
    // 'custom-experimental' does not match chrome, firefox, webkit, or edge patterns
    // so inferBrowserFromChannel returns the channel string itself
    expect(config.projects[0].use?.browserName).toBe('custom-experimental');
  });

  it('inferBrowserFromChannel returns undefined for null/undefined channel', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
      export default defineConfig({
        projects: [
          {
            name: 'NoChannel',
            use: {
              browserName: 'chromium',
            },
          },
        ],
      });
    `);

    const config = parsePlaywrightConfig('/project/playwright.config.ts');
    // No channel → inferBrowserFromChannel(undefined) returns undefined
    // browserName is set directly
    expect(config.projects[0].use?.browserName).toBe('chromium');
  });

  it('extractWorkersProp returns string worker value from double-quoted string', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
      export default defineConfig({
        workers: "75%",
      });
    `);

    const config = parsePlaywrightConfig('/project/playwright.config.ts');
    expect(config.workers).toBe('75%');
  });

  it('reporter is "custom" when reporter is an array', async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
      export default defineConfig({
        reporter: [['html'], ['json']],
      });
    `);

    const config = parsePlaywrightConfig('/project/playwright.config.ts');
    // reporter match sees '[' → uses 'custom'
    expect(config.reporter).toBe('custom');
  });

  it('extractStringProp resolves double-quoted value (covers m[2] branch)', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
      export default defineConfig({
        testDir: "./double-quoted-tests",
        projects: [
          { name: "chromium", use: { browserName: "chromium" } }
        ],
      });
    `);

    const config = parsePlaywrightConfig('/project/playwright.config.ts');
    expect(config.testDir).toBe('./double-quoted-tests');
  });

  it('extractStringProp resolves backtick-quoted value (covers m[3] branch)', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      'export default defineConfig({ testDir: `backtick-tests`, projects: [{ name: `chromium`, use: { browserName: `chromium` } }] });',
    );

    const config = parsePlaywrightConfig('/project/playwright.config.ts');
    expect(config.testDir).toBe('backtick-tests');
  });
});
