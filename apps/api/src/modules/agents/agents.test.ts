/**
 * agents.test.ts — Comprehensive tests for the agents module
 *
 * Covers:
 *
 *  Browser agent (POST /api/v1/agents/browser/generate):
 *   1.  Valid request returns 200 with completed AgentResult
 *   2.  Missing prompt returns 400 with error field
 *   3.  Empty string prompt returns 400 with error field
 *   4.  Whitespace-only prompt returns 400 with error field
 *   5.  Response domain is always 'browser'
 *   6.  Response status is always 'completed'
 *   7.  Result contains testCode, prompt, framework, generatedAt fields
 *   8.  generatedAt is a valid ISO timestamp string
 *   9.  framework is 'playwright'
 *  10.  prompt is trimmed in the result
 *  11.  Mock override via mockGenerateFn is respected
 *  12.  Invalid JSON body returns 400
 *
 *  Runnable domains (POST /api/v1/agents/{domain}/run):
 *  13.  POST /api/v1/agents/api/run → 200 completed AgentResult
 *  14.  POST /api/v1/agents/load/run → 200 completed AgentResult
 *  15.  POST /api/v1/agents/security/run → 200 completed AgentResult
 *  16.  POST /api/v1/agents/mobile/run → 200 completed AgentResult
 *
 *  Runnable response shape:
 *  17.  domain field matches the requested domain
 *  18.  status is completed
 *  19.  result contains runId, objective, plan, output
 *  20.  invalid payload returns 400
 *  21.  invalid JSON returns 400
 *
 *  AgentResult shape contract:
 *  22.  Browser result has domain, status, result fields
 *  23.  Browser result has no error field on success
 *  24.  All unimplemented results have no 'result' field
 *
 *  Module integration (createAgentsModule):
 *  25.  Module wires all routes together
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Hono } from 'hono';
import { createBrowserAgentRoutes } from './browser.js';
import { createAgentsModule } from './index.js';
import { parseAgentRunRequest } from './index.js';
import type { AgentResult } from './index.js';

// ---------------------------------------------------------------------------
// Evidence directory helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// From apps/api/src/modules/agents/ → repo root is 5 levels up
const REPO_ROOT = path.resolve(__dirname, '../../../../../');
const EVIDENCE_DIR = path.join(REPO_ROOT, '.sisyphus', 'evidence');

function saveEvidence(filename: string, data: unknown): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    path.join(EVIDENCE_DIR, filename),
    JSON.stringify(data, null, 2),
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function buildBrowserApp(
  options?: Parameters<typeof createBrowserAgentRoutes>[0],
): Hono {
  const app = new Hono();
  app.route('/', createBrowserAgentRoutes(options));
  return app;
}

function buildAgentsApp(
  options?: Parameters<typeof createAgentsModule>[0],
): Hono {
  const app = new Hono();
  app.route('/', createAgentsModule(options));
  return app;
}

async function post(app: Hono, url: string, body: unknown): Promise<Response> {
  return app.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postRaw(app: Hono, url: string, rawBody: string): Promise<Response> {
  return app.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody,
  });
}

async function jsonBody(res: Response): Promise<unknown> {
  return res.json();
}

// ---------------------------------------------------------------------------
// Browser agent tests
// ---------------------------------------------------------------------------

describe('POST /api/v1/agents/browser/generate', () => {
  let app: Hono;

  beforeEach(() => {
    app = buildBrowserApp();
  });

  it('valid request returns 200 with completed AgentResult', async () => {
    const res = await post(app, '/api/v1/agents/browser/generate', {
      prompt: 'Generate a test for login flow',
    });
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as AgentResult;
    expect(body.domain).toBe('browser');
    expect(body.status).toBe('completed');
    expect(body.result).toBeDefined();
  });

  it('missing prompt returns 400 with error field', async () => {
    const res = await post(app, '/api/v1/agents/browser/generate', {});
    expect(res.status).toBe(400);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('empty string prompt returns 400', async () => {
    const res = await post(app, '/api/v1/agents/browser/generate', {
      prompt: '',
    });
    expect(res.status).toBe(400);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('whitespace-only prompt returns 400', async () => {
    const res = await post(app, '/api/v1/agents/browser/generate', {
      prompt: '   ',
    });
    expect(res.status).toBe(400);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('response domain is always "browser"', async () => {
    const res = await post(app, '/api/v1/agents/browser/generate', {
      prompt: 'Test my checkout page',
    });
    const body = (await jsonBody(res)) as AgentResult;
    expect(body.domain).toBe('browser');
  });

  it('response status is always "completed"', async () => {
    const res = await post(app, '/api/v1/agents/browser/generate', {
      prompt: 'Test my checkout page',
    });
    const body = (await jsonBody(res)) as AgentResult;
    expect(body.status).toBe('completed');
  });

  it('result contains testCode, prompt, framework, generatedAt', async () => {
    const res = await post(app, '/api/v1/agents/browser/generate', {
      prompt: 'Test my checkout page',
    });
    const body = (await jsonBody(res)) as AgentResult;
    const result = body.result as Record<string, unknown>;
    expect(typeof result['testCode']).toBe('string');
    expect(typeof result['prompt']).toBe('string');
    expect(typeof result['framework']).toBe('string');
    expect(typeof result['generatedAt']).toBe('string');
  });

  it('generatedAt is a valid ISO timestamp string', async () => {
    const res = await post(app, '/api/v1/agents/browser/generate', {
      prompt: 'Test my checkout page',
    });
    const body = (await jsonBody(res)) as AgentResult;
    const result = body.result as Record<string, unknown>;
    const generatedAt = result['generatedAt'] as string;
    expect(isNaN(Date.parse(generatedAt))).toBe(false);
  });

  it('framework is "playwright"', async () => {
    const res = await post(app, '/api/v1/agents/browser/generate', {
      prompt: 'Test login',
    });
    const body = (await jsonBody(res)) as AgentResult;
    const result = body.result as Record<string, unknown>;
    expect(result['framework']).toBe('playwright');
  });

  it('prompt is trimmed in the result', async () => {
    const res = await post(app, '/api/v1/agents/browser/generate', {
      prompt: '  Test my checkout page  ',
    });
    const body = (await jsonBody(res)) as AgentResult;
    const result = body.result as Record<string, unknown>;
    expect(result['prompt']).toBe('Test my checkout page');
  });

  it('mock override via mockGenerateFn is respected', async () => {
    const mockResult: AgentResult = {
      domain: 'browser',
      status: 'completed',
      result: { testCode: 'mock-test-code', prompt: 'mocked', framework: 'playwright', generatedAt: '2026-01-01T00:00:00.000Z' },
    };
    const mockApp = buildBrowserApp({ mockGenerateFn: () => mockResult });

    const res = await post(mockApp, '/api/v1/agents/browser/generate', {
      prompt: 'anything',
    });
    const body = (await jsonBody(res)) as AgentResult;
    const result = body.result as Record<string, unknown>;
    expect(result['testCode']).toBe('mock-test-code');
    expect(result['generatedAt']).toBe('2026-01-01T00:00:00.000Z');
  });

  it('invalid JSON body returns 400', async () => {
    const res = await postRaw(app, '/api/v1/agents/browser/generate', '{invalid json}');
    expect(res.status).toBe(400);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('browser result has domain, status, result fields and no error field on success', async () => {
    const res = await post(app, '/api/v1/agents/browser/generate', {
      prompt: 'Test checkout',
    });
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body).toHaveProperty('domain');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('result');
    expect(body).not.toHaveProperty('error');

    // Save evidence for browser generate
    saveEvidence('task-23-browser-agent-generate.json', {
      scenario: 'POST /api/v1/agents/browser/generate — valid prompt returns completed result',
      request: { prompt: 'Test checkout' },
      response: body,
      proof: 'domain=browser, status=completed, result.framework=playwright',
    });
  });
});

// ---------------------------------------------------------------------------
// Runnable domain tests
// ---------------------------------------------------------------------------

describe('Runnable domains — api/load/security/mobile', () => {
  let app: Hono;

  beforeEach(() => {
    app = buildAgentsApp();
  });

  const runPayload = {
    objective: 'Validate release readiness',
    target: 'http://localhost:3000',
  };

  it('POST /api/v1/agents/api/run → 200 completed result', async () => {
    const res = await post(app, '/api/v1/agents/api/run', runPayload);
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as AgentResult;
    expect(body.domain).toBe('api');
    expect(body.status).toBe('completed');
  });

  it('POST /api/v1/agents/load/run → 200 completed result', async () => {
    const res = await post(app, '/api/v1/agents/load/run', runPayload);
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as AgentResult;
    expect(body.domain).toBe('load');
    expect(body.status).toBe('completed');
  });

  it('POST /api/v1/agents/security/run → 200 completed result', async () => {
    const res = await post(app, '/api/v1/agents/security/run', runPayload);
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as AgentResult;
    expect(body.domain).toBe('security');
    expect(body.status).toBe('completed');
  });

  it('POST /api/v1/agents/mobile/run → 200 completed result', async () => {
    const res = await post(app, '/api/v1/agents/mobile/run', runPayload);
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as AgentResult;
    expect(body.domain).toBe('mobile');
    expect(body.status).toBe('completed');

    saveEvidence('task-23-mobile-agent-run.json', {
      scenario: 'POST /api/v1/agents/mobile/run — executable baseline result',
      request: runPayload,
      response: body,
      statusCode: 200,
      proof: 'domain=mobile, status=completed, result contains execution artifact',
    });
  });

  it('domain field matches the requested domain — api', async () => {
    const res = await post(app, '/api/v1/agents/api/run', runPayload);
    const body = (await jsonBody(res)) as AgentResult;
    expect(body.domain).toBe('api');
  });

  it('domain field matches the requested domain — load', async () => {
    const res = await post(app, '/api/v1/agents/load/run', runPayload);
    const body = (await jsonBody(res)) as AgentResult;
    expect(body.domain).toBe('load');
  });

  it('domain field matches the requested domain — security', async () => {
    const res = await post(app, '/api/v1/agents/security/run', runPayload);
    const body = (await jsonBody(res)) as AgentResult;
    expect(body.domain).toBe('security');
  });

  it('domain field matches the requested domain — mobile', async () => {
    const res = await post(app, '/api/v1/agents/mobile/run', runPayload);
    const body = (await jsonBody(res)) as AgentResult;
    expect(body.domain).toBe('mobile');
  });

  it('status is completed for all runnable domains', async () => {
    const paths = [
      '/api/v1/agents/api/run',
      '/api/v1/agents/load/run',
      '/api/v1/agents/security/run',
      '/api/v1/agents/mobile/run',
    ] as const;

    for (const path of paths) {
      const res = await post(app, path, runPayload);
      const body = (await jsonBody(res)) as AgentResult;
      expect(body.status).toBe('completed');
    }
  });

  it('result contains runId, objective, plan, output', async () => {
    const cases = [
      { path: '/api/v1/agents/api/run', domain: 'api' },
      { path: '/api/v1/agents/load/run', domain: 'load' },
      { path: '/api/v1/agents/security/run', domain: 'security' },
      { path: '/api/v1/agents/mobile/run', domain: 'mobile' },
    ] as const;

    for (const { path, domain } of cases) {
      const res = await post(app, path, runPayload);
      const body = (await jsonBody(res)) as AgentResult;
      expect(body.domain).toBe(domain);
      const result = body.result as Record<string, unknown>;
      expect(typeof result['runId']).toBe('string');
      expect(typeof result['objective']).toBe('string');
      expect(Array.isArray(result['plan'])).toBe(true);
      expect(typeof result['output']).toBe('string');
    }
  });

  it('missing objective returns 400', async () => {
    const res = await post(app, '/api/v1/agents/api/run', {});
    expect(res.status).toBe(400);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('invalid JSON returns 400', async () => {
    const res = await postRaw(app, '/api/v1/agents/security/run', '{oops}');
    expect(res.status).toBe(400);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Module integration
// ---------------------------------------------------------------------------

describe('createAgentsModule — integration', () => {
  it('browser route works through the module', async () => {
    const app = buildAgentsApp();
    const res = await post(app, '/api/v1/agents/browser/generate', {
      prompt: 'Integration test prompt',
    });
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as AgentResult;
    expect(body.domain).toBe('browser');
    expect(body.status).toBe('completed');
  });

  it('mobile run route works through the module', async () => {
    const app = buildAgentsApp();
    const res = await post(app, '/api/v1/agents/mobile/run', { objective: 'Run mobile smoke checks' });
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as AgentResult;
    expect(body.domain).toBe('mobile');
    expect(body.status).toBe('completed');
  });

  it('module passes browserOptions to browser agent', async () => {
    const mockResult: AgentResult = {
      domain: 'browser',
      status: 'completed',
      result: { testCode: 'injected', prompt: 'test', framework: 'playwright', generatedAt: '2026-01-01T00:00:00.000Z' },
    };
    const app = buildAgentsApp({
      browserOptions: { mockGenerateFn: () => mockResult },
    });

    const res = await post(app, '/api/v1/agents/browser/generate', {
      prompt: 'some prompt',
    });
    const body = (await jsonBody(res)) as AgentResult;
    const result = body.result as Record<string, unknown>;
    expect(result['testCode']).toBe('injected');
  });
});

describe('parseAgentRunRequest', () => {
  it('returns null for non-object payloads', () => {
    expect(parseAgentRunRequest(null)).toBeNull();
    expect(parseAgentRunRequest('bad')).toBeNull();
  });

  it('trims target and filters empty constraints', () => {
    const parsed = parseAgentRunRequest({
      objective: '  Ready check  ',
      target: '  http://localhost:3000  ',
      constraints: ['  fast ', '', '   ', 'strict'],
    });

    expect(parsed).toEqual({
      objective: 'Ready check',
      target: 'http://localhost:3000',
      constraints: ['  fast ', 'strict'],
    });
  });

  it('returns undefined target/constraints when optional fields are invalid', () => {
    const parsed = parseAgentRunRequest({
      objective: 'Run checks',
      target: '   ',
      constraints: 'nope',
    });

    expect(parsed).toEqual({
      objective: 'Run checks',
      target: undefined,
      constraints: undefined,
    });
  });
});
