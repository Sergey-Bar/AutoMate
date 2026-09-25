/**
 * index.ts — Agents Hono sub-app
 *
 * Combines all agent domain routes under a single Hono instance.
 * Browser domain routes to the test-gen capability.
 * API/load/security/mobile return executable baseline artifacts.
 *
 * Mount in apps/api/src/index.ts via:
 *   app.route('/', createAgentsModule())
 *
 * PRD domains: browser, api, load, security, mobile
 */
import { Hono } from 'hono';
import { createBrowserAgentRoutes } from './browser.js';
import { parseAgentRunRequest, runDomainAgent } from './domains.js';
import type { AgentDomain } from './domains.js';

// ---------------------------------------------------------------------------
// Module options
// ---------------------------------------------------------------------------

export interface AgentsModuleOptions {
  /** Optional browser agent options (for testing) */
  browserOptions?: Parameters<typeof createBrowserAgentRoutes>[0];
}

// ---------------------------------------------------------------------------
// Executable run routes (non-browser domains)
// ---------------------------------------------------------------------------

type UnimplementedDomainConfig = {
  domain: Exclude<AgentDomain, 'browser'>;
  path: string;
};

const RUNNABLE_DOMAINS: UnimplementedDomainConfig[] = [
  { domain: 'api', path: '/api/v1/agents/api/run' },
  { domain: 'load', path: '/api/v1/agents/load/run' },
  { domain: 'security', path: '/api/v1/agents/security/run' },
  { domain: 'mobile', path: '/api/v1/agents/mobile/run' },
];

// ---------------------------------------------------------------------------
// Module factory
// ---------------------------------------------------------------------------

export function createAgentsModule(options: AgentsModuleOptions = {}): Hono {
  const app = new Hono();

  // Browser agent — implemented (maps to test-gen capability)
  app.route('/', createBrowserAgentRoutes(options.browserOptions));

  // Runnable domains — return executable baseline artifacts
  for (const { domain, path } of RUNNABLE_DOMAINS) {
    const capturedDomain = domain;
    app.post(path, async (c) => {
      let rawBody: unknown;
      try {
        rawBody = await c.req.json();
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }

      const parsed = parseAgentRunRequest(rawBody);
      if (!parsed) {
        return c.json({ error: 'objective is required and must be a non-empty string' }, 400);
      }

      return c.json(runDomainAgent(capturedDomain, parsed));
    });
  }

  return app;
}

// Re-export types and implementations so callers can inject mocks for testing
export type { AgentDomain, AgentResult } from './domains.js';
export { AGENT_DOMAINS, parseAgentRunRequest, runDomainAgent } from './domains.js';
export { createBrowserAgentRoutes } from './browser.js';
export type { BrowserAgentOptions } from './browser.js';
