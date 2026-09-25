/**
 * config-parser.ts — structured extraction of Playwright config
 *
 * Reads a playwright.config.ts file and extracts project definitions,
 * global settings, and browser info using regex-based parsing
 * (no heavy AST dependency required).
 */

import * as fs from 'fs';

export interface ParsedProject {
  name: string;
  testDir?: string;
  use?: {
    browserName?: string;
    baseURL?: string;
    viewport?: { width: number; height: number };
    headless?: boolean;
    trace?: string;
    screenshot?: string;
    video?: string;
    [key: string]: unknown;
  };
  retries?: number;
  timeout?: number;
  grep?: string;
  grepInvert?: string;
  dependencies?: string[];
}

export interface ParsedConfig {
  projects: ParsedProject[];
  globalTimeout?: number;
  retries?: number;
  workers?: number | string;
  testDir?: string;
  outputDir?: string;
  reporter?: string;
  fullyParallel?: boolean;
  forbidOnly?: boolean;
  webServer?: {
    command?: string;
    url?: string;
    port?: number;
    reuseExistingServer?: boolean;
  };
}

/**
 * Parse a Playwright config file and extract structured project data.
 * Uses regex heuristic parsing — works for standard defineConfig patterns.
 */
export function parsePlaywrightConfig(configPath: string): ParsedConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const result: ParsedConfig = { projects: [] };

  // ── Global settings ──────────────────────────────────────────────────
  result.testDir = extractStringProp(raw, 'testDir');
  result.outputDir = extractStringProp(raw, 'outputDir');
  result.retries = extractNumberProp(raw, 'retries');
  result.workers = extractWorkersProp(raw);
  result.globalTimeout = extractNumberProp(raw, 'timeout');
  result.fullyParallel = extractBoolProp(raw, 'fullyParallel');
  result.forbidOnly = extractBoolProp(raw, 'forbidOnly');

  // Reporter — extract string or first element of array
  const reporterMatch = raw.match(/reporter\s*:\s*(?:'([^']+)'|"([^"]+)"|\[)/);
  if (reporterMatch) {
    result.reporter = reporterMatch[1] ?? reporterMatch[2] ?? 'custom';
  }

  // ── webServer ────────────────────────────────────────────────────────
  const wsMatch = raw.match(/webServer\s*:\s*\{([^}]+)\}/s);
  if (wsMatch) {
    const block = wsMatch[1] ?? '';
    result.webServer = {
      command: extractStringPropFromBlock(block, 'command'),
      url: extractStringPropFromBlock(block, 'url'),
      port: extractNumberPropFromBlock(block, 'port'),
      reuseExistingServer: extractBoolPropFromBlock(block, 'reuseExistingServer'),
    };
  }

  // ── Projects ─────────────────────────────────────────────────────────
  const projectsBlockMatch = raw.match(/projects\s*:\s*\[([\s\S]*?)\n\s*\]/);
  if (projectsBlockMatch) {
    const projectsBlock = projectsBlockMatch[1] ?? '';
    // Split on top-level object boundaries
    const projectChunks = splitProjectObjects(projectsBlock);

    for (const chunk of projectChunks) {
      const name = extractStringPropFromBlock(chunk, 'name');
      if (!name) continue;

      const project: ParsedProject = { name };
      project.testDir = extractStringPropFromBlock(chunk, 'testDir');
      project.retries = extractNumberPropFromBlock(chunk, 'retries');
      project.timeout = extractNumberPropFromBlock(chunk, 'timeout');
      project.grep = extractStringPropFromBlock(chunk, 'grep');
      project.grepInvert = extractStringPropFromBlock(chunk, 'grepInvert');

      // Dependencies
      const depsMatch = chunk.match(/dependencies\s*:\s*\[([^\]]*)\]/);
      if (depsMatch) {
        project.dependencies = (depsMatch[1] ?? '')
          .split(',')
          .map((d) => d.trim().replace(/['"]/g, ''))
          .filter(Boolean);
      }

      // use block
      const useMatch = chunk.match(/use\s*:\s*\{([\s\S]*?)\n\s{4,}\}/);
      if (useMatch) {
        const useBlock = useMatch[1] ?? '';
        project.use = {};
        project.use.browserName = extractStringPropFromBlock(useBlock, 'browserName') ??
          inferBrowserFromChannel(extractStringPropFromBlock(useBlock, 'channel'));
        project.use.baseURL = extractStringPropFromBlock(useBlock, 'baseURL');
        project.use.headless = extractBoolPropFromBlock(useBlock, 'headless');
        project.use.trace = extractStringPropFromBlock(useBlock, 'trace');
        project.use.screenshot = extractStringPropFromBlock(useBlock, 'screenshot');
        project.use.video = extractStringPropFromBlock(useBlock, 'video');

        // viewport
        const vpMatch = useBlock.match(/viewport\s*:\s*\{\s*width\s*:\s*(\d+)\s*,\s*height\s*:\s*(\d+)/);
        if (vpMatch) {
          project.use.viewport = { width: Number(vpMatch[1] ?? 0), height: Number(vpMatch[2] ?? 0) };
        }

        // channel
        const channel = extractStringPropFromBlock(useBlock, 'channel');
        if (channel) project.use.browserName = inferBrowserFromChannel(channel) ?? project.use.browserName;
      }

      result.projects.push(project);
    }
  }

  // If no projects block found, create a "default" project
  if (result.projects.length === 0) {
    result.projects.push({ name: 'default' });
  }

  return result;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractStringProp(text: string, prop: string): string | undefined {
  const re = new RegExp(`(?:^|[,{])\\s*${prop}\\s*:\\s*(?:'([^']*)'|"([^"]*)"|\`([^\`]*)\`)`, 'm');
  const m = text.match(re);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

function extractStringPropFromBlock(block: string, prop: string): string | undefined {
  const re = new RegExp(`${prop}\\s*:\\s*(?:'([^']*)'|"([^"]*)"|\`([^\`]*)\`)`, 'm');
  const m = block.match(re);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

function extractNumberProp(text: string, prop: string): number | undefined {
  const re = new RegExp(`${prop}\\s*:\\s*(\\d+)`, 'm');
  const m = text.match(re);
  return m ? Number(m[1]) : undefined;
}

function extractNumberPropFromBlock(block: string, prop: string): number | undefined {
  return extractNumberProp(block, prop);
}

function extractBoolProp(text: string, prop: string): boolean | undefined {
  const re = new RegExp(`${prop}\\s*:\\s*(true|false)`, 'm');
  const m = text.match(re);
  return m ? m[1] === 'true' : undefined;
}

function extractBoolPropFromBlock(block: string, prop: string): boolean | undefined {
  return extractBoolProp(block, prop);
}

function extractWorkersProp(text: string): number | string | undefined {
  const re = /workers\s*:\s*(?:(\d+)|'([^']*)'|"([^"]*)")/m;
  const m = text.match(re);
  if (!m) return undefined;
  if (m[1]) return Number(m[1]);
  return m[2] ?? m[3];
}

function inferBrowserFromChannel(channel?: string | null): string | undefined {
  if (!channel) return undefined;
  if (channel.includes('chrome') || channel.includes('chromium')) return 'chromium';
  if (channel.includes('firefox')) return 'firefox';
  if (channel.includes('webkit') || channel.includes('safari')) return 'webkit';
  if (channel.includes('msedge') || channel.includes('edge')) return 'chromium';
  return channel;
}

function splitProjectObjects(block: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < block.length; i++) {
    const ch = block[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        results.push(block.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return results;
}
