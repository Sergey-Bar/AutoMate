import { afterEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@automate/db';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { healthGate, ingestHealthReport, type RepoHealthOptions } from './repo-health-service.js';
import {
  DIFF_COVERAGE_RETENTION,
  diffCoverageStatus,
  gateDiffCoverage,
  mergeLineMaps,
  storeLineMap,
} from './diff-coverage-service.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function project(
  db: MigratedDb,
  workspaceId: string,
  profile: Record<string, unknown> = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.projects)
    .values({ workspaceId, name: 'service', slug: 'service', defaultBranch: 'main', profile })
    .returning({ id: schema.projects.id });
  return (row as { id: string }).id;
}

async function setup(profile: Record<string, unknown> = {}) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  let tick = 0;
  // A clock that moves, so "most recent" is decided by arrival and not by a tie.
  const now = () => new Date(Date.UTC(2026, 9, 23, 12, 0, tick++));
  const options: RepoHealthOptions = { db: db as never, workspaceId: 'ws-1', now };
  return { db, options, projectId: await project(db, 'ws-1', profile) };
}

const text = (value: string) => new TextEncoder().encode(value);

/** `src/a.ts`: lines 1–4 executable, 1 and 2 ran. */
const LCOV = ['SF:src/a.ts', 'DA:1,1', 'DA:2,3', 'DA:3,0', 'DA:4,0', 'end_of_record', ''].join(
  '\n',
);

/** Adds lines 2, 3 and 5 to `src/a.ts` (5 is a comment) and a README line. */
const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,5 @@',
  ' one',
  '+two',
  '+three',
  ' four',
  '+// five',
  'diff --git a/README.md b/README.md',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -0,0 +1 @@',
  '+hello',
  '',
].join('\n');

const COMMIT = 'abc1234def';

async function coverage(options: RepoHealthOptions, projectId: string, commit = COMMIT) {
  return ingestHealthReport(options, {
    projectId,
    format: 'lcov',
    bytes: text(LCOV),
    branch: 'feature',
    commitSha: commit,
    source: 'ci',
  });
}

async function diff(options: RepoHealthOptions, projectId: string, commit = COMMIT) {
  return ingestHealthReport(options, {
    projectId,
    format: 'git-diff',
    bytes: text(DIFF),
    branch: 'feature',
    commitSha: commit,
    source: 'ci',
  });
}

const EXPECTED = {
  covered: 1,
  executable: 2,
  ratio: 0.5,
  uncovered: [{ path: 'src/a.ts', lines: [3] }],
  unmeasuredFiles: ['README.md'],
};

describe('diff coverage', () => {
  it('is computed by whichever upload arrives second: coverage first', async () => {
    const { options, projectId } = await setup();
    await coverage(options, projectId);
    expect((await diffCoverageStatus(options, projectId, COMMIT)).state).toBe('waiting-for-diff');
    await diff(options, projectId);
    const status = await diffCoverageStatus(options, projectId, COMMIT);
    expect(status).toMatchObject({ state: 'computed', branch: 'feature', result: EXPECTED });
  });

  it('is computed by whichever upload arrives second: diff first', async () => {
    const { options, projectId } = await setup();
    const uploaded = await diff(options, projectId);
    expect(uploaded).toMatchObject({ toolKey: 'git-diff', metrics: 0 });
    expect((await diffCoverageStatus(options, projectId, COMMIT)).state).toBe(
      'waiting-for-coverage',
    );
    await coverage(options, projectId);
    expect(await diffCoverageStatus(options, projectId, COMMIT)).toMatchObject({
      state: 'computed',
      result: EXPECTED,
    });
    expect((await diffCoverageStatus(options, projectId, 'fffffff')).state).toBe('none');
  });

  it('has no ratio for a change with no executable line, rather than 0% or 100%', async () => {
    const { options, projectId } = await setup();
    await coverage(options, projectId);
    await ingestHealthReport(options, {
      projectId,
      format: 'git-diff',
      bytes: text(
        [
          'diff --git a/README.md b/README.md',
          '--- a/README.md',
          '+++ b/README.md',
          '@@ -0,0 +1 @@',
          '+hello',
          '',
        ].join('\n'),
      ),
      branch: 'feature',
      commitSha: COMMIT,
      source: 'ci',
    });
    expect(await diffCoverageStatus(options, projectId, COMMIT)).toMatchObject({
      state: 'computed',
      result: { covered: 0, executable: 0, ratio: null, unmeasuredFiles: ['README.md'] },
    });
  });

  it('reads a stored result whose lists are not lists as empty, never as a crash', async () => {
    const { db, options, projectId } = await setup();
    await coverage(options, projectId);
    await diff(options, projectId);
    await db
      .update(schema.diffCoverageResults)
      .set({
        uncovered: sql`'{"not":"a list"}'::jsonb`,
        unmeasuredFiles: sql`'"README.md"'::jsonb`,
      })
      .where(eq(schema.diffCoverageResults.projectId, projectId));
    expect(await diffCoverageStatus(options, projectId, COMMIT)).toMatchObject({
      state: 'computed',
      result: { covered: 1, executable: 2, ratio: 0.5, uncovered: [], unmeasuredFiles: [] },
    });
  });

  it('keeps both shards\u2019 lines when two shards of one commit upload at once', async () => {
    const { options, projectId } = await setup();
    const shard = (path: string) =>
      storeLineMap(options, {
        projectId,
        branch: 'feature',
        commit: COMMIT,
        files: [{ path, executable: [1, 2], covered: [1] }],
        reportId: null,
        now: new Date('2026-10-23T12:00:00.000Z'),
      });
    await Promise.all([shard('src/a.ts'), shard('src/b.ts'), shard('src/c.ts')]);
    const [row] = await options.db.select().from(schema.coverageLineMaps);
    const paths = (row?.files as Array<{ path: string }>).map((file) => file.path).sort();
    expect(paths).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('merges shards of one commit, so a line any shard ran is covered', () => {
    expect(
      mergeLineMaps(
        [{ path: 'a.ts', executable: [1, 2], covered: [1] }],
        [
          { path: 'a.ts', executable: [2, 3], covered: [2] },
          { path: 'b.ts', executable: [1], covered: [] },
        ],
      ),
    ).toEqual([
      { path: 'a.ts', executable: [1, 2, 3], covered: [1, 2] },
      { path: 'b.ts', executable: [1], covered: [] },
    ]);
  });

  it('refuses a diff without a commit, and a body that is not a diff', async () => {
    const { options, projectId } = await setup();
    await expect(
      ingestHealthReport(options, {
        projectId,
        format: 'git-diff',
        bytes: text(DIFF),
        source: 'ci',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      ingestHealthReport(options, {
        projectId,
        format: 'git-diff',
        bytes: text('just some words'),
        commitSha: COMMIT,
        source: 'ci',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST_BODY' });
  });

  it('fails the gate below minDiffCoverage, and when the commit was not measured', async () => {
    const { options, projectId } = await setup({ health: { gate: { minDiffCoverage: 80 } } });
    const unmeasured = await healthGate(options, projectId, 'feature', COMMIT);
    expect(unmeasured.verdict.verdict).toBe('failed');
    expect(unmeasured.verdict.reasons.join(' ')).toMatch(/not measured/u);
    await coverage(options, projectId);
    await diff(options, projectId);
    const below = await healthGate(options, projectId, 'feature', COMMIT);
    expect(below.diffCoverage).toMatchObject(EXPECTED);
    expect(below.verdict).toMatchObject({
      verdict: 'failed',
      reasons: [
        'Diff coverage 50.0% of 2 changed executable lines; the policy requires at least 80%',
      ],
    });
    // Without a commit the gate reads the branch's latest measurement.
    expect((await healthGate(options, projectId, 'feature')).diffCoverage?.ratio).toBe(0.5);
  });

  it(`keeps at most ${String(DIFF_COVERAGE_RETENTION)} commits per project in each table`, async () => {
    const { db, options, projectId } = await setup();
    const total = DIFF_COVERAGE_RETENTION + 3;
    for (let index = 0; index < total; index += 1) {
      const commit = index.toString(16).padStart(7, '0');
      await coverage(options, projectId, commit);
      await diff(options, projectId, commit);
    }
    const maps = await db
      .select({ commit: schema.coverageLineMaps.commitSha })
      .from(schema.coverageLineMaps)
      .where(eq(schema.coverageLineMaps.projectId, projectId));
    const diffs = await db
      .select({ commit: schema.diffCoverageResults.commitSha })
      .from(schema.diffCoverageResults)
      .where(eq(schema.diffCoverageResults.projectId, projectId));
    expect(maps).toHaveLength(DIFF_COVERAGE_RETENTION);
    expect(diffs).toHaveLength(DIFF_COVERAGE_RETENTION);
    // The oldest went first.
    expect(maps.map((row) => row.commit)).not.toContain('0000000');
    expect(maps.map((row) => row.commit)).toContain((total - 1).toString(16).padStart(7, '0'));
  }, 60_000);
});

describe('workspace isolation', () => {
  it('neither reads nor completes another workspace commit', async () => {
    const { db, options, projectId } = await setup();
    await coverage(options, projectId);
    const foreignProject = await project(db, 'ws-2');
    const foreign: RepoHealthOptions = { ...options, workspaceId: 'ws-2' };
    await expect(diffCoverageStatus(foreign, projectId, COMMIT)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(diff(foreign, projectId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // The same commit in ws-2 does not find ws-1's line map, so it waits for its own.
    await diff(foreign, foreignProject);
    expect((await diffCoverageStatus(foreign, foreignProject, COMMIT)).state).toBe(
      'waiting-for-coverage',
    );
    expect(await gateDiffCoverage(foreign, projectId, 'feature', COMMIT)).toBeNull();
    expect((await diffCoverageStatus(options, projectId, COMMIT)).state).toBe('waiting-for-diff');
  });
});
