import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { composeReport, renderPlain } from '@automate/reporting';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { agentProject, encode, evalRun } from '../test-support/agent-fixtures.js';
import { loadReport } from './notification-service.js';
import { loadReportAreas, REPORT_PROJECT_LIMIT } from './report-areas.js';
import { ingestHealthReport } from './repo-health-service.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-10-26T12:00:00.000Z');

async function seed() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const checkout = await agentProject(db, {}, { name: 'checkout' });
  // A dependency scan with an open critical that has a fix: the supply-chain card fails.
  await db.insert(schema.healthReports).values({
    workspaceId: 'ws-1',
    projectId: checkout,
    branch: 'main',
    source: 'ci',
    format: 'cyclonedx-json',
    toolKey: 'cyclonedx-json',
    tools: [{ tool: { name: 'syft', version: null }, dimensions: ['dependencies'] }],
  });
  await db.insert(schema.healthFindings).values({
    workspaceId: 'ws-1',
    projectId: checkout,
    branch: 'main',
    fingerprint: 'fp-1',
    toolKey: 'cyclonedx-json',
    tool: 'grype',
    ruleId: 'CVE-1',
    kind: 'vulnerability',
    severity: 'critical',
    fixAvailable: true,
    dimension: 'dependencies',
    message: 'lodash is vulnerable',
  });
  // Another workspace's project, which no line may mention.
  await db.insert(schema.projects).values({ workspaceId: 'ws-2', name: 'theirs', slug: 'theirs' });
  return { db, checkout };
}

describe('loadReportAreas', () => {
  it('reads the three areas and every failing reason, for this workspace only', async () => {
    const { db } = await seed();
    const areas = await loadReportAreas({ db: db as never, workspaceId: 'ws-1', now: () => NOW });
    expect(areas.areas.map((area) => area.label)).toEqual(['DORA', 'AI code', 'Agent quality']);
    // DORA and AI code are always read; with no delivery data they are unmeasured.
    expect(areas.areas[0]?.cards.map((card) => card.project)).toEqual(['checkout']);
    expect(areas.areas[2]?.cards).toEqual([]);
    const supply = areas.scorecards.find((card) => card.status === 'fail');
    expect(supply).toMatchObject({
      project: 'checkout',
      reasons: ['1 critical vulnerability with a fix available is open.'],
    });
    const everything = JSON.stringify(areas);
    expect(everything).not.toContain('theirs');
    expect(REPORT_PROJECT_LIMIT).toBe(20);
  });

  it('puts the areas and the top actions into the scheduled report', async () => {
    const { db } = await seed();
    const input = await loadReport(
      { db: db as never, workspaceId: 'ws-1', vaultSecret: undefined, now: () => NOW },
      { title: 'Weekly quality report', windowDays: 7, link: null },
    );
    const text = renderPlain(composeReport(input), 2_000);
    expect(text).toContain(
      'Top actions:\n1. checkout: 1 critical vulnerability with a fix available is open.',
    );
    expect(text).toContain('DORA: not measured yet');
    expect(text).toContain('AI code: not measured yet');
    expect(text).not.toContain('Agent quality');
  });

  it('reads an agents card from an eval suite, and the grade’s fix-next actions', async () => {
    const { db } = await seed();
    const evalsProject = await agentProject(db, {}, { name: 'bot' });
    const options = { db: db as never, workspaceId: 'ws-1', now: () => NOW };
    const ingest = (format: 'automate-eval-json' | 'sarif' | 'jscpd', body: unknown) =>
      ingestHealthReport(options, {
        projectId: evalsProject,
        format,
        bytes: encode(body),
        branch: 'main',
        source: 'ci',
      });
    await ingest('automate-eval-json', evalRun('support', { a: 9, b: 9 }));
    await ingest('sarif', {
      version: '2.1.0',
      runs: [{ tool: { driver: { name: 'gitleaks' } }, results: [] }],
    });
    await ingest('jscpd', { statistics: { total: { percentage: 20 } } });
    // No clock passed: the read falls back to the real one rather than failing.
    const areas = await loadReportAreas({ db: db as never, workspaceId: 'ws-1' });
    expect(areas.areas[2]?.cards).toEqual([
      expect.objectContaining({ project: 'bot', status: 'insufficient' }),
    ]);
    const fixes = areas.fixNext.filter((fix) => fix.project === 'bot');
    expect(fixes.length).toBeGreaterThan(0);
    for (const fix of fixes) {
      expect(fix.title.length).toBeGreaterThan(0);
      expect(fix.gain).toBeGreaterThan(0);
    }
  });

  it('keeps every other project when one project’s read fails', async () => {
    const { db } = await seed();
    // Read first by name, and its project lookup — the second select — is the one that fails.
    await agentProject(db, {}, { name: 'alpha' });
    const reads = { count: 0 };
    // A database that fails the second project lookup.
    const flaky = new Proxy(db, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'select' || typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          reads.count += 1;
          if (reads.count === 2) throw new Error('database went away');
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const areas = await loadReportAreas({
      db: flaky as never,
      workspaceId: 'ws-1',
      now: () => NOW,
    });
    expect(areas.areas[0]?.cards.map((card) => card.project)).toEqual(['checkout']);
    expect(areas.scorecards.every((card) => card.project === 'checkout')).toBe(true);
  });
});
