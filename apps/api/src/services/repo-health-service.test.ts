import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@automate/db';
import { DomainError } from '../errors/domain-error.js';
import {
  branchFor,
  effectiveState,
  getHealthSettings,
  healthGate,
  healthHistory,
  ingestHealthReport,
  ingestScanArtifact,
  listFindings,
  newFindingsAgainstDefault,
  portfolio,
  projectHealth,
  setAlertSettings,
  setCodeowners,
  setHealthSchedule,
  startHealthScan,
  triageFinding,
  type HealthScanJob,
  type ReportEvent,
  type HealthScanOptions,
  type RepoHealthOptions,
} from './repo-health-service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const drizzleDirectory = path.resolve(here, '../../../../packages/db/drizzle');
const fixtures = path.resolve(here, '../../../../packages/reporter/src/adapters/fixtures/health');

/** The migration graph read from the journal, as `routes/projects.test.ts` reads it. */
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

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(fixtures, name)));
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

const clients: PGlite[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function setup(now: () => Date = () => new Date('2026-10-23T12:00:00.000Z')) {
  const client = new PGlite();
  clients.push(client);
  await client.exec(migrationSql());
  const db = drizzle(client, { schema });
  for (const id of ['ws-1', 'ws-2']) {
    await db
      .insert(schema.workspaces)
      .values({ id, name: id, configPath: '.', createdAt: new Date() })
      .onConflictDoNothing();
  }
  const [project] = await db
    .insert(schema.projects)
    .values({ workspaceId: 'ws-1', name: 'Service', slug: 'service', defaultBranch: 'main' })
    .returning({ id: schema.projects.id });
  const options: RepoHealthOptions = { db: db as never, workspaceId: 'ws-1', now };
  return { db, options, projectId: (project as { id: string }).id };
}

/** One semgrep result per rule id, so a test can add and remove findings by name. */
function semgrep(...rules: string[]) {
  return json({
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'semgrep', semanticVersion: '1.90.0' } },
        results: rules.map((rule) => ({
          ruleId: rule,
          level: 'error',
          message: { text: `${rule} found` },
          properties: { tags: ['security'] },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: `src/${rule}.ts` },
                region: { startLine: 1 },
              },
            },
          ],
        })),
      },
    ],
  });
}

const gitleaksClean = json({
  version: '2.1.0',
  runs: [{ tool: { driver: { name: 'gitleaks' } }, results: [] }],
});
/** No duplication: a second measured dimension, so the grade is complete and a letter is printed. */
const noDuplication = json({ statistics: { total: { percentage: 0 } } });

describe('ingesting reports', () => {
  it('stores a SARIF report, grades it, and names the limiter', async () => {
    const { options, projectId } = await setup();
    const result = await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: fixture('trivy.sarif'),
      source: 'ci',
      commitSha: 'abc1234',
    });
    expect(result).toMatchObject({
      branch: 'main',
      toolKey: 'sarif:trivy',
      findings: { new: 3, persisting: 0, fixed: 0 },
    });
    // Trivy measures Security and Dependencies; the fixable critical CVE trips the cap.
    expect(result.grade.incomplete).toBe(false);
    expect(
      result.grade.gates.find((gate) => gate.id === 'fixable-critical-vulnerability')?.tripped,
    ).toBe(true);
    expect(result.grade.letter === 'D' || result.grade.letter === 'F').toBe(true);
  });

  it('carries findings across reports: persisting, fixed, and back to open', async () => {
    const { options, projectId } = await setup();
    await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a', 'b'),
      source: 'ci',
    });
    const again = await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a', 'b'),
      source: 'ci',
    });
    expect(again.findings).toEqual({ new: 0, persisting: 2, fixed: 0 });
    const fewer = await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a'),
      source: 'ci',
    });
    expect(fewer.findings).toEqual({ new: 0, persisting: 1, fixed: 1 });
    expect(
      (await listFindings(options, projectId, { state: 'fixed', limit: 50, offset: 0 })).total,
    ).toBe(1);
    const back = await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a', 'b'),
      source: 'ci',
    });
    expect(back.findings).toEqual({ new: 0, persisting: 2, fixed: 0 });
    expect(
      (await listFindings(options, projectId, { state: 'open', limit: 50, offset: 0 })).total,
    ).toBe(2);
  });

  it('only a report of the same kind can fix a finding', async () => {
    const { options, projectId } = await setup();
    await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a'),
      source: 'ci',
    });
    const other = await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: gitleaksClean,
      source: 'ci',
    });
    expect(other.findings.fixed).toBe(0);
    expect(
      (await listFindings(options, projectId, { state: 'open', limit: 50, offset: 0 })).total,
    ).toBe(1);
  });

  it('measures a dimension from a metric report, and the latest of a kind wins', async () => {
    const { options, projectId } = await setup();
    await ingestHealthReport(options, {
      projectId,
      format: 'jscpd',
      bytes: json({ statistics: { total: { percentage: 20 } } }),
      source: 'ci',
    });
    await ingestHealthReport(options, {
      projectId,
      format: 'jscpd',
      bytes: fixture('jscpd-report.json'),
      source: 'ci',
    });
    const health = await projectHealth(options, projectId);
    const quality = health.grade.dimensions.find((entry) => entry.dimension === 'code-quality');
    expect(quality?.summary).toEqual(['4.2% of lines duplicated']);
    expect(health.reports).toHaveLength(1);
  });

  it('reads the Tests dimension from the QA score reading on the default branch only', async () => {
    const { options, projectId } = await setup();
    const withTests: RepoHealthOptions = {
      ...options,
      testsReading: async () => ({
        metric: {
          dimension: 'tests',
          metric: 'qa score',
          tool: { name: 'automate', version: null },
          score: 90,
          summary: 'QA score 90',
        },
        failingTests: 2,
      }),
    };
    await ingestHealthReport(withTests, {
      projectId,
      format: 'sarif',
      bytes: gitleaksClean,
      source: 'ci',
    });
    const main = await projectHealth(withTests, projectId);
    expect(main.grade.cappedBy).toBe('failing-tests');
    const feature = await projectHealth(withTests, projectId, 'feature/x');
    expect(feature.grade.dimensions.find((entry) => entry.dimension === 'tests')?.measured).toBe(
      false,
    );
  });

  it('refuses a malformed or unknown-version report as a 4xx domain error', async () => {
    const { options, projectId } = await setup();
    await expect(
      ingestHealthReport(options, {
        projectId,
        format: 'sarif',
        bytes: json({ runs: 'no' }),
        source: 'ci',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST_BODY' });
    await expect(
      ingestHealthReport(options, {
        projectId,
        format: 'scorecard',
        bytes: json({}),
        source: 'ci',
      }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      ingestHealthReport(options, {
        projectId,
        format: 'sarif',
        bytes: new Uint8Array(50 * 1024 * 1024 + 1),
        source: 'ci',
      }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });
});

describe('triage', () => {
  it('a suppressed finding stays suppressed across reports and does not count', async () => {
    const { options, projectId } = await setup();
    await ingestHealthReport(options, {
      projectId,
      format: 'jscpd',
      bytes: noDuplication,
      source: 'ci',
    });
    const first = await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a'),
      source: 'ci',
    });
    const [finding] = (await listFindings(options, projectId, { limit: 50, offset: 0 })).findings;
    const triaged = await triageFinding(
      options,
      projectId,
      finding?.id ?? '',
      { state: 'suppressed', reason: 'test fixture' },
      'operator',
    );
    expect(triaged).toMatchObject({
      state: 'suppressed',
      triageReason: 'test fixture',
      triagedBy: 'operator',
    });
    await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a'),
      source: 'ci',
    });
    expect(
      (await listFindings(options, projectId, { state: 'suppressed', limit: 50, offset: 0 })).total,
    ).toBe(1);
    const health = await projectHealth(options, projectId);
    expect(health.grade.score).toBeGreaterThan(first.grade.score ?? 0);
  });

  it('an accepted risk past its expiry counts again, and is listed as open', async () => {
    let now = new Date('2026-10-23T12:00:00.000Z');
    const { options, projectId } = await setup(() => now);
    await ingestHealthReport(options, {
      projectId,
      format: 'jscpd',
      bytes: noDuplication,
      source: 'ci',
    });
    await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a'),
      source: 'ci',
    });
    const [finding] = (await listFindings(options, projectId, { limit: 50, offset: 0 })).findings;
    await triageFinding(
      options,
      projectId,
      finding?.id ?? '',
      { state: 'accepted', reason: 'vendor fix due', expiresAt: '2026-10-30T00:00:00.000Z' },
      'operator',
    );
    const accepted = (await projectHealth(options, projectId)).grade.score;
    now = new Date('2026-11-01T00:00:00.000Z');
    expect(
      (await listFindings(options, projectId, { state: 'open', limit: 50, offset: 0 })).total,
    ).toBe(1);
    expect(
      (await listFindings(options, projectId, { state: 'accepted', limit: 50, offset: 0 })).total,
    ).toBe(0);
    expect((await projectHealth(options, projectId)).grade.score).toBeLessThan(accepted ?? 0);
  });

  it('refuses to triage a finding that does not exist or is fixed', async () => {
    const { options, projectId } = await setup();
    await expect(
      triageFinding(options, projectId, 'nope', { state: 'open' }, 'operator'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      triageFinding(
        options,
        projectId,
        '00000000-0000-4000-8000-000000000000',
        { state: 'open' },
        'operator',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('reads', () => {
  it('filters and pages findings, most severe first', async () => {
    const { options, projectId } = await setup();
    await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: fixture('trivy.sarif'),
      source: 'ci',
    });
    const page = await listFindings(options, projectId, { limit: 2, offset: 0 });
    expect(page.total).toBe(3);
    expect(page.findings.map((finding) => finding.severity)).toEqual(['critical', 'high']);
    expect(
      (
        await listFindings(options, projectId, { dimension: 'security', limit: 50, offset: 0 })
      ).findings.map((finding) => finding.ruleId),
    ).toEqual(['DS002']);
    expect(
      (await listFindings(options, projectId, { q: 'minimist', limit: 50, offset: 0 })).total,
    ).toBe(1);
    expect(
      (await listFindings(options, projectId, { q: '100%_', limit: 50, offset: 0 })).total,
    ).toBe(0);
  });

  it('draws history and the portfolio from snapshots', async () => {
    let now = new Date('2026-09-01T00:00:00.000Z');
    const { options, projectId } = await setup(() => now);
    await ingestHealthReport(options, {
      projectId,
      format: 'jscpd',
      bytes: noDuplication,
      source: 'ci',
    });
    await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a', 'b'),
      source: 'ci',
    });
    now = new Date('2026-10-23T00:00:00.000Z');
    await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: semgrep(),
      source: 'ci',
    });
    const history = await healthHistory(options, projectId, undefined, 90);
    expect(history.points).toHaveLength(3);
    expect(history.points.at(-1)?.dimensions.security).toBe(100);
    const [entry] = (await portfolio(options)).projects;
    expect(entry).toMatchObject({ projectId, letter: 'A+', score: 100, incomplete: false });
    expect(entry?.trend).toBeGreaterThan(0);
  });

  it('lists open branch findings the default branch does not have', async () => {
    const { options, projectId } = await setup();
    await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a'),
      source: 'ci',
    });
    await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a', 'b'),
      source: 'ci',
      branch: 'feature/x',
    });
    const added = await newFindingsAgainstDefault(options, projectId, 'feature/x');
    expect(added.map((finding) => finding.ruleId)).toEqual(['b']);
    expect(await newFindingsAgainstDefault(options, projectId, 'main')).toEqual([]);
  });
});

describe('scans this install runs', () => {
  async function withPath(
    repoPath: string | null,
    repositoryUrl: string | null = null,
    ecosystem = 'go',
  ) {
    const context = await setup();
    await context.db
      .update(schema.projects)
      .set({ repoPath, repositoryUrl, profile: { ecosystem } })
      .where(eq(schema.projects.id, context.projectId));
    return context;
  }

  it('enqueues one run per scanner a runner advertises, and names the rest as not configured', async () => {
    const { options, projectId } = await withPath('/srv/repos/service');
    const jobs: HealthScanJob[] = [];
    const scan: HealthScanOptions = {
      ...options,
      scannerCapabilities: async () => new Set(['gitleaks', 'golangci-lint']),
      startScanJob: async (job) => {
        jobs.push(job);
        return { runId: `run-${job.scanner.id}` };
      },
    };
    const started = await startHealthScan(scan, projectId);
    expect(started).toEqual({
      runIds: ['run-gitleaks', 'run-golangci-lint'],
      scanners: ['gitleaks', 'golangci-lint'],
      notConfigured: ['semgrep', 'osv-scanner', 'trivy', 'jscpd'],
    });
    expect(jobs[0]).toMatchObject({
      repository: '/srv/repos/service',
      gitUrl: null,
      health: { branch: 'main', format: 'sarif', sourceRoot: '/srv/repos/service' },
    });
  });

  it('never enqueues a scanner that runs repository code for a cloned repository', async () => {
    const { options, projectId } = await withPath(null, 'https://github.com/example/service.git');
    const jobs: HealthScanJob[] = [];
    const started = await startHealthScan(
      {
        ...options,
        scannerCapabilities: async () => new Set(['gitleaks', 'golangci-lint']),
        startScanJob: async (job) => {
          jobs.push(job);
          return { runId: 'r' };
        },
      },
      projectId,
    );
    expect(started.scanners).toEqual(['gitleaks']);
    expect(started.notConfigured).not.toContain('golangci-lint');
    expect(jobs[0]?.gitUrl).toBe('https://github.com/example/service.git');
  });

  it('refuses a project with nowhere to scan, and an install with no queue', async () => {
    const nowhere = await withPath(null);
    await expect(
      startHealthScan(
        { ...nowhere.options, startScanJob: async () => ({ runId: 'r' }) },
        nowhere.projectId,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const local = await withPath('/srv/repos/service');
    await expect(startHealthScan(local.options, local.projectId)).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
  });

  it('ingests the declared report from a scan run, and ignores every other artifact', async () => {
    const { options, projectId } = await setup();
    const configuration = {
      health: {
        projectId,
        scanner: 'gitleaks',
        format: 'sarif',
        output: 'automate-health-gitleaks.sarif',
        branch: 'main',
        sourceRoot: null,
      },
    };
    expect(
      await ingestScanArtifact(options, configuration, 'stdout.log', gitleaksClean),
    ).toBeNull();
    expect(
      await ingestScanArtifact(
        options,
        { command: {} },
        'automate-health-gitleaks.sarif',
        gitleaksClean,
      ),
    ).toBeNull();
    const result = await ingestScanArtifact(
      options,
      configuration,
      'automate-health-gitleaks.sarif',
      gitleaksClean,
    );
    expect(result?.toolKey).toBe('sarif:gitleaks');
    expect((await projectHealth(options, projectId)).reports[0]?.source).toBe('runner');
  });
});

describe('ownership, the gate, alerts and schedules', () => {
  it('assigns owners from a local CODEOWNERS on ingest, and keeps a person’s assignment', async () => {
    const { options, projectId, db } = await setup();
    await db
      .update(schema.projects)
      .set({ repoPath: '/srv/repos/service' })
      .where(eq(schema.projects.id, projectId));
    const reading: RepoHealthOptions = {
      ...options,
      readRepositoryFile: async (_root, file) =>
        file === '.github/CODEOWNERS' ? '* @org/all\nsrc/a.ts @org/a' : null,
    };
    await ingestHealthReport(reading, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a', 'b'),
      source: 'ci',
    });
    const owners = (await listFindings(reading, projectId, { limit: 50, offset: 0 })).findings.map(
      (finding) => [finding.ruleId, finding.owner],
    );
    expect(owners).toEqual(
      expect.arrayContaining([
        ['a', '@org/a'],
        ['b', '@org/all'],
      ]),
    );
    const [first] = (
      await listFindings(reading, projectId, { q: 'src/a.ts', limit: 50, offset: 0 })
    ).findings;
    await triageFinding(reading, projectId, first?.id ?? '', { state: 'open', owner: '@ana' }, 'x');
    await ingestHealthReport(reading, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a', 'b'),
      source: 'ci',
    });
    expect(
      (await listFindings(reading, projectId, { q: 'src/a.ts', limit: 50, offset: 0 })).findings[0]
        ?.owner,
    ).toBe('@ana');
  });

  it('assigns owners from an uploaded CODEOWNERS to findings nobody owns', async () => {
    const { options, projectId } = await setup();
    await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a'),
      source: 'ci',
    });
    expect(await setCodeowners(options, projectId, '# team\nsrc/ @org/src')).toEqual({
      rules: 1,
      assigned: 1,
    });
    expect((await getHealthSettings(options, projectId)).codeowners).toBe(true);
    await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a', 'c'),
      source: 'ci',
    });
    const owners = (await listFindings(options, projectId, { limit: 50, offset: 0 })).findings.map(
      (finding) => finding.owner,
    );
    expect(owners).toEqual(['@org/src', '@org/src']);
  });

  it('gates a branch on what it adds over the default branch', async () => {
    const { options, projectId } = await setup();
    await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a'),
      source: 'ci',
    });
    await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a'),
      source: 'ci',
      branch: 'clean',
    });
    expect((await healthGate(options, projectId, 'clean')).verdict.verdict).toBe('passed');
    await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: fixture('trivy.sarif'),
      source: 'ci',
      branch: 'risky',
    });
    const risky = await healthGate(options, projectId, 'risky');
    expect(risky.verdict).toMatchObject({ verdict: 'failed', newFindings: { critical: 1 } });
    expect(risky.added.map((finding) => finding.ruleId)).toContain('CVE-2021-44906');
  });

  it('tells onReport what changed: the previous letter and the new findings', async () => {
    const events: ReportEvent[] = [];
    const { options, projectId } = await setup();
    const watching: RepoHealthOptions = {
      ...options,
      onReport: async (event) => void events.push(event),
    };
    await ingestHealthReport(watching, {
      projectId,
      format: 'jscpd',
      bytes: noDuplication,
      source: 'ci',
    });
    await ingestHealthReport(watching, {
      projectId,
      format: 'sarif',
      bytes: gitleaksClean,
      source: 'ci',
    });
    await ingestHealthReport(watching, {
      projectId,
      format: 'sarif',
      bytes: fixture('trivy.sarif'),
      source: 'ci',
    });
    const last = events.at(-1);
    expect(last).toMatchObject({
      onDefaultBranch: true,
      previous: { letter: 'A+' },
      project: 'Service',
    });
    expect(last?.added).toHaveLength(3);
    expect(last?.current.letter === 'D' || last?.current.letter === 'F').toBe(true);
  });

  it('stores alert settings on the project', async () => {
    const { options, projectId } = await setup();
    await setAlertSettings(options, projectId, { slackChannel: '#quality' });
    expect((await getHealthSettings(options, projectId)).alerts).toEqual({
      slackChannel: '#quality',
    });
  });

  it('writes one worker schedule per available scanner, and replaces or removes them', async () => {
    const { options, projectId, db } = await setup();
    await db
      .update(schema.projects)
      .set({ repoPath: '/srv/repos/service', profile: { ecosystem: 'node' } })
      .where(eq(schema.projects.id, projectId));
    const scan: HealthScanOptions = {
      ...options,
      scannerCapabilities: async () => new Set(['gitleaks', 'semgrep']),
    };
    expect(await setHealthSchedule(scan, projectId, 'daily')).toEqual({
      cadence: 'daily',
      scanners: ['gitleaks', 'semgrep'],
    });
    const rows = await db.select().from(schema.schedules);
    expect(rows.map((row) => [row.id, row.cronExpr])).toEqual([
      [`health:${projectId}:gitleaks`, '0 3 * * *'],
      [`health:${projectId}:semgrep`, '0 3 * * *'],
    ]);
    expect(rows[0]?.runOptions).toMatchObject({
      request: {
        testType: 'health',
        requiredCapabilities: ['gitleaks'],
        configuration: { health: { scanner: 'gitleaks' } },
      },
    });
    await setHealthSchedule(scan, projectId, 'weekly');
    expect((await db.select().from(schema.schedules)).map((row) => row.cronExpr)).toEqual([
      '0 3 * * 1',
      '0 3 * * 1',
    ]);
    await setHealthSchedule(scan, projectId, null);
    expect(await db.select().from(schema.schedules)).toEqual([]);
    expect((await getHealthSettings(options, projectId)).schedule).toBeNull();
  });
});

describe('workspace isolation', () => {
  it('a project in one workspace is invisible from another', async () => {
    const { options, projectId } = await setup();
    await ingestHealthReport(options, {
      projectId,
      format: 'sarif',
      bytes: semgrep('a'),
      source: 'ci',
    });
    const other: RepoHealthOptions = { ...options, workspaceId: 'ws-2' };
    await expect(projectHealth(other, projectId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(listFindings(other, projectId, { limit: 50, offset: 0 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(healthHistory(other, projectId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      ingestHealthReport(other, { projectId, format: 'sarif', bytes: semgrep('a'), source: 'ci' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await portfolio(other)).projects).toEqual([]);
    const [finding] = (await listFindings(options, projectId, { limit: 50, offset: 0 })).findings;
    await expect(
      triageFinding(other, projectId, finding?.id ?? '', { state: 'open' }, 'x'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('helpers', () => {
  it('branchFor falls back to the default branch, then main', () => {
    expect(branchFor({ defaultBranch: 'trunk' })).toBe('trunk');
    expect(branchFor({ defaultBranch: null })).toBe('main');
    expect(branchFor({ defaultBranch: 'trunk' }, '  ')).toBe('trunk');
    expect(branchFor({ defaultBranch: 'trunk' }, 'dev')).toBe('dev');
  });

  it('effectiveState reopens an expired decision only', () => {
    const now = new Date('2026-10-23T00:00:00.000Z');
    const past = new Date('2026-10-01T00:00:00.000Z');
    expect(effectiveState('accepted', past, now)).toBe('open');
    expect(effectiveState('suppressed', past, now)).toBe('open');
    expect(effectiveState('false_positive', past, now)).toBe('false_positive');
    expect(effectiveState('accepted', null, now)).toBe('accepted');
    expect(effectiveState('accepted', new Date('2026-11-01T00:00:00.000Z'), now)).toBe('accepted');
  });
});
