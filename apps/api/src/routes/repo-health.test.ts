import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import {
  DiffCoverageStatusSchema,
  HealthFindingsPageSchema,
  HealthHistorySchema,
  HealthUploadResultSchema,
  PortfolioComponentsPageSchema,
  PortfolioSchema,
  ProjectHealthSchema,
  SbomComponentsPageSchema,
  SupplyChainPolicyRecordSchema,
} from '@automate/shared-contracts';
import { createErrorBoundary } from '../errors/boundary.js';
import { syntheticReporterSecret } from '../test-support/synthetic-credentials.js';
import { createRepoHealthRoutes, type RepoHealthRouteOptions } from './repo-health.js';
import { eq } from 'drizzle-orm';
import type { ConnectorRequest } from '@automate/connectors-sdk';

const here = path.dirname(fileURLToPath(import.meta.url));
const drizzleDirectory = path.resolve(here, '../../../../packages/db/drizzle');
const fixtures = path.resolve(here, '../../../../packages/reporter/src/adapters/fixtures/health');
const SECRET = syntheticReporterSecret();

function migrationSql(): string {
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  return journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) =>
      readFileSync(path.join(drizzleDirectory, `${entry.tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .join(';\n'),
    )
    .join(';\n');
}

const clients: PGlite[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function harness(
  options: { secret?: string; require?: boolean; extra?: Partial<RepoHealthRouteOptions> } = {
    secret: SECRET,
  },
) {
  const client = new PGlite();
  clients.push(client);
  await client.exec(migrationSql());
  const db = drizzle(client, { schema });
  await db
    .insert(schema.workspaces)
    .values({ id: 'ws-1', name: 'ws-1', configPath: '.', createdAt: new Date() });
  const [project] = await db
    .insert(schema.projects)
    .values({ workspaceId: 'ws-1', name: 'Service', slug: 'service' })
    .returning({ id: schema.projects.id });
  const { onError } = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    requestId: () => 'NO_REQUEST',
  });
  const app = new Hono().onError(onError).route(
    '/',
    createRepoHealthRoutes({
      db: db as never,
      workspaceId: 'ws-1',
      reporterSecret: options.secret,
      requireReporterSecret: options.require ?? false,
      ...options.extra,
    }),
  );
  return { app, db, projectId: (project as { id: string }).id };
}

const upload = (
  app: Hono,
  projectId: string,
  query: string,
  body: string | Uint8Array,
  token: string | null = SECRET,
) =>
  app.request(`/api/v1/projects/${projectId}/health/reports?${query}`, {
    method: 'POST',
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    body,
  });

const trivy = () => readFileSync(path.join(fixtures, 'trivy.sarif'));

describe('POST /api/v1/projects/:id/health/reports', () => {
  it('refuses no credential with 401 and a wrong one with 403, and accepts the right one', async () => {
    const { app, projectId } = await harness();
    expect((await upload(app, projectId, 'format=sarif', trivy(), null)).status).toBe(401);
    expect((await upload(app, projectId, 'format=sarif', trivy(), 'wrong')).status).toBe(403);
    const accepted = await upload(
      app,
      projectId,
      'format=sarif&branch=main&commit=abc1234',
      trivy(),
    );
    expect(accepted.status).toBe(201);
    const body = HealthUploadResultSchema.parse(await accepted.json());
    expect(body.findings.new).toBe(3);
  });

  it('refuses uploads with 503 when a secret is required and none is configured', async () => {
    const { app, projectId } = await harness({ require: true });
    expect((await upload(app, projectId, 'format=sarif', trivy(), null)).status).toBe(503);
  });

  it('refuses an unknown format, an empty body, a malformed report and an unknown project', async () => {
    const { app, projectId } = await harness();
    expect((await upload(app, projectId, 'format=pdf', trivy())).status).toBe(400);
    expect((await upload(app, projectId, 'format=sarif&commit=not-a-sha', trivy())).status).toBe(
      400,
    );
    expect((await upload(app, projectId, 'format=sarif', '')).status).toBe(400);
    expect((await upload(app, projectId, 'format=sarif', '{"runs":1}')).status).toBe(400);
    expect(
      (await upload(app, '00000000-0000-4000-8000-000000000000', 'format=sarif', trivy())).status,
    ).toBe(404);
  });
});

describe('the health reads', () => {
  it('serve the grade, the findings, the history and the portfolio in their contracts', async () => {
    const { app, projectId } = await harness();
    await upload(app, projectId, 'format=sarif', trivy());

    const health = ProjectHealthSchema.parse(
      await (await app.request(`/api/v1/projects/${projectId}/health`)).json(),
    );
    expect(health.reports.map((report) => report.toolKey)).toEqual(['sarif:trivy']);

    const findings = await app.request(
      `/api/v1/projects/${projectId}/health/findings?severity=critical&limit=10`,
    );
    expect(HealthFindingsPageSchema.parse(await findings.json()).total).toBe(1);
    expect(
      (await app.request(`/api/v1/projects/${projectId}/health/findings?limit=999`)).status,
    ).toBe(400);

    const history = await app.request(`/api/v1/projects/${projectId}/health/history?days=30`);
    expect(HealthHistorySchema.parse(await history.json()).points).toHaveLength(1);
    expect((await app.request(`/api/v1/projects/${projectId}/health/history?days=0`)).status).toBe(
      400,
    );

    const listed = PortfolioSchema.parse(await (await app.request('/api/v1/portfolio')).json());
    expect(listed.projects.map((entry) => entry.projectId)).toEqual([projectId]);
  });

  it('answers 404 for a project that is not registered', async () => {
    const { app } = await harness();
    expect((await app.request('/api/v1/projects/not-a-uuid/health')).status).toBe(404);
  });
});

describe('POST /api/v1/projects/:id/health/scan', () => {
  it('refuses to scan a project with no repository path or git URL', async () => {
    const { app, projectId } = await harness();
    const response = await app.request(`/api/v1/projects/${projectId}/health/scan`, {
      method: 'POST',
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/v1/projects/:id/health/findings/:findingId/triage', () => {
  it('records a decision and refuses one without a reason or an acceptance without an expiry', async () => {
    const { app, projectId } = await harness();
    await upload(app, projectId, 'format=sarif', trivy());
    const page = HealthFindingsPageSchema.parse(
      await (await app.request(`/api/v1/projects/${projectId}/health/findings`)).json(),
    );
    const id = page.findings[0]?.id ?? '';
    const triage = (body: unknown) =>
      app.request(`/api/v1/projects/${projectId}/health/findings/${id}/triage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await triage({ state: 'suppressed' })).status).toBe(400);
    expect((await triage({ state: 'accepted', reason: 'vendor' })).status).toBe(400);
    const accepted = await triage({
      state: 'accepted',
      reason: 'vendor',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ state: 'accepted', triageReason: 'vendor' });
  });
});

const json = (
  app: Hono,
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('the pull-request gate', () => {
  it('answers the gate for a branch, and refuses a request with no branch', async () => {
    const { app, projectId } = await harness();
    await upload(app, projectId, 'format=sarif&branch=feature', trivy());
    const gate = await app.request(`/api/v1/projects/${projectId}/health/gate?branch=feature`);
    expect(await gate.json()).toMatchObject({
      branch: 'feature',
      verdict: 'failed',
      newFindings: { critical: 1 },
    });
    expect((await app.request(`/api/v1/projects/${projectId}/health/gate`)).status).toBe(400);
  });

  it('reports to GitHub with the project token, needs the upload credential, and returns the verdict', async () => {
    const requests: ConnectorRequest[] = [];
    const { app, db, projectId } = await harness({
      secret: SECRET,
      extra: {
        detailsUrl: (id) => `https://automate.test/dashboard/repo/${id}`,
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
    });
    await db
      .update(schema.projects)
      .set({ repositoryUrl: 'https://github.com/example/service.git' })
      .where(eq(schema.projects.id, projectId));
    await upload(app, projectId, 'format=sarif&branch=feature', trivy());
    const path = `/api/v1/projects/${projectId}/health/gate/report`;
    const body = { branch: 'feature', commit: 'abc1234', pullRequest: 12 };
    expect((await json(app, 'POST', path, body)).status).toBe(401);
    expect(
      (await json(app, 'POST', path, { branch: 'feature' }, { authorization: `Bearer ${SECRET}` }))
        .status,
    ).toBe(400);
    const response = await json(app, 'POST', path, body, { authorization: `Bearer ${SECRET}` });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      verdict: 'failed',
      github: { status: true, comment: 'created' },
    });
    expect(requests.map((request) => request.operation)).toEqual([
      'createCommitStatus',
      'listIssueComments',
      'createIssueComment',
    ]);
    expect(requests[0]?.input).toMatchObject({
      owner: 'example',
      repo: 'service',
      sha: 'abc1234',
      target_url: `https://automate.test/dashboard/repo/${projectId}`,
    });
  });

  it('returns the verdict with no GitHub report for a repository that is not on github.com', async () => {
    const { app, projectId } = await harness();
    const response = await json(
      app,
      'POST',
      `/api/v1/projects/${projectId}/health/gate/report`,
      { branch: 'main', commit: 'abc1234' },
      { authorization: `Bearer ${SECRET}` },
    );
    expect(await response.json()).toMatchObject({ verdict: 'passed', github: null });
  });
});

describe('CODEOWNERS, alerts and the schedule', () => {
  it('accepts a CODEOWNERS upload with the upload credential only', async () => {
    const { app, projectId } = await harness();
    const path = `/api/v1/projects/${projectId}/health/codeowners`;
    expect((await app.request(path, { method: 'PUT', body: '* @org/all' })).status).toBe(401);
    const accepted = await app.request(path, {
      method: 'PUT',
      headers: { authorization: `Bearer ${SECRET}` },
      body: '* @org/all',
    });
    expect(await accepted.json()).toEqual({ rules: 1, assigned: 0 });
    expect(
      await (await app.request(`/api/v1/projects/${projectId}/health/settings`)).json(),
    ).toMatchObject({ codeowners: true });
  });

  it('refuses a webhook to a private address, and stores a Slack channel', async () => {
    const { app, projectId } = await harness();
    const path = `/api/v1/projects/${projectId}/health/alerts`;
    expect((await json(app, 'PUT', path, { webhookUrl: 'https://169.254.169.254/x' })).status).toBe(
      400,
    );
    expect((await json(app, 'PUT', path, { slackChannel: 'bad channel!' })).status).toBe(400);
    const stored = await json(app, 'PUT', path, {
      slackChannel: '#quality',
      webhookUrl: 'https://hooks.example.test/a',
    });
    expect(await stored.json()).toEqual({
      alerts: { slackChannel: '#quality', webhookUrl: 'https://hooks.example.test/a' },
    });
  });

  it('refuses an unknown cadence, and a schedule for a project with nowhere to scan', async () => {
    const { app, projectId } = await harness();
    const path = `/api/v1/projects/${projectId}/health/schedule`;
    expect((await json(app, 'PUT', path, { cadence: 'hourly' })).status).toBe(400);
    expect((await json(app, 'PUT', path, { cadence: 'daily' })).status).toBe(400);
    expect(await (await json(app, 'PUT', path, { cadence: null })).json()).toEqual({
      cadence: null,
      scanners: [],
    });
  });
});

// ─── Waves 1 and 2: the evidence formats, supply chain and diff coverage ─────

const doc = (value: unknown) => JSON.stringify(value);

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

const SPDX = doc({
  spdxVersion: 'SPDX-2.3',
  packages: [{ SPDXID: 'SPDXRef-a', name: 'a', versionInfo: '1.0.0', licenseConcluded: 'MIT' }],
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

const PROVENANCE = doc({
  _type: 'https://in-toto.io/Statement/v1',
  subject: [{ name: 'app', digest: { sha256: 'a'.repeat(64) } }],
  predicateType: 'https://slsa.dev/provenance/v1',
  predicate: { runDetails: { builder: { id: 'https://builder.example.test' } } },
});

const STRYKER = doc({
  framework: { name: 'StrykerJS', version: '8.0.0' },
  files: {
    'src/a.ts': {
      mutants: [
        { status: 'Killed' },
        { status: 'Killed' },
        { status: 'Killed' },
        {
          status: 'Survived',
          mutatorName: 'BooleanLiteral',
          location: { start: { line: 3, column: 1 } },
        },
      ],
    },
  },
});

const AXE = doc([
  {
    url: 'https://app.example.test/login',
    testEngine: { name: 'axe-core', version: '4.9.0' },
    violations: [
      {
        id: 'image-alt',
        impact: 'critical',
        help: 'Images must have alternate text',
        nodes: [{ target: ['img.logo'] }],
      },
    ],
    passes: [{ id: 'label' }, { id: 'list' }, { id: 'region' }],
  },
]);

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

const SKILLSPECTOR = doc({
  risk_assessment: { recommendation: 'REVIEW', score: 20 },
  issues: [
    {
      id: 'MP3',
      severity: 'HIGH',
      finding: 'ignore previous instructions',
      match_fingerprint: 'f'.repeat(16),
      location: { file: 'skills/x/SKILL.md', start_line: 3 },
    },
  ],
});

const dimensionOf = (body: unknown, dimension: string) =>
  HealthUploadResultSchema.parse(body).grade.dimensions.find(
    (entry) => entry.dimension === dimension,
  );

describe('the evidence formats through the upload door', () => {
  it.each([
    ['cyclonedx-json', CYCLONEDX, 'dependencies', { new: 1 }],
    ['spdx-json', SPDX, null, { new: 0 }],
    ['vex', VEX, null, { new: 0 }],
    ['slsa-provenance', PROVENANCE, 'supply-chain', { new: 0 }],
    ['stryker-mutation', STRYKER, 'test-effectiveness', { new: 1 }],
    ['axe-json', AXE, 'accessibility', { new: 1 }],
    ['skillspector-json', SKILLSPECTOR, 'ai-governance', { new: 1 }],
  ] as const)(
    'accepts %s and returns the upload contract',
    async (format, body, dimension, findings) => {
      const { app, projectId } = await harness();
      const response = await upload(app, projectId, `format=${format}&commit=abc1234`, body);
      expect(response.status).toBe(201);
      const parsed = HealthUploadResultSchema.parse(await response.json());
      expect(parsed.toolKey).toBe(format);
      expect(parsed.findings).toMatchObject(findings);
      if (dimension !== null) expect(dimensionOf(parsed, dimension)?.measured).toBe(true);
    },
  );

  it('reads the metrics each format carries', async () => {
    const { app, projectId } = await harness();
    const stryker = await (await upload(app, projectId, 'format=stryker-mutation', STRYKER)).json();
    expect(dimensionOf(stryker, 'test-effectiveness')?.summary.join(' ')).toContain(
      'Mutation score 75.0%',
    );
    const axe = await (await upload(app, projectId, 'format=axe-json', AXE)).json();
    expect(dimensionOf(axe, 'accessibility')?.summary.join(' ')).toContain('3 of 4 axe rules');
    const slsa = await (await upload(app, projectId, 'format=slsa-provenance', PROVENANCE)).json();
    expect(dimensionOf(slsa, 'supply-chain')?.summary.join(' ')).toContain('SLSA L1');
  });

  it('accepts a git diff for a commit, and refuses one without a commit', async () => {
    const { app, projectId } = await harness();
    expect((await upload(app, projectId, 'format=git-diff', DIFF)).status).toBe(400);
    const accepted = await upload(app, projectId, 'format=git-diff&commit=abc1234', DIFF);
    expect(accepted.status).toBe(201);
    expect(HealthUploadResultSchema.parse(await accepted.json()).toolKey).toBe('git-diff');
  });

  it.each([
    ['cyclonedx-json', '{}'],
    ['spdx-json', '{}'],
    ['vex', '{"hello":1}'],
    ['slsa-provenance', '{}'],
    ['stryker-mutation', '{"files":3}'],
    ['axe-json', '[]'],
    ['git-diff', 'not a diff at all'],
    ['skillspector-json', '{"risk_assessment":{}}'],
  ] as const)('refuses a malformed %s with 400 INVALID_REQUEST_BODY', async (format, body) => {
    const { app, projectId } = await harness();
    const response = await upload(app, projectId, `format=${format}&commit=abc1234`, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_REQUEST_BODY' } });
  });

  it('refuses a digest that is not sha256:<hex>, and needs the upload credential for every format', async () => {
    const { app, projectId } = await harness();
    expect(
      (await upload(app, projectId, 'format=slsa-provenance&digest=md5:abc', PROVENANCE)).status,
    ).toBe(400);
    expect((await upload(app, projectId, 'format=vex', VEX, null)).status).toBe(401);
  });
});

/** An enforced resolver with one token per role, so a test can show a guard refusing. */
function rolesHarness() {
  const tokens: Record<string, 'viewer' | 'operator' | 'admin'> = {
    'viewer-credential': 'viewer',
    'operator-credential': 'operator',
    'admin-credential': 'admin',
  };
  return harness({
    secret: SECRET,
    extra: {
      access: {
        mode: 'enforced',
        authenticateToken: async (token) =>
          tokens[token] === undefined
            ? null
            : { actor: `token:${token}`, role: tokens[token], uploaderFor: null },
        hasSession: async () => false,
      },
    },
  });
}

const as = (role: string) => ({ authorization: `Bearer ${role}-credential` });

describe('the supply-chain policy routes', () => {
  it('lets a viewer read, only an admin write, validates the body, and audits the write', async () => {
    const { app, db, projectId } = await rolesHarness();
    const path = `/api/v1/projects/${projectId}/health/supply-chain-policy`;
    const read = await app.request(path, { headers: as('viewer') });
    expect(read.status).toBe(200);
    expect(SupplyChainPolicyRecordSchema.parse(await read.json()).policy).toBeNull();

    const body = { licences: { deny: ['GPL-3.0-only'] } };
    expect((await app.request(path, { method: 'PUT', body: doc(body) })).status).toBe(401);
    expect((await json(app, 'PUT', path, body, as('operator'))).status).toBe(403);
    expect((await json(app, 'PUT', path, { licences: { deny: 'GPL' } }, as('admin'))).status).toBe(
      400,
    );
    const saved = await json(app, 'PUT', path, body, as('admin'));
    expect(saved.status).toBe(200);
    expect(SupplyChainPolicyRecordSchema.parse(await saved.json())).toMatchObject({
      policy: { licences: { deny: ['GPL-3.0-only'], failOnUnknown: true } },
      updatedBy: 'token:admin-credential',
    });
    const audited = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, 'health.supply-chain-policy.set'));
    expect(audited).toHaveLength(1);
  });
});

describe('the inventory reads', () => {
  it('pages the components of a project and searches the portfolio by purl prefix', async () => {
    const { app, projectId } = await harness();
    await upload(app, projectId, 'format=cyclonedx-json', CYCLONEDX);
    const page = await app.request(`/api/v1/projects/${projectId}/health/components?limit=10`);
    expect(SbomComponentsPageSchema.parse(await page.json())).toMatchObject({
      total: 1,
      components: [{ purl: 'pkg:npm/lodash@4.17.20', licences: ['MIT'] }],
    });
    expect(
      (await app.request(`/api/v1/projects/${projectId}/health/components?limit=0`)).status,
    ).toBe(400);
    const search = await app.request('/api/v1/portfolio/components?purl=pkg:npm/lodash');
    expect(PortfolioComponentsPageSchema.parse(await search.json()).matches).toMatchObject([
      { projectId, version: '4.17.20', branch: 'main' },
    ]);
    expect((await app.request('/api/v1/portfolio/components?purl=lodash')).status).toBe(400);
    expect((await app.request('/api/v1/portfolio/components')).status).toBe(400);
  });
});

describe('diff coverage through the routes', () => {
  it('computes in either order, serves the status, and puts it in the gate comment', async () => {
    const requests: ConnectorRequest[] = [];
    const { app, db, projectId } = await harness({
      secret: SECRET,
      extra: {
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
    });
    await db
      .update(schema.projects)
      .set({
        repositoryUrl: 'https://github.com/example/service.git',
        profile: { health: { gate: { minDiffCoverage: 80 } } },
      })
      .where(eq(schema.projects.id, projectId));
    const status = async (commit: string) => {
      const response = await app.request(
        `/api/v1/projects/${projectId}/health/diff-coverage?commit=${commit}`,
      );
      return DiffCoverageStatusSchema.parse(await response.json());
    };

    await upload(app, projectId, 'format=git-diff&branch=feature&commit=abc1234', DIFF);
    expect((await status('abc1234')).state).toBe('waiting-for-coverage');
    await upload(app, projectId, 'format=lcov&branch=feature&commit=abc1234', LCOV);
    const first = await status('abc1234');
    expect(first).toMatchObject({
      state: 'computed',
      result: { covered: 1, executable: 3, uncovered: [{ path: 'src/a.ts', lines: [3, 4] }] },
    });

    await upload(app, projectId, 'format=lcov&branch=feature&commit=def5678', LCOV);
    expect((await status('def5678')).state).toBe('waiting-for-diff');
    await upload(app, projectId, 'format=git-diff&branch=feature&commit=def5678', DIFF);
    // The other order computes the same answer, not merely an answer.
    const second = await status('def5678');
    expect(second.state).toBe('computed');
    const measured = (value: typeof first) => ({
      covered: value.result?.covered,
      executable: value.result?.executable,
      ratio: value.result?.ratio,
      uncovered: value.result?.uncovered,
      unmeasuredFiles: value.result?.unmeasuredFiles,
    });
    expect(measured(second)).toEqual(measured(first));
    expect(
      (await app.request(`/api/v1/projects/${projectId}/health/diff-coverage?commit=nope`)).status,
    ).toBe(400);

    const gate = await app.request(
      `/api/v1/projects/${projectId}/health/gate?branch=feature&commit=abc1234`,
    );
    expect(await gate.json()).toMatchObject({
      verdict: 'failed',
      diffCoverage: { covered: 1, executable: 3 },
    });
    const reported = await json(
      app,
      'POST',
      `/api/v1/projects/${projectId}/health/gate/report`,
      { branch: 'feature', commit: 'abc1234', pullRequest: 7 },
      { authorization: `Bearer ${SECRET}` },
    );
    expect(await reported.json()).toMatchObject({ verdict: 'failed' });
    const comment = requests.find((request) => request.operation === 'createIssueComment');
    expect(String((comment?.input as { body: string }).body)).toContain(
      '**Diff coverage:** 33.3% — 1 of 3 changed executable lines ran. Uncovered: `src/a.ts:3-4`.',
    );
  });
});
