import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import * as schema from '@automate/db';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  AgentQualitySnapshotSchema,
  AiCodeReportSchema,
  DeliveryReportSchema,
  HealthFindingsPageSchema,
  HealthGateResponseSchema,
  MCP_TOOL_NAMES,
  PortfolioSchema,
  ProjectHealthSchema,
  ScorecardSchema,
} from '@automate/shared-contracts';
import { createErrorBoundary } from '../errors/boundary.js';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import type { CallerResolver } from '../http/roles.js';
import { toolError } from '../mcp/server.js';
import { authenticateToken, createAccessToken, type Caller } from '../services/access-service.js';
import { ingestHealthReport } from '../services/repo-health-service.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { agentProject } from '../test-support/agent-fixtures.js';
import { createMcpRoutes, MCP_MAX_BYTES } from './mcp.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-10-26T12:00:00.000Z');
const ENDPOINT = 'http://automate.test/api/v1/mcp';

async function harness(
  extra: Record<string, unknown> = {},
  log?: (message: string, details: Record<string, unknown>) => void,
) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const projectId = await agentProject(db, {}, { name: 'Alpha' });
  const otherId = await agentProject(db, {}, { name: 'Beta' });
  const [theirs] = await db
    .insert(schema.projects)
    .values({ workspaceId: 'ws-2', name: 'Theirs', slug: 'theirs' })
    .returning({ id: schema.projects.id });
  const theirsId = (theirs as { id: string }).id;
  const stubs: Record<string, Caller> = {
    amt_uploader: { actor: 'token:uploader', role: null, uploaderFor: projectId },
    amt_pinned_viewer: { actor: 'token:pinned', role: 'viewer', uploaderFor: projectId },
  };
  const options = { db: db as never, workspaceId: 'ws-1', now: () => NOW };
  const access: CallerResolver = {
    mode: 'enforced',
    authenticateToken: async (token) => stubs[token] ?? authenticateToken(options, token),
    hasSession: async () => false,
  };
  const { onError } = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    requestId: () => 'NO_REQUEST',
  });
  const app = new Hono().onError(onError).route(
    '/',
    createMcpRoutes({
      access,
      health: { ...options, ...extra },
      history: async () => [],
      ...(log === undefined ? {} : { log }),
    }),
  );
  const viewer = (await createAccessToken(options, { name: 'editor', role: 'viewer' }, 'session'))
    .token;
  const foreign = (
    await createAccessToken(
      { ...options, workspaceId: 'ws-2' },
      { name: 'theirs', role: 'viewer' },
      'session',
    )
  ).token;
  const fetchApp = (input: string | URL | Request, init?: RequestInit) =>
    app.request(String(input instanceof Request ? input.url : input), init);
  async function connect(token: string | null) {
    const client = new Client({ name: 'test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
      fetch: fetchApp as typeof fetch,
      requestInit: token === null ? {} : { headers: { authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    closers.push(() => client.close());
    return client;
  }
  const raw = (token: string | null, init: RequestInit = {}) =>
    app.request('/api/v1/mcp', {
      method: 'POST',
      ...init,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  return { db, app, projectId, otherId, theirsId, viewer, foreign, connect, raw };
}

/** A tool's two text blocks: the summary, and the contract value as JSON. */
function answer(result: Awaited<ReturnType<Client['callTool']>>) {
  const content = result.content as Array<{ type: string; text: string }>;
  return {
    isError: result.isError === true,
    summary: content[0]?.text ?? '',
    value: content[1] === undefined ? undefined : (JSON.parse(content[1].text) as unknown),
  };
}

describe('the MCP server at /api/v1/mcp', () => {
  it('lists every tool, each read-only', async () => {
    const { connect, viewer } = await harness();
    const client = await connect(viewer);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool.description?.length).toBeGreaterThan(20);
    }
    expect(client.getServerVersion()).toMatchObject({ name: 'automate' });
  });

  it('answers every tool with its contract, parsed, beside a summary line', async () => {
    const { connect, viewer, projectId } = await harness();
    const client = await connect(viewer);
    const call = async (name: string, args: Record<string, unknown> = {}) =>
      answer(await client.callTool({ name, arguments: args }));

    const projects = await call('list_projects');
    expect(PortfolioSchema.parse(projects.value).projects.map((entry) => entry.name)).toEqual([
      'Alpha',
      'Beta',
    ]);
    expect(projects.summary).toBe('2 project(s).');

    const health = await call('get_health', { projectId });
    expect(ProjectHealthSchema.parse(health.value).projectId).toBe(projectId);
    expect(health.summary).toMatch(/^Alpha on main: incomplete/u);

    const findings = await call('list_findings', { projectId, severity: 'critical', limit: 5 });
    expect(HealthFindingsPageSchema.parse(findings.value)).toMatchObject({ total: 0, limit: 5 });

    const gate = await call('get_gate', { projectId, branch: 'main' });
    expect(HealthGateResponseSchema.parse(gate.value).verdict).toBe('passed');
    expect(gate.summary).toBe('Gate passed on main');

    const delivery = await call('get_delivery', { projectId, days: 14 });
    expect(DeliveryReportSchema.parse(delivery.value).windowDays).toBe(14);
    expect(delivery.summary).toMatch(/Software delivery \(DORA\): insufficient/u);

    const agents = await call('get_agent_quality', { projectId });
    expect(AgentQualitySnapshotSchema.parse(agents.value).evals.suites).toEqual([]);

    const ai = await call('get_ai_code', { projectId });
    expect(AiCodeReportSchema.parse(ai.value).projectId).toBe(projectId);

    const supply = await call('get_supply_chain', { projectId });
    expect(ScorecardSchema.parse(supply.value).id).toBe('supply-chain');
    const tests = await call('get_test_effectiveness', { projectId });
    expect(ScorecardSchema.parse(tests.value)).toMatchObject({ id: 'test-effectiveness' });
    // With a (here empty) run history, the flake reading is measured as too thin, not absent.
    expect(
      ScorecardSchema.parse(tests.value).metrics.find((metric) => metric.key === 'flaky-tests')
        ?.status,
    ).toBe('insufficient');
  });

  it('refuses a caller with no token, a CI uploader token, and another workspace’s token', async () => {
    const { raw, foreign } = await harness();
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect((await raw(null, { body })).status).toBe(401);
    // An uploader token sends reports; it reads nothing, here or on any read route.
    expect((await raw('amt_uploader', { body })).status).toBe(403);
    // A token minted in another workspace does not authenticate in this one.
    expect((await raw(foreign, { body })).status).toBe(401);
    expect((await raw('amt_not_a_token', { body })).status).toBe(401);
  });

  it('never reads another workspace’s project', async () => {
    const { connect, viewer, theirsId } = await harness();
    const client = await connect(viewer);
    for (const name of ['get_health', 'get_supply_chain', 'get_delivery']) {
      const result = answer(await client.callTool({ name, arguments: { projectId: theirsId } }));
      expect(result).toMatchObject({ isError: true, summary: `NOT_FOUND: No project ${theirsId}` });
    }
    const listed = answer(await client.callTool({ name: 'list_projects', arguments: {} }));
    expect(JSON.stringify(listed.value)).not.toContain('Theirs');
  });

  it('keeps a caller pinned to one project to that project', async () => {
    const { connect, projectId, otherId } = await harness();
    const client = await connect('amt_pinned_viewer');
    const own = answer(await client.callTool({ name: 'get_health', arguments: { projectId } }));
    expect(own.isError).toBe(false);
    const other = answer(
      await client.callTool({ name: 'get_health', arguments: { projectId: otherId } }),
    );
    expect(other).toMatchObject({
      isError: true,
      summary: 'FORBIDDEN: This token is pinned to another project',
    });
    const listed = answer(await client.callTool({ name: 'list_projects', arguments: {} }));
    expect(PortfolioSchema.parse(listed.value).projects.map((entry) => entry.projectId)).toEqual([
      projectId,
    ]);
  });

  it('refuses a pinned caller every project tool on another project, before any read', async () => {
    const { connect, otherId } = await harness();
    const client = await connect('amt_pinned_viewer');
    const projectTools = MCP_TOOL_NAMES.filter((name) => name !== 'list_projects');
    expect(projectTools.length).toBe(MCP_TOOL_NAMES.length - 1);
    for (const name of projectTools) {
      const args = { projectId: otherId, ...(name === 'get_gate' ? { branch: 'main' } : {}) };
      const result = answer(await client.callTool({ name, arguments: args }));
      expect(result, name).toEqual({
        isError: true,
        summary: 'FORBIDDEN: This token is pinned to another project',
        value: undefined,
      });
    }
  });

  it('summarises a measured grade, a failing gate and its reasons, and a scored card', async () => {
    const { connect, viewer, projectId, db } = await harness();
    const options = { db: db as never, workspaceId: 'ws-1', now: () => NOW };
    const ingest = (format: 'sarif' | 'jscpd' | 'cyclonedx-json', body: unknown, branch: string) =>
      ingestHealthReport(options, {
        projectId,
        format,
        bytes: new TextEncoder().encode(JSON.stringify(body)),
        branch,
        source: 'ci',
      });
    // Security and a second dimension measured: the grade is complete and has a score.
    await ingest(
      'sarif',
      { version: '2.1.0', runs: [{ tool: { driver: { name: 'gitleaks' } }, results: [] }] },
      'main',
    );
    await ingest('jscpd', { statistics: { total: { percentage: 0 } } }, 'main');
    // A fixable critical on the feature branch: new against main, so the gate fails.
    await ingest(
      'cyclonedx-json',
      {
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        components: [
          {
            'bom-ref': 'pkg:npm/lodash@4.17.20',
            name: 'lodash',
            version: '4.17.20',
            purl: 'pkg:npm/lodash@4.17.20',
          },
        ],
        vulnerabilities: [
          {
            id: 'CVE-2021-23337',
            ratings: [{ severity: 'critical' }],
            affects: [{ ref: 'pkg:npm/lodash@4.17.20' }],
            recommendation: 'Upgrade to 4.17.21',
          },
        ],
      },
      'feature',
    );
    const client = await connect(viewer);
    const call = async (name: string, args: Record<string, unknown>) =>
      answer(await client.callTool({ name, arguments: args }));

    const health = await call('get_health', { projectId, branch: 'main' });
    const grade = ProjectHealthSchema.parse(health.value).grade;
    expect(grade.score).not.toBeNull();
    expect(health.summary).toBe(
      `Alpha on main: ${String(grade.letter)} (${(grade.score ?? 0).toFixed(0)} / 100) — ${grade.limiter ?? 'no limiter'}`,
    );

    const gate = await call('get_gate', { projectId, branch: 'feature' });
    const verdict = HealthGateResponseSchema.parse(gate.value);
    expect(verdict.verdict).toBe('failed');
    expect(verdict.reasons.length).toBeGreaterThan(0);
    expect(gate.summary).toBe(`Gate failed on feature — ${verdict.reasons.join('; ')}`);

    const supply = await call('get_supply_chain', { projectId, branch: 'feature' });
    const card = ScorecardSchema.parse(supply.value);
    expect(card.score).not.toBeNull();
    expect(card.reasons.length).toBeGreaterThan(0);
    expect(supply.summary).toBe(
      `${card.title}: ${card.status}, ${(card.score ?? 0).toFixed(0)} / 100${card.cappedBy === null ? '' : `, limited by ${card.cappedBy}`} — ${card.reasons[0] ?? ''}.`,
    );
  });

  it('evaluates AI governance on get_gate when a pull request is named', async () => {
    const asked: number[] = [];
    const { connect, viewer, projectId } = await harness({
      aiGovernance: async (_projectId: string, pullRequest: number) => {
        asked.push(pullRequest);
        return {
          pullRequest,
          synced: true,
          attribution: 'agent-authored',
          agent: 'claude-code',
          confidence: 1,
          signals: [],
          unknownReason: null,
          verdict: {
            verdict: 'fail',
            reasons: ['Agent-authored change needs at least one human approval; it has none.'],
            attributionNote: null,
          },
        };
      },
    });
    const client = await connect(viewer);
    const gate = answer(
      await client.callTool({
        name: 'get_gate',
        arguments: { projectId, branch: 'main', pullRequest: 7 },
      }),
    );
    expect(asked).toEqual([7]);
    expect(HealthGateResponseSchema.parse(gate.value).reasons).toContain(
      'AI governance: Agent-authored change needs at least one human approval; it has none.',
    );
    const unnamed = answer(
      await client.callTool({ name: 'get_gate', arguments: { projectId, branch: 'main' } }),
    );
    expect(HealthGateResponseSchema.parse(unnamed.value).verdict).toBe('passed');
    expect(asked).toEqual([7]);
  });

  it('refuses arguments its schema refuses, and a body over the limit', async () => {
    const { connect, viewer, raw } = await harness();
    const client = await connect(viewer);
    const bad = await client.callTool({ name: 'get_health', arguments: { projectId: 'nope' } });
    expect(bad.isError).toBe(true);
    const huge = await raw(viewer, { body: 'x'.repeat(MCP_MAX_BYTES + 1) });
    expect(huge.status).toBe(413);
  });

  it('pushes nothing: GET answers 405 once the caller is checked', async () => {
    const { app, viewer } = await harness();
    expect((await app.request('/api/v1/mcp')).status).toBe(401);
    const response = await app.request('/api/v1/mcp', {
      headers: { authorization: `Bearer ${viewer}`, accept: 'text/event-stream' },
    });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
});

describe('a tool that fails inside', () => {
  it('logs a non-domain failure with its cause before answering INTERNAL, and a 4xx not at all', async () => {
    const logged: Array<[string, Record<string, unknown>]> = [];
    const { connect, viewer, projectId } = await harness(
      {
        deliveryReading: async () => {
          throw new Error('the delivery table is gone');
        },
      },
      (message, details) => void logged.push([message, details]),
    );
    const client = await connect(viewer);
    const failed = answer(
      await client.callTool({ name: 'get_gate', arguments: { projectId, branch: 'main' } }),
    );
    expect(failed).toMatchObject({ isError: true, summary: 'INTERNAL: internal error' });
    expect(logged).toEqual([
      [
        'an MCP tool failed',
        expect.objectContaining({ tool: 'get_gate', error: 'the delivery table is gone' }),
      ],
    ]);
    const refused = answer(
      await client.callTool({ name: 'get_health', arguments: { projectId: randomUUID() } }),
    );
    expect(refused.summary).toMatch(/^NOT_FOUND: /u);
    expect(logged).toHaveLength(1);
  });
});

describe('toolError', () => {
  it('names the DomainError code, and says nothing more about a server fault', () => {
    expect(toolError(new DomainError(ErrorCode.NOT_FOUND, 'No project x'))).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'NOT_FOUND: No project x' }],
    });
    expect(toolError(new DomainError(ErrorCode.INTERNAL, 'a table name'))).toMatchObject({
      content: [{ type: 'text', text: 'INTERNAL: internal error' }],
    });
    expect(toolError(new Error('boom'))).toMatchObject({
      content: [{ type: 'text', text: 'INTERNAL: internal error' }],
    });
  });
});
