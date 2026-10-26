import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as schema from '@automate/db';
import type { ConnectorRequest } from '@automate/connectors-sdk';
import { literalView } from '@automate/projects';
import { AGENT_SIGNATURES } from '@automate/reporting';
import {
  AgentRuntimeReportSchema,
  DeliveryReportSchema,
  DiffCoverageStatusSchema,
  ProjectHealthSchema,
} from '@automate/shared-contracts';
import { createErrorBoundary } from '../errors/boundary.js';
import type { CallerResolver } from '../http/roles.js';
import type { Caller } from '../services/access-service.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { agentProject, evalRun, otlpExport } from '../test-support/agent-fixtures.js';
import { syntheticReporterSecret } from '../test-support/synthetic-credentials.js';
import { createProjectsRoutes } from './projects.js';

/**
 * One end-to-end flow per wave, through `createProjectsRoutes` — the composition `index.ts`
 * mounts, so the gate reads delivery, evals, AI governance and runtime through the hooks the
 * product wires rather than ones a test wired by hand — over a migrated database.
 *
 * The composition passes no clock, so the services read the real one. Only `Date` is frozen
 * (PGlite keeps its real timers): every timestamp below is relative to NOW, and none of these
 * tests can start failing because the calendar moved.
 */

const NOW = new Date('2026-10-26T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const SECRET = syntheticReporterSecret();

const closers: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function harness(health: Record<string, unknown> = {}) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const projectId = await agentProject(db, health, {
    name: 'Service',
    repositoryUrl: 'https://github.com/octo/service',
  });
  const tokens: Record<string, Caller> = {
    amt_viewer: { actor: 'token:viewer', role: 'viewer', uploaderFor: null },
  };
  const access: CallerResolver = {
    mode: 'enforced',
    authenticateToken: async (token) => tokens[token] ?? null,
    hasSession: async () => false,
  };
  const logged: unknown[] = [];
  const { onError } = createErrorBoundary({
    log: (...entry: unknown[]) => void logged.push(entry),
    reportError: (error: unknown) => void logged.push(error),
    requestId: () => 'NO_REQUEST',
  });
  const requests: ConnectorRequest[] = [];
  const app = new Hono().onError(onError).route(
    '/',
    createProjectsRoutes({
      db: db as never,
      workspaceId: 'ws-1',
      viewFor: () => literalView({}),
      startRun: () => Promise.reject(new Error('no run is started by these flows')),
      access,
      health: {
        reporterSecret: SECRET,
        requireReporterSecret: true,
        github: {
          tokenFor: async () => 'synthetic-github-token',
          adapter: {
            manifest: { name: 'github', version: '1', operations: {} },
            execute: async (request) => {
              requests.push(request);
              return { status: 'ok', data: [], attempts: 1 };
            },
          },
        },
      },
    }),
  );
  const send = (method: string, path: string, token: string | null, body?: string, type?: string) =>
    app.request(path, {
      method,
      headers: {
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        ...(type === undefined ? {} : { 'content-type': type }),
      },
      ...(body === undefined ? {} : { body }),
    });
  const base = `/api/v1/projects/${projectId}`;
  const upload = async (query: string, body: string) => {
    const response = await send('POST', `${base}/health/reports?${query}`, SECRET, body);
    expect(response.status, `${query}: ${JSON.stringify(logged, errorFields)}`).toBe(201);
  };
  const gateReport = async (branch: string, commit: string, pullRequest?: number) => {
    const response = await send(
      'POST',
      `${base}/health/gate/report`,
      SECRET,
      JSON.stringify({ branch, commit, ...(pullRequest === undefined ? {} : { pullRequest }) }),
      'application/json',
    );
    expect(response.status, JSON.stringify(logged, errorFields)).toBe(200);
    return (await response.json()) as Record<string, unknown> & { reasons: string[] };
  };
  /** The body of the last gate comment the GitHub stub was asked to post. */
  const lastComment = () => {
    const comment = requests.filter((request) => request.operation === 'createIssueComment').pop();
    return String((comment?.input as { body?: string } | undefined)?.body);
  };
  return { app, db, projectId, base, send, upload, gateReport, lastComment };
}

const doc = (value: unknown) => JSON.stringify(value);

/** An Error as JSON: its message and stack, which `JSON.stringify` would drop. */
const errorFields = (_key: string, value: unknown) =>
  value instanceof Error ? { message: value.message, stack: value.stack } : value;

const CYCLONEDX = doc({
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  metadata: { tools: { components: [{ name: 'Trivy' }] } },
  components: [
    {
      'bom-ref': 'pkg:npm/lodash@4.17.20',
      name: 'lodash',
      version: '4.17.20',
      purl: 'pkg:npm/lodash@4.17.20',
      licenses: [{ license: { id: 'MIT' } }],
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
});

const VEX = doc({
  '@context': 'https://openvex.dev/ns/v0.2.0',
  '@id': 'https://vex.example.test/1',
  statements: [
    {
      vulnerability: { name: 'CVE-2021-23337' },
      products: [{ '@id': 'pkg:npm/lodash' }],
      status: 'not_affected',
      justification: 'component_not_present',
    },
  ],
});

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,1 +1,4 @@',
  ' one',
  '+two',
  '+three',
  '+four',
  '',
].join('\n');

const LCOV = ['SF:src/a.ts', 'DA:1,1', 'DA:2,1', 'DA:3,0', 'DA:4,0', 'end_of_record', ''].join(
  '\n',
);

describe('supply chain: SBOM, then VEX, then the gate', () => {
  it('fails the gate on a new fixable critical, and clears it once a VEX says not affected', async () => {
    const { upload, gateReport, lastComment } = await harness();
    await upload('format=cyclonedx-json&branch=feature&commit=abc1234', CYCLONEDX);
    const before = await gateReport('feature', 'abc1234', 4);
    expect(before.verdict).toBe('failed');
    expect(before.reasons.join('\n')).toMatch(/critical/u);
    expect(lastComment()).toContain('gate failed');

    await upload('format=vex&branch=feature&commit=abc1234', VEX);
    const after = await gateReport('feature', 'abc1234', 4);
    expect(after).toMatchObject({ verdict: 'passed', reasons: [] });
    expect(lastComment()).toContain('gate passed');
  });
});

describe('diff coverage, in both orders', () => {
  it('computes the same result whichever of the diff and the coverage arrives first', async () => {
    const { send, base, upload } = await harness();
    const status = async (commit: string) =>
      DiffCoverageStatusSchema.parse(
        await (
          await send('GET', `${base}/health/diff-coverage?commit=${commit}`, 'amt_viewer')
        ).json(),
      );
    await upload('format=git-diff&branch=feature&commit=abc1234', DIFF);
    expect((await status('abc1234')).state).toBe('waiting-for-coverage');
    await upload('format=lcov&branch=feature&commit=abc1234', LCOV);
    await upload('format=lcov&branch=feature&commit=def5678', LCOV);
    expect((await status('def5678')).state).toBe('waiting-for-diff');
    await upload('format=git-diff&branch=feature&commit=def5678', DIFF);

    const [diffFirst, coverageFirst] = [await status('abc1234'), await status('def5678')];
    expect(diffFirst.state).toBe('computed');
    expect(coverageFirst.state).toBe('computed');
    const { computedAt: _a, ...one } = diffFirst.result ?? { computedAt: '' };
    const { computedAt: _b, ...other } = coverageFirst.result ?? { computedAt: '' };
    expect(one).toEqual(other);
    expect(one).toMatchObject({ covered: 1, executable: 3 });
  });
});

describe('delivery: push, report, gate', () => {
  it('turns pushed deployments into a DORA report and one DORA line on the gate comment', async () => {
    const { send, base, gateReport, lastComment } = await harness();
    // Eight production deployments over the last four weeks, one of them failed.
    for (let index = 0; index < 8; index += 1) {
      const response = await send(
        'POST',
        `${base}/delivery/deployments`,
        SECRET,
        doc({
          externalId: `ci-${String(index)}`,
          environment: 'production',
          status: index === 3 ? 'failure' : 'success',
          createdAt: daysAgo(1 + index * 3).toISOString(),
          sha: `${String(index)}`.padStart(7, 'a'),
        }),
        'application/json',
      );
      expect(response.status).toBe(201);
    }
    const report = DeliveryReportSchema.parse(
      await (await send('GET', `${base}/delivery?days=30`, 'amt_viewer')).json(),
    );
    expect(report.counts.deployments).toBe(8);
    expect(report.dora.score).not.toBeNull();

    await gateReport('feature', 'abc1234', 9);
    const line = lastComment()
      .split('\n')
      .filter((text) => text.startsWith('**Delivery (DORA 2024):**'));
    expect(line).toHaveLength(1);
    expect(line[0]).toContain(`${String(report.dora.score)} / 100`);
  });
});

async function seedAgentPullRequest(db: MigratedDb, projectId: string) {
  await db.insert(schema.pullRequests).values({
    workspaceId: 'ws-1',
    projectId,
    externalId: '3',
    number: 3,
    state: 'open',
    authorLogin: 'claude[bot]',
    headBranch: 'feature/3',
    baseBranch: 'main',
    title: 'Agent change',
    openedAt: daysAgo(2),
    mergedAt: null,
    mergeCommitSha: null,
    lastActivityAt: daysAgo(1),
    attribution: 'agent-authored',
    aiAgent: 'claude-code',
    attributionConfidence: 0.95,
    attributionVersion: AGENT_SIGNATURES.version,
    humanApprovalCount: 0,
    testsTouched: false,
  });
}

describe('AI-code governance in the gate report', () => {
  it('fails an agent-authored pull request the rules fail, and says so in the comment', async () => {
    const { db, projectId, gateReport, lastComment } = await harness({
      aiGovernance: { enabled: true, requireTestsTouched: true },
    });
    await seedAgentPullRequest(db, projectId);
    const body = await gateReport('feature/3', 'abc1234', 3);
    expect(body).toMatchObject({
      verdict: 'failed',
      aiGovernance: { pullRequest: 3, attribution: 'agent-authored', verdict: { verdict: 'fail' } },
    });
    expect(body.reasons.some((reason) => reason.startsWith('AI governance: '))).toBe(true);
    expect(lastComment()).toContain('Rules: failed.');
  });

  it('does not govern the same pull request when the policy leaves governance off', async () => {
    const { db, projectId, gateReport } = await harness();
    await seedAgentPullRequest(db, projectId);
    const body = await gateReport('feature/3', 'abc1234', 3);
    expect(body).toMatchObject({ verdict: 'passed', aiGovernance: null });
  });

  it('governs the named pull request on GET …/health/gate too, so both gate paths agree', async () => {
    const { db, projectId, base, send } = await harness({
      aiGovernance: { enabled: true, requireTestsTouched: true },
    });
    await seedAgentPullRequest(db, projectId);
    const named = await send(
      'GET',
      `${base}/health/gate?branch=feature/3&pullRequest=3`,
      'amt_viewer',
    );
    expect(named.status).toBe(200);
    const body = (await named.json()) as {
      verdict: string;
      reasons: string[];
      aiGovernance: unknown;
    };
    expect(body.verdict).toBe('failed');
    expect(body.reasons.some((reason) => reason.startsWith('AI governance: '))).toBe(true);
    expect(body.aiGovernance).toMatchObject({ pullRequest: 3, verdict: { verdict: 'fail' } });
    const unnamed = await send('GET', `${base}/health/gate?branch=feature/3`, 'amt_viewer');
    expect(await unnamed.json()).toMatchObject({ verdict: 'passed', aiGovernance: null });
  });
});

describe('evals: upload, then the regression gate', () => {
  const MAIN = { paris: 9, berlin: 9, rome: 9 };
  const REGRESSED = { paris: 2, berlin: 3, rome: 1 };

  it('fails the pull-request gate on a significant regression against the default branch', async () => {
    const { upload, gateReport, lastComment } = await harness({ agents: { gateOnEvals: true } });
    await upload('format=automate-eval-json&branch=main', doc(evalRun('support', MAIN)));
    await upload('format=automate-eval-json&branch=feature', doc(evalRun('support', REGRESSED)));
    const body = await gateReport('feature', 'abc1234', 5);
    expect(body.verdict).toBe('failed');
    expect(body.reasons.some((reason) => reason.startsWith('Evals (support): '))).toBe(true);
    expect(body).toMatchObject({ evals: { gateOnEvals: true, suites: [{ verdict: 'fail' }] } });
    expect(lastComment()).toContain('**Evals**');
  });

  it('passes the same gate when the branch holds steady', async () => {
    const { upload, gateReport } = await harness({ agents: { gateOnEvals: true } });
    await upload('format=automate-eval-json&branch=main', doc(evalRun('support', MAIN)));
    await upload('format=automate-eval-json&branch=feature', doc(evalRun('support', MAIN)));
    const body = await gateReport('feature', 'abc1234', 5);
    expect(body.reasons.some((reason) => reason.startsWith('Evals'))).toBe(false);
  });
});

describe('OTLP ingest, then the runtime scorecard', () => {
  it('reads the spans it took as the project runtime, and carries it on the gate report', async () => {
    const { send, base, gateReport } = await harness();
    const exported = otlpExport([
      {
        spanId: '1'.repeat(16),
        operation: 'chat',
        model: 'gpt-4o',
        inputTokens: 5,
        outputTokens: 1,
        startMs: NOW.getTime() - 60_000,
      },
      {
        traceId: 'b'.repeat(32),
        spanId: '2'.repeat(16),
        operation: 'chat',
        model: 'gpt-4o',
        inputTokens: 7,
        outputTokens: 2,
        startMs: NOW.getTime() - 30_000,
        error: true,
      },
    ]);
    // The OTLP door always requires the reporter secret; a viewer cannot write spans.
    expect(
      (
        await send(
          'POST',
          `${base}/otlp/v1/traces`,
          'amt_viewer',
          doc(exported),
          'application/json',
        )
      ).status,
    ).toBe(403);
    const ingested = await send(
      'POST',
      `${base}/otlp/v1/traces`,
      SECRET,
      doc(exported),
      'application/json',
    );
    expect(ingested.status).toBe(200);
    const runtime = AgentRuntimeReportSchema.parse(
      await (await send('GET', `${base}/agents/runtime?days=7`, 'amt_viewer')).json(),
    );
    expect(runtime.runtime.overall.current.runs).toBe(2);
    const body = await gateReport('main', 'abc1234');
    expect(body['agentRuntime']).not.toBeNull();
  });
});

describe('MCP tools/call get_health', () => {
  it('answers with exactly what the health route answers', async () => {
    const { app, send, base, projectId } = await harness();
    const upload = await send(
      'POST',
      `${base}/health/reports?format=cyclonedx-json&branch=main`,
      SECRET,
      CYCLONEDX,
    );
    expect(upload.status).toBe(201);
    const fetchApp = (input: string | URL | Request, init?: RequestInit) =>
      app.request(String(input instanceof Request ? input.url : input), init);
    const client = new Client({ name: 'flows', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://automate.test/api/v1/mcp'), {
        fetch: fetchApp as typeof fetch,
        requestInit: { headers: { authorization: 'Bearer amt_viewer' } },
      }),
    );
    closers.push(() => client.close());
    const result = await client.callTool({ name: 'get_health', arguments: { projectId } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(result.isError).not.toBe(true);
    expect(content[0]?.text).toMatch(/^Service on main: /u);
    const viaTool = ProjectHealthSchema.parse(JSON.parse(content[1]?.text ?? 'null'));
    const viaRoute = ProjectHealthSchema.parse(
      await (await send('GET', `${base}/health`, 'amt_viewer')).json(),
    );
    expect(viaTool).toEqual(viaRoute);
    expect(viaTool.reports.length).toBeGreaterThan(0);
  });
});
