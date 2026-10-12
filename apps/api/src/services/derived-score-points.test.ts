import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { parseCoverage } from '@automate/reporter';
import { literalView } from '@automate/projects';
import { qaScore } from './qa-score-service.js';
import { InMemoryScorePointStore, seriesOf, SCORE_TREND_POINTS } from './derived-score-points.js';
import type { ScorePointStore } from './derived-score-points.js';
import { DrizzleScorePointStore } from './drizzle-derived-score-points.js';
import { DEFAULT_WORKSPACE_ID } from '../repositories/run-repository.js';
import { SCORE_CATEGORIES, SCORE_SURFACES } from '@automate/shared-contracts';

/**
 * The score's photographs, against a real migrated database.
 *
 * ## What is proven here, and what is not
 *
 * Not the score's arithmetic — `packages/projects` proves that against
 * hand-computed fixtures. What is proven here is the property migration 0027
 * exists for, and it needs the real thing to be visible at all:
 *
 *  1. **two consecutive reads of an unchanged window produce identical points.**
 *     A `written_at`-keyed table would produce a second row per page load and
 *     the would-be trend would show a window read twice as though the score had
 *     moved between two identical readings.
 *  2. **a changed cell moves the newest point only.** The earlier points are
 *     photographs of earlier windows: a photograph does not change when its
 *     subject does, and a series whose history silently re-scores is a chart
 *     nobody can trust.
 *  3. **a point is its workspace's.** A trend readable across tenants would
 *     chart one installation's score history as another's.
 *
 * The upsert is the plain-column `ON CONFLICT` this schema allows — no
 * `coalesce` expression, which is the distinction from `decision_records` — so
 * what is under test is also what ships.
 *
 * ## Every workspace id below is the one the default install uses
 *
 * `DEFAULT_WORKSPACE_ID` is `'default-workspace'` — a **name**, not a uuid — and
 * a uuid `workspace_id` column fails with `22P02` against it, which is how
 * `decision_records` shipped broken for one wave. Writing these tests under the
 * production default is the cheapest way to keep that class of defect out of
 * this table.
 */

/** The workspace every test reads and writes under — the default install's. */
const WORKSPACE = DEFAULT_WORKSPACE_ID;
/** A second workspace, used only to prove it sees nothing. */
const OTHER_WORKSPACE = 'someone-elses-workspace';
/** The project every score read is about. */
const PROJECT = '11111111-1111-4111-8111-111111111111';

/** Two instants, an hour apart, with the second in the window of the first's next. */
const FIRST_WINDOW = '2026-10-02T00:00:00.000Z';
const SECOND_WINDOW = '2026-10-02T01:00:00.000Z';

/**
 * The migration graph read straight from the journal.
 *
 * Copied rather than imported for the reason `routes/projects.test.ts` gives:
 * the helper lives in `tests/integration`, a different package, and a dependency
 * in the wrong direction to borrow four lines is not worth it. The graph is read
 * from the same file both packages read, so there is one source of truth.
 */
function migrationSql(): string {
  const drizzleDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../packages/db/drizzle',
  );
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

/** A coverage report in LCOV, the simplest format the reporter parses. */
function lcov(path: string, covered: number, total: number): Uint8Array {
  const lines = [];
  for (let line = 1; line <= total; line += 1) {
    lines.push(`DA:${String(line)},${line <= covered ? 1 : 0}`);
  }
  return new TextEncoder().encode(
    `SF:${path}\n${lines.join('\n')}\nLF:${String(total)}\nLH:${String(covered)}\nend_of_record\n`,
  );
}

describe('a point is a photograph of one window', () => {
  let client: PGlite;
  let store: ScorePointStore;

  beforeEach(async () => {
    client = new PGlite();
    await client.exec(migrationSql());
    const db = drizzle(client, { schema });
    // **No workspace row to seed.** Migration 0003 inserts `default-workspace`,
    // which is the workspace these tests read and write under — and the seed is
    // the reason this table must accept a *name* rather than a uuid.
    await db.insert(schema.projects).values({
      id: PROJECT,
      workspaceId: WORKSPACE,
      name: 'Service',
      slug: 'svc',
      repoPath: '/repos/svc',
      // The four scalars `ProjectProfileSchema` requires present — everything
      // else defaults. A row whose profile would not parse is a 500 at scoring
      // rather than a score, and this is the shape a detected row carries.
      profile: {
        detectorVersion: 1,
        ecosystem: 'node',
        language: 'typescript',
        packageManager: 'pnpm',
        // **Every cell except `unit:backend` is `n/a`, which is what a project
        // with a unit suite and nothing else actually declares.** Without the
        // marks the geometric mean is `0` — one missing cell does not lower the
        // score, it erases it — and a "changed cell" written against a total that
        // is already zero cannot show a change. Exclusion is the documented
        // product answer to that, not a test convenience.
        excludedCells: SCORE_CATEGORIES.flatMap((category) =>
          SCORE_SURFACES.filter((surface) => !(category === 'unit' && surface === 'backend')).map(
            (surface) => ({ category, surface }),
          ),
        ),
      },
    });
    store = new DrizzleScorePointStore(
      db as unknown as ConstructorParameters<typeof DrizzleScorePointStore>[0],
    );
  });

  afterEach(async () => {
    await client.close();
  });

  it('writes one point per window, and a second read of the same window writes nothing new', async () => {
    await store.record({
      projectId: PROJECT,
      workspaceId: WORKSPACE,
      at: FIRST_WINDOW,
      total: 71,
      labels: { 'unit:api': 0.71 },
    });
    const first = await store.listRecent(PROJECT, WORKSPACE, SCORE_TREND_POINTS);
    expect(first).toHaveLength(1);
    expect(first[0]?.total).toBe(71);

    // The second read is the *same* window with the same numbers, which is the
    // only situation in which a photograph can be a no-op.
    await store.record({
      projectId: PROJECT,
      workspaceId: WORKSPACE,
      at: FIRST_WINDOW,
      total: 71,
      labels: { 'unit:api': 0.71 },
    });
    const second = await store.listRecent(PROJECT, WORKSPACE, SCORE_TREND_POINTS);
    expect(second).toHaveLength(1);
    expect(second[0]?.id).toBe(first[0]?.id);
    // **`writtenAt` is when the window was first photographed.** A second read
    // did not take a second photograph, so the first instant stands even though
    // the row was rewritten.
    expect(second[0]?.writtenAt).toBe(first[0]?.writtenAt);
  });

  it('reads the series oldest first, and caps it at the limit asked for', async () => {
    for (let hour = 0; hour < 5; hour += 1) {
      await store.record({
        projectId: PROJECT,
        workspaceId: WORKSPACE,
        at: new Date(Date.parse('2026-10-01T00:00:00.000Z') + hour * 3_600_000).toISOString(),
        total: 60 + hour,
        labels: {},
      });
    }
    const series = await store.listRecent(PROJECT, WORKSPACE, 3);
    // The three newest, but oldest first: the chart reads chronologically, and
    // the newest is the one the reader lands on.
    expect(series.map((point) => point.total)).toEqual([62, 63, 64]);
    expect(seriesOf(series)).toEqual({
      points: [62, 63, 64],
      labels: series.map((point) => point.at),
    });
  });

  it('shows another workspace nothing, even for the same project id', async () => {
    await store.record({
      projectId: PROJECT,
      workspaceId: WORKSPACE,
      at: FIRST_WINDOW,
      total: 81,
      labels: { 'unit:api': 0.81 },
    });
    // The cross-workspace read is the honest empty one, and it is empty because
    // the predicate is in the query rather than because a filter ran afterwards.
    expect(await store.listRecent(PROJECT, OTHER_WORKSPACE, SCORE_TREND_POINTS)).toEqual([]);
  });
});

describe('the score reads back a series, and it behaves like a photograph', () => {
  let client: PGlite;
  let store: ScorePointStore;
  /** The handle every read shares, so `options()` can hand the service a db. */
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    client = new PGlite();
    await client.exec(migrationSql());
    db = drizzle(client, { schema });
    // Migration 0003 already seeded `default-workspace`, the one this reads under.
    await db.insert(schema.projects).values({
      id: PROJECT,
      workspaceId: WORKSPACE,
      name: 'Service',
      slug: 'svc',
      repoPath: '/repos/svc',
      // The four scalars `ProjectProfileSchema` requires present — everything
      // else defaults. A row whose profile would not parse is a 500 at scoring
      // rather than a score, and this is the shape a detected row carries.
      profile: {
        detectorVersion: 1,
        ecosystem: 'node',
        language: 'typescript',
        packageManager: 'pnpm',
        // **Every cell except `unit:backend` is `n/a`, which is what a project
        // with a unit suite and nothing else actually declares.** Without the
        // marks the geometric mean is `0` — one missing cell does not lower the
        // score, it erases it — and a "changed cell" written against a total that
        // is already zero cannot show a change. Exclusion is the documented
        // product answer to that, not a test convenience.
        excludedCells: SCORE_CATEGORIES.flatMap((category) =>
          SCORE_SURFACES.filter((surface) => !(category === 'unit' && surface === 'backend')).map(
            (surface) => ({ category, surface }),
          ),
        ),
      },
    });
    store = new DrizzleScorePointStore(
      db as unknown as ConstructorParameters<typeof DrizzleScorePointStore>[0],
    );
  });

  afterEach(async () => {
    await client.close();
  });

  /**
   * One run with one result, or two with two.
   *
   * **The score is `0` without them and that is the whole reason this exists.**
   * Presence is what runs and results contribute: a project with neither has a
   * total of zero however good its coverage is, and a "changed cell" written
   * against a score that is already zero cannot show a change. So each window
   * is given the evidence the score reads, and the second window is given a
   * run that failed.
   */
  async function evidence(
    runs: ReadonlyArray<{ id: string; at: string; passed: boolean }>,
  ): Promise<void> {
    for (const run of runs) {
      await db.insert(schema.runs).values({
        id: run.id,
        workspaceId: WORKSPACE,
        projectId: PROJECT,
        startedAt: new Date(run.at),
        phase: 'complete',
        outcome: run.passed ? 'passed' : 'failed',
      });
      await db.insert(schema.canonicalRunResults).values({
        runId: run.id,
        workspaceId: WORKSPACE,
        fingerprint: `fp-${run.id.slice(0, 6)}`,
        result: {
          identity: { runId: run.id, workspaceId: WORKSPACE, projectId: PROJECT },
          metadata: {
            fingerprint: `fp-${run.id.slice(0, 6)}`,
            category: 'unit',
            surface: 'backend',
          },
          attempts: [
            {
              testId: `fp-${run.id.slice(0, 6)}`,
              status: run.passed ? 'passed' : 'failed',
              durationMs: 10,
            },
          ],
          provenance: { producer: 'junit', commitSha: 'c1' },
        },
      });
    }
  }

  /** The options a real install would hand `qaScore`: the db, the tenant, the store. */
  function options() {
    return {
      db,
      workspaceId: WORKSPACE,
      scorePoints: store,
      // **A literal view, not a filesystem.** The score reads no file on this
      // path — it reads runs, results and coverage — so the view is only here
      // because the options type requires one. The detector's seam exists so
      // detection can be driven from a map; nothing on this path detects.
      viewFor: () => literalView({ 'package.json': '{"name":"svc"}' }),
    };
  }

  it('produces identical points from two consecutive reads of an unchanged window', async () => {
    await evidence([
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', at: '2026-10-01T22:00:00.000Z', passed: true },
    ]);
    // A heap of coverage in the first read and the same heap in the second: the
    // second read is the situation the unique key exists for.
    const first = await qaScore({ ...options() }, PROJECT, FIRST_WINDOW, [
      { format: 'lcov', bytes: lcov('src/api/a.ts', 9, 10) },
    ]);
    const afterFirst = await store.listRecent(PROJECT, WORKSPACE, SCORE_TREND_POINTS);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]?.total).toBe(first.total);
    // The labels are the cells as the score published them — the *why* of the
    // total, frozen at the instant it was read.
    expect(afterFirst[0]?.labels).toEqual(
      Object.fromEntries(first.cells.map((cell) => [cell.key, cell.score])),
    );

    const secondRead = await qaScore({ ...options() }, PROJECT, FIRST_WINDOW, [
      { format: 'lcov', bytes: lcov('src/api/a.ts', 9, 10) },
    ]);
    const afterSecond = await store.listRecent(PROJECT, WORKSPACE, SCORE_TREND_POINTS);
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]?.id).toBe(afterFirst[0]?.id);
    expect(afterSecond[0]?.total).toBe(first.total);
    // The read itself is unchanged too: the same inputs produce the same score,
    // which is the property that makes the second write a no-op rather than a
    // second point.
    expect(secondRead.total).toBe(first.total);
  });

  it('moves only the newest point when a cell changes', async () => {
    await evidence([
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', at: '2026-10-01T22:00:00.000Z', passed: true },
    ]);
    const before = await qaScore({ ...options() }, PROJECT, FIRST_WINDOW, [
      { format: 'lcov', bytes: lcov('src/api/a.ts', 10, 10) },
    ]);
    const pointsBefore = await store.listRecent(PROJECT, WORKSPACE, SCORE_TREND_POINTS);
    expect(pointsBefore).toHaveLength(1);

    // A later window with a run that **failed** in it: a second run, half an hour
    // after the first window opened, so the first window does not see it. The
    // cell moves; the earlier photograph must not.
    await evidence([
      { id: 'aaaaaaaa-0000-4000-8000-000000000002', at: '2026-10-02T00:30:00.000Z', passed: false },
    ]);
    const after = await qaScore({ ...options() }, PROJECT, SECOND_WINDOW, [
      { format: 'lcov', bytes: lcov('src/api/a.ts', 2, 10) },
    ]);
    expect(after.total).not.toBe(before.total);

    const points = await store.listRecent(PROJECT, WORKSPACE, SCORE_TREND_POINTS);
    expect(points.map((point) => point.total)).toEqual([before.total, after.total]);
    // The earlier point is untouched — same row, same total, same first
    // photograph instant. A series whose history re-scores is a chart nobody can
    // trust, which is the whole claim of the migration.
    expect(points[0]?.id).toBe(pointsBefore[0]?.id);
    expect(points[0]?.writtenAt).toBe(pointsBefore[0]?.writtenAt);

    // And the series the score publishes is the photographs, oldest first, with
    // the current total appended — so a read at the second window sees both.
    expect(after.trend.points).toEqual([before.total, after.total]);
    expect(after.trend.labels).toEqual([FIRST_WINDOW, SECOND_WINDOW]);
  });

  it('leaves the trend empty when nothing earlier was read', async () => {
    // The contract's own default: a one-point series is a number wearing a
    // chart's clothes, and `score()` refuses to draw one. The first window read
    // has nothing before it, so the honest series is none.
    const read = await qaScore({ ...options() }, PROJECT, FIRST_WINDOW, [
      { format: 'lcov', bytes: lcov('src/api/a.ts', 5, 10) },
    ]);
    expect(read.trend).toEqual({ points: [], labels: [] });
  });

  it('answers the score even when the photograph cannot be written', async () => {
    // **A photograph that fails is a shorter chart, not a failed score.** The
    // endpoints behind this read were pure reads until migration 0027; a write in
    // the path of a GET is only acceptable because it cannot take the GET down.
    // This test is what keeps that true — without it the `catch` is a comment with
    // no code, which is exactly the shape a review caught once already.
    const failing: ScorePointStore = {
      record: async () => {
        throw new Error('relation "derived_score_points" does not exist');
      },
      listRecent: async () => [],
    };
    await evidence([
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', at: '2026-10-01T22:00:00.000Z', passed: true },
    ]);
    const read = await qaScore({ ...options(), scorePoints: failing }, PROJECT, SECOND_WINDOW, [
      { format: 'lcov', bytes: lcov('src/api/a.ts', 5, 10) },
    ]);
    expect(read.total).toBeGreaterThan(0);
    expect(read.trend).toEqual({ points: [], labels: [] });
  });

  it('keeps only the newest points, so the table cannot grow without bound', async () => {
    // One row per reading, and `at` is the reading's clock — so the bound is what
    // keeps the table honest rather than the hope that two reads share an instant.
    for (let minute = 0; minute < SCORE_TREND_POINTS + 4; minute += 1) {
      await store.record({
        projectId: PROJECT,
        workspaceId: WORKSPACE,
        at: new Date(Date.parse('2026-10-01T00:00:00.000Z') + minute * 60_000).toISOString(),
        total: 50,
        labels: {},
      });
    }
    const series = await store.listRecent(PROJECT, WORKSPACE, SCORE_TREND_POINTS);
    expect(series).toHaveLength(SCORE_TREND_POINTS);
    // The survivors are the newest ones, oldest first: the first four readings
    // are gone and the fifth is now the oldest point in the table.
    expect(series[0]?.at).toBe(
      new Date(Date.parse('2026-10-01T00:00:00.000Z') + 4 * 60_000).toISOString(),
    );
  });
});

describe('the in-memory store obeys the same rules', () => {
  it('upserts per window, reads oldest first, and scopes on the workspace', async () => {
    const store = new InMemoryScorePointStore();
    await store.record({
      projectId: PROJECT,
      workspaceId: WORKSPACE,
      at: FIRST_WINDOW,
      total: 64,
      labels: { 'unit:api': 0.64 },
    });
    await store.record({
      projectId: PROJECT,
      workspaceId: WORKSPACE,
      at: FIRST_WINDOW,
      total: 65,
      labels: { 'unit:api': 0.65 },
    });
    await store.record({
      projectId: PROJECT,
      workspaceId: WORKSPACE,
      at: SECOND_WINDOW,
      total: 70,
      labels: { 'unit:api': 0.7 },
    });
    const points = await store.listRecent(PROJECT, WORKSPACE, SCORE_TREND_POINTS);
    // Two points, not three: the second write to the first window replaced it,
    // which is the rule the UPSERT in PostgreSQL enforces and the reason this
    // store keeps a map keyed on the window.
    expect(points.map((point) => point.total)).toEqual([65, 70]);
    expect(points[0]?.at).toBe(FIRST_WINDOW);
    expect(await store.listRecent(PROJECT, OTHER_WORKSPACE, SCORE_TREND_POINTS)).toEqual([]);
    expect(seriesOf(points).points).toEqual([65, 70]);
  });

  it('keeps the same bound as the SQL store, per project', async () => {
    // The bound is what makes the two stores agree about how much history exists,
    // so it is asserted in the in-memory one too rather than only where the row
    // count is visible. Scoped to the project being written, which is what the SQL
    // `retain` does — a global bound would let one busy project evict another's.
    const store = new InMemoryScorePointStore();
    for (let minute = 0; minute < SCORE_TREND_POINTS + 3; minute += 1) {
      await store.record({
        projectId: PROJECT,
        workspaceId: WORKSPACE,
        at: new Date(Date.parse('2026-10-01T00:00:00.000Z') + minute * 60_000).toISOString(),
        total: 50,
        labels: {},
      });
    }
    const kept = await store.listRecent(PROJECT, WORKSPACE, SCORE_TREND_POINTS);
    expect(kept).toHaveLength(SCORE_TREND_POINTS);
    expect(kept[0]?.at).toBe(
      new Date(Date.parse('2026-10-01T00:00:00.000Z') + 3 * 60_000).toISOString(),
    );

    // Another project's points are untouched by this one's bound.
    await store.record({
      projectId: 'another-project',
      workspaceId: WORKSPACE,
      at: '2026-10-02T00:00:00.000Z',
      total: 60,
      labels: {},
    });
    expect(await store.listRecent('another-project', WORKSPACE, 10)).toHaveLength(1);
  });
});

/**
 * The parse the score does not own.
 *
 * A regression guard for the input this file feeds `qaScore`: if the reporter
 * stopped parsing the LCOV these tests synthesize, every assertion above would
 * pass on a score computed from nothing at all — which is the shape of a test
 * that goes quietly green the day its fixture stops meaning anything.
 */
describe('the coverage fixture this file synthesizes is real coverage', () => {
  it('parses the LCOV into a report with lines, covered and total', () => {
    const report = parseCoverage('lcov', lcov('src/api/a.ts', 7, 10));
    expect(report).not.toBeNull();
    expect(report?.files.map((file) => file.path)).toEqual(['src/api/a.ts']);
    expect(report?.files[0]?.coveredLines).toBe(7);
    expect(report?.files[0]?.totalLines).toBe(10);
  });

  it('is a document whose totals move with the lines covered', () => {
    const worse = parseCoverage('lcov', lcov('src/api/a.ts', 2, 10));
    const better = parseCoverage('lcov', lcov('src/api/a.ts', 10, 10));
    expect(worse?.files[0]?.coveredLines).toBeLessThan(better?.files[0]?.coveredLines ?? 0);
  });
});
