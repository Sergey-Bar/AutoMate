/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs before importing config-parser
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

describe('parsePlaywrightConfig', () => {
  // ── File not found ────────────────────────────────────────────────────
  it('throws when config file does not exist', () => {
    mockedExistsSync.mockReturnValue(false);
    expect(() => parsePlaywrightConfig('/missing/config.ts')).toThrow(
      'Config file not found: /missing/config.ts',
    );
  });

  // ── Global settings ───────────────────────────────────────────────────
  it('parses global settings from defineConfig', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
      import { defineConfig } from '@playwright/test';
      export default defineConfig({
        testDir: './tests',
        outputDir: './results',
        retries: 2,
        workers: 4,
        timeout: 30000,
        fullyParallel: true,
        forbidOnly: true,
      });
    `);

    const config = parsePlaywrightConfig('/project/playwright.config.ts');
    expect(config.testDir).toBe('./tests');
    expect(config.outputDir).toBe('./results');
    expect(config.retries).toBe(2);
    expect(config.workers).toBe(4);
    expect(config.globalTimeout).toBe(30000);
    expect(config.fullyParallel).toBe(true);
    expect(config.forbidOnly).toBe(true);
  });

  // ── Workers as string ─────────────────────────────────────────────────
  it('parses workers as percentage string', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
      export default defineConfig({
        workers: '50%',
      });
    `);

    const config = parsePlaywrightConfig('/project/playwright.config.ts');
    expect(config.workers).toBe('50%');
  });

  // ── webServer ─────────────────────────────────────────────────────────
  it('parses webServer block', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
      export default defineConfig({
        webServer: {
          command: 'npm run dev',
          url: 'http://localhost:3000',
          port: 3000,
          reuseExistingServer: true,
        },
      });
    `);

    const config = parsePlaywrightConfig('/project/playwright.config.ts');
    expect(config.webServer).toBeDefined();
    expect(config.webServer!.command).toBe('npm run dev');
    expect(config.webServer!.url).toBe('http://localhost:3000');
    expect(config.webServer!.port).toBe(3000);
    expect(config.webServer!.reuseExistingServer).toBe(true);
  });

  // ── Projects with use block ───────────────────────────────────────────
  it('parses projects with use block', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
      export default defineConfig({
        projects: [
          {
            name: 'chromium',
            use: {
              browserName: 'chromium',
              baseURL: 'http://localhost:3000',
              headless: true,
              trace: 'on-first-retry',
              screenshot: 'only-on-failure',
              video: 'retain-on-failure',
              viewport: { width: 1280, height: 720 },
            },
          },
          {
            name: 'firefox',
            use: {
              browserName: 'firefox',
            },
          },
        ],
      });
    `);

    const config = parsePlaywrightConfig('/project/playwright.config.ts');
    expect(config.projects).toHaveLength(2);

    const chromium = config.projects[0];
    expect(chromium.name).toBe('chromium');
    expect(chromium.use?.browserName).toBe('chromium');
    expect(chromium.use?.baseURL).toBe('http://localhost:3000');
    expect(chromium.use?.headless).toBe(true);
    expect(chromium.use?.trace).toBe('on-first-retry');
    expect(chromium.use?.screenshot).toBe('only-on-failure');
    expect(chromium.use?.video).toBe('retain-on-failure');
    expect(chromium.use?.viewport).toEqual({ width: 1280, height: 720 });

    const firefox = config.projects[1];
    expect(firefox.name).toBe('firefox');
    expect(firefox.use?.browserName).toBe('firefox');
  });

  // ── Infer browser from channel ────────────────────────────────────────
  it('infers browser name from channel', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
      export default defineConfig({
        projects: [
          {
            name: 'Chrome Stable',
            use: {
              channel: 'chrome',
            },
          },
          {
            name: 'Edge',
            use: {
              channel: 'msedge',
            },
          },
        ],
      });
    `);

    const config = parsePlaywrightConfig('/project/playwright.config.ts');
    expect(config.projects[0].use?.browserName).toBe('chromium');
    expect(config.projects[1].use?.browserName).toBe('chromium');
  });

  // ── Default project when no projects block ────────────────────────────
  it('creates default project when no projects block exists', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
      export default defineConfig({
        testDir: './e2e',
      });
    `);

    const config = parsePlaywrightConfig('/project/playwright.config.ts');
    expect(config.projects).toHaveLength(1);
    expect(config.projects[0].name).toBe('default');
  });

  // ── Project-level settings ────────────────────────────────────────────
  it('parses project-level retries, timeout, and testDir', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
      export default defineConfig({
        projects: [
          {
            name: 'slow',
            testDir: './slow-tests',
            retries: 3,
            timeout: 60000,
          },
        ],
      });
    `);

    const config = parsePlaywrightConfig('/project/playwright.config.ts');
    const project = config.projects[0];
    expect(project.testDir).toBe('./slow-tests');
    expect(project.retries).toBe(3);
    expect(project.timeout).toBe(60000);
  });

  // ── Project with dependencies ─────────────────────────────────────────
  it('parses project dependencies', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
      export default defineConfig({
        projects: [
          {
            name: 'setup',
            testDir: './setup',
          },
          {
            name: 'tests',
            dependencies: ['setup'],
          },
        ],
      });
    `);

    const config = parsePlaywrightConfig('/project/playwright.config.ts');
    expect(config.projects[1].dependencies).toEqual(['setup']);
  });

  // ── Reporter ──────────────────────────────────────────────────────────
  it('parses reporter as string', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
      export default defineConfig({
        reporter: 'html',
      });
    `);

    const config = parsePlaywrightConfig('/project/playwright.config.ts');
    expect(config.reporter).toBe('html');
  });

  // ── Infer webkit from channel ─────────────────────────────────────────
  it('infers webkit from safari channel', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
      export default defineConfig({
        projects: [
          {
            name: 'Safari',
            use: {
              channel: 'webkit-safari',
            },
          },
        ],
      });
    `);

    const config = parsePlaywrightConfig('/project/playwright.config.ts');
    expect(config.projects[0].use?.browserName).toBe('webkit');
  });

  // ── Infer firefox from channel ────────────────────────────────────────
  it('infers firefox from firefox channel', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
      export default defineConfig({
        projects: [
          {
            name: 'FF',
            use: {
              channel: 'firefox-stable',
            },
          },
        ],
      });
    `);

    const config = parsePlaywrightConfig('/project/playwright.config.ts');
    expect(config.projects[0].use?.browserName).toBe('firefox');
  });
});
