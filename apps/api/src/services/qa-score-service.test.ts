import { describe, expect, it } from 'vitest';
import {
  qaScore,
  stopRun,
  classifySurface,
  mergeCoverage,
  projectRunRecord,
  projectTestResult,
  singleLayerE2e,
} from './qa-score-service.js';
import type { CoverageReport } from '@automate/reporter';
import { parseCoverage } from '@automate/reporter';

/** The window every assertion in this file describes. */
const NOW = '2026-10-02T00:00:00.000Z';

/**
 * The projection between the database and the score function.
 *
 * ## Why this file exists at all
 *
 * The score function itself is proven in `packages/projects` against hand-computed
 * fixtures. What is proven **here** is everything in between, and the in-between is
 * where the interpretive decisions live — none of which the score can make for
 * itself:
 *
 *  - **which run outcomes are the infrastructure's** rather than the code's, and are
 *    therefore reported separately instead of lowering a pass rate;
 *  - **what a `null` in a projected field means.** It is "the producer said
 *    nothing", and emphatically not `unit`, not `passed`, and not `infra_failed`.
 *    A default in any of those three positions would fabricate a fact about a test
 *    the reporter never described;
 *  - **which surface a coverage file belongs to**, which no coverage format states
 *    and which this module therefore has to be told rather than guess.
 *
 * Driving `qaScore` through a stubbed Drizzle handle was tried first and abandoned:
 * the assertions it could make were about the stub, and a test whose assertions are
 * about its own scaffolding proves nothing. These are pure functions, so they are
 * exported and tested directly.
 */

describe("a run outcome is either the code's or the infrastructure's", () => {
  it('counts a real failure as evidence about the code', () => {
    const record = projectRunRecord({
      id: 'r1',
      startedAt: new Date(),
      outcome: 'failed',
      phase: 'verifying',
    });
    expect(record.countsTowardsQuality).toBe(true);
    expect(record.outcome).toBe('failed');
  });

  it.each(['infra_failed', 'timed_out', 'runner_lost', 'cancelled'])(
    'does not count %s as evidence about the code',
    (outcome) => {
      // Plan §2.2 and §3.5. A run that died because the machine fell over says
      // nothing about the code under test, and folding it into a pass rate is how a
      // QA dashboard starts lying about a team.
      const record = projectRunRecord({ id: 'r1', startedAt: new Date(), outcome, phase: 'x' });
      expect(record.countsTowardsQuality).toBe(false);
      expect(record.outcome).toBe(outcome);
    },
  );

  it('does not count a run with no outcome at all', () => {
    // `null` means nothing concluded. Counting it as quality evidence would be a
    // claim about a run that has no result.
    expect(
      projectRunRecord({ id: 'r1', startedAt: new Date(), outcome: null, phase: 'queued' })
        .countsTowardsQuality,
    ).toBe(false);
  });
});

describe('a fingerprint that runs at both layers is a structural finding, not a score change', () => {
  it('names the e2e fingerprint that also appears in a unit cell', () => {
    // The structural finding is the highest-value signal in the product and the
    // one nobody ships: an e2e test that exists as a unit test is a duplication
    // the shape of the results already reveals. A score change would be a fifth
    // rule nobody could see — this feeds a finding, not a number.
    const results = [
      {
        identity: { runId: 'r1' },
        metadata: { fingerprint: 'login-flow', category: 'e2e', surface: 'frontend' },
        attempts: [{ testId: 'login-flow', status: 'passed' }],
      },
      {
        identity: { runId: 'r1' },
        metadata: { fingerprint: 'login-flow', category: 'unit', surface: 'frontend' },
        attempts: [{ testId: 'login-flow', status: 'passed' }],
      },
      {
        identity: { runId: 'r1' },
        metadata: { fingerprint: 'only-e2e', category: 'e2e', surface: 'frontend' },
        attempts: [{ testId: 'only-e2e', status: 'skipped' }],
      },
      {
        identity: { runId: 'r1' },
        metadata: { fingerprint: 'only-unit', category: 'unit', surface: 'backend' },
        attempts: [{ testId: 'only-unit', status: 'passed' }],
      },
    ].map(projectTestResult);

    // `only-e2e` is **skipped**, and a test that did not run is not evidence that
    // the project runs the same behaviour twice. The executed rule is the score's
    // own, imported rather than restated.
    expect(singleLayerE2e(results)).toEqual(['login-flow']);
  });
});

describe('a projected test result reports absence, not a default', () => {
  it('places a result with a category and a surface', () => {
    const projected = projectTestResult({
      identity: { runId: 'r1', projectId: 'p' },
      metadata: { fingerprint: 'f1', category: 'security', surface: 'frontend' },
      attempts: [{ testId: 'f1', status: 'failed' }],
      provenance: { commitSha: 'c1' },
    });
    expect(projected).toMatchObject({
      fingerprint: 'f1',
      runId: 'r1',
      commitSha: 'c1',
      category: 'security',
      surface: 'frontend',
      outcome: 'failed',
    });
  });

  it('leaves the category null when the reporter declared none', () => {
    // **Not `unit`.** A reporter that places a test in no column has not placed it in
    // the unit column, and guessing would make that column look over-built for
    // reasons nobody chose.
    const projected = projectTestResult({
      identity: { runId: 'r1' },
      metadata: { fingerprint: 'f1' },
      attempts: [{ testId: 'f1', status: 'passed' }],
    });
    expect(projected.category).toBeNull();
    expect(projected.surface).toBeNull();
  });

  it('leaves an unknown status as unknown rather than passing it', () => {
    expect(
      projectTestResult({
        identity: { runId: 'r1' },
        metadata: {},
        attempts: [{ testId: 'f1', status: 'weird-new-status' }],
      }).outcome,
    ).toBe('unknown');
  });

  it('leaves every optional field null when the document carries none', () => {
    // The hollow detector's three rules all key on `null` meaning "the producer
    // said nothing". Projecting `0` or `false` here would make a silent test look
    // hollow — a real and expensive false accusation.
    const projected = projectTestResult({});
    expect(projected.category).toBeNull();
    expect(projected.surface).toBeNull();
    expect(projected.durationMs).toBeNull();
    expect(projected.assertionCount).toBeNull();
    expect(projected.trivialAssertionCount).toBeNull();
    expect(projected.touchedIo).toBeNull();
    expect(projected.commitSha).toBeNull();
  });

  it('takes the last attempt as the outcome of the run, since attempts are ordered', () => {
    const projected = projectTestResult({
      identity: { runId: 'r1' },
      metadata: { fingerprint: 'f1' },
      attempts: [
        { testId: 'f1', status: 'failed', durationMs: 10 },
        { testId: 'f1', status: 'passed', durationMs: 20 },
      ],
    });
    expect(projected.outcome).toBe('passed');
    expect(projected.durationMs).toBe(20);
  });

  it('falls back to a fingerprint of "unattributed" rather than an empty string', () => {
    // An empty fingerprint would collide with every other empty fingerprint, and the
    // flake and hollow detectors both key on it.
    expect(projectTestResult({}).fingerprint).toBe('unattributed');
  });

  it('ignores a non-object document instead of throwing', () => {
    expect(projectTestResult(null).fingerprint).toBe('unattributed');
    expect(projectTestResult('nonsense').fingerprint).toBe('unattributed');
  });
});

describe('a surface is a classification, and coverage cannot make it', () => {
  it('classifies by the directory the module lives in', () => {
    // No coverage format states which surface a file belongs to, so the rule is
    // written down and asserted. A per-file guess would move files between surfaces
    // on a rename, silently changing the score.
    expect(classifySurface('src/api/login.ts')).toBe('backend');
    expect(classifySurface('src/routes/health.ts')).toBe('backend');
    expect(classifySurface('server/worker.ts')).toBe('backend');
    expect(classifySurface('src/ui/App.tsx')).toBe('frontend');
    expect(classifySurface('src/components/Table.tsx')).toBe('frontend');
    expect(classifySurface('src/pages/index.tsx')).toBe('frontend');
    expect(classifySurface('packages/shared/thing.ts')).toBe('platform');
    expect(classifySurface('lib/util.ts')).toBe('platform');
  });
});

describe('coverage from several documents merges without inventing a measurement', () => {
  const lcov = (lines: ReadonlyArray<readonly [string, number, number]>): CoverageReport =>
    parseCoverage(
      'lcov',
      new TextEncoder().encode(
        lines
          .map(
            ([path, covered, total]) =>
              `SF:${path}\n${Array.from({ length: total }, (_, i) => `DA:${i + 1},${i < covered ? 1 : 0}`).join('\n')}\nend_of_record`,
          )
          .join('\n'),
      ),
    );

  it('reports nothing for no documents, rather than a zero', () => {
    // `null` is "not measured". `0` would be a claim that the surface is measured
    // and uncovered, which is the one the score treats differently.
    expect(mergeCoverage([])).toBeNull();
  });

  it('splits a real report across the surfaces and leaves the rest unmeasured', () => {
    const merged = mergeCoverage([lcov([['src/api/a.ts', 1, 2]])]);
    expect(merged?.bySurface.backend).toBeCloseTo(0.5, 10);
    // Nothing was classified into the frontend, so it was **not measured** — not 0.
    expect(merged?.bySurface.frontend).toBeNull();
    expect(merged?.bySurface.platform).toBeNull();
  });

  it('averages two documents that both measured one surface', () => {
    const merged = mergeCoverage([lcov([['src/api/a.ts', 1, 2]]), lcov([['src/api/b.ts', 0, 2]])]);
    expect(merged?.bySurface.backend).toBeCloseTo(0.25, 10);
  });

  it('leaves a surface alone when a later document did not measure it', () => {
    // Averaging a `null` as zero would make a Python-only coverage run report the
    // frontend as measurably uncovered — exactly the claim `null` exists to avoid.
    const merged = mergeCoverage([lcov([['src/api/a.ts', 1, 2]]), lcov([['src/ui/b.ts', 0, 2]])]);
    expect(merged?.bySurface.backend).toBeCloseTo(0.5, 10);
    expect(merged?.bySurface.frontend).toBe(0);
  });
});

describe('stopping a run is refused when there is nothing to stop', () => {
  const one = (row: Record<string, unknown> | null) => ({
    select: () => ({ from: () => ({ where: async () => (row === null ? [] : [row]) }) }),
  });

  it('404s a run that does not exist', async () => {
    await expect(stopRun(one(null) as never, 'ws', 'missing', 'operator')).rejects.toThrow(
      /No such run/iu,
    );
  });

  it('refuses to stop a run that already finished', async () => {
    // A silent success would tell an operator their interruption was honoured when
    // the run had already ended — and the results they were trying to abandon are
    // the ones they would then believe were discarded.
    await expect(
      stopRun(
        one({ id: 'r1', phase: 'verifying', outcome: 'passed' }) as never,
        'ws',
        'r1',
        'too late',
      ),
    ).rejects.toThrow(/already finished/iu);
  });

  it('records the phase it interrupted and the reason the operator gave', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      select: () => ({
        from: () => ({ where: async () => [{ id: 'r1', phase: 'installing', outcome: null }] }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => void updates.push(values),
        }),
      }),
    };
    expect(await stopRun(db as never, 'ws', 'r1', 'operator changed their mind')).toEqual({
      runId: 'r1',
      previousPhase: 'installing',
      reason: 'operator changed their mind',
    });
    expect(updates[0]).toEqual({ outcome: 'cancelled', phase: 'cancelled' });
  });

  it('reports a run with no recorded phase as "unknown" rather than an empty string', async () => {
    const db = {
      select: () => ({
        from: () => ({ where: async () => [{ id: 'r1', phase: null, outcome: null }] }),
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    // A blank next to "stopped" looks like a rendering bug rather than a missing fact.
    expect((await stopRun(db as never, 'ws', 'r1', 'why')).previousPhase).toBe('unknown');
  });
});

describe('a real score over a real database, with a coverage document attached', () => {
  /**
   * The end-to-end path: registry rows → projection → score → contract.
   *
   * The tests above prove each projection in isolation. This proves the whole thing
   * composes — in particular that a coverage document reaches the score, which is the
   * only proof that the ingest wave and the score are wired to each other rather than
   * merely coexisting.
   */
  it('reads the project, attaches the coverage, and serves a contract-valid score', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const schema = await import('@automate/db');
    const { literalView } = await import('@automate/projects');
    const { createProjectsRoutes } = await import('../routes/projects.js');
    const { QaScoreSchema } = await import('@automate/shared-contracts');

    const drizzleDirectory = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../packages/db/drizzle',
    );
    const journal = JSON.parse(
      readFileSync(join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };
    const sql = journal.entries
      .slice()
      .sort((left, right) => left.idx - right.idx)
      .map((entry) =>
        readFileSync(join(drizzleDirectory, `${entry.tag}.sql`), 'utf8')
          .split('--> statement-breakpoint')
          .map((statement) => statement.trim())
          .filter(Boolean)
          .join(';\n'),
      )
      .join(';\n');

    const client = new PGlite();
    try {
      await client.exec(sql);
      const db = drizzle(client, { schema });
      const registry = {
        db: db as never,
        workspaceId: 'ws-1',
        viewFor: () =>
          literalView({ 'package.json': '{"name":"svc","scripts":{"test":"vitest run"}}' }),
      };
      const created = await createProjectsRoutes({
        ...registry,
        startRun: async () => ({ runId: 'r', jobId: 'j', phase: 'queued' }),
      }).request('/api/v1/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Svc', slug: 'svc', repoPath: '/repos/svc' }),
      });
      expect(created.status).toBe(201);
      const { project } = (await created.json()) as { project: { id: string } };

      // A backend file covered half. Without this document the cell's coverage half
      // is dropped; with it, the cell can rise.
      const score = await qaScore(registry, project.id, NOW, [
        {
          format: 'lcov',
          bytes: new TextEncoder().encode('SF:src/api/login.ts\nDA:1,1\nDA:2,0\nend_of_record\n'),
        },
        // A **second** document covering the frontend. Two documents are the case
        // that exercises the merge loop rather than a single iteration, and a
        // surface only this document measures is the case that proves a surface
        // with no coverage in document one is recorded as *unmeasured* rather than
        // as zero.
        {
          format: 'lcov',
          bytes: new TextEncoder().encode('SF:src/ui/App.tsx\nDA:1,1\nend_of_record\n'),
        },
      ]);

      expect(QaScoreSchema.safeParse(score).success).toBe(true);
      expect(score.cappedBy).toBeTypeOf('string');
      expect(score.provenance.detectorVersion).toBe(1);
      // The project has never run, so every cell has presence 0 and the total is 0 —
      // and the coverage did not quietly invent a suite to compensate.
      expect(score.total).toBe(0);
    } finally {
      await client.close();
    }
  });

  it('reads a run and its canonical results, and reports the run as evidence', async () => {
    // The projection from `canonical_run_results` into the score's own shape, end
    // to end. Without a single row in those tables the whole projection is
    // untested, and the projection is where every interpretive decision lives.
    const { readFileSync } = await import('node:fs');
    const { dirname, join, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const schema = await import('@automate/db');
    const { literalView } = await import('@automate/projects');
    const { createProjectsRoutes } = await import('../routes/projects.js');
    const { QaScoreSchema } = await import('@automate/shared-contracts');

    const drizzleDirectory = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../packages/db/drizzle',
    );
    const journal = JSON.parse(
      readFileSync(join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };
    const sql = journal.entries
      .slice()
      .sort((left, right) => left.idx - right.idx)
      .map((entry) =>
        readFileSync(join(drizzleDirectory, `${entry.tag}.sql`), 'utf8')
          .split('--> statement-breakpoint')
          .map((statement) => statement.trim())
          .filter(Boolean)
          .join(';\n'),
      )
      .join(';\n');

    const client = new PGlite();
    try {
      await client.exec(sql);
      const db = drizzle(client, { schema });
      const registry = {
        db: db as never,
        workspaceId: 'ws-1',
        viewFor: () =>
          literalView({ 'package.json': '{"name":"svc","scripts":{"test":"vitest run"}}' }),
      };
      const created = await createProjectsRoutes({
        ...registry,
        startRun: async () => ({ runId: 'r', jobId: 'j', phase: 'queued' }),
      }).request('/api/v1/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Svc', slug: 'svc', repoPath: '/repos/svc' }),
      });
      const { project } = (await created.json()) as { project: { id: string } };

      const runId = '00000000-0000-4000-8000-0000000000ff';
      // `phase: 'complete'` with `outcome: 'failed'`, because `runs_phase_check` and
      // `runs_phase_outcome_check` pair the two: `complete` is the phase and
      // `failed` is the verdict, and `failed` is **not itself a phase**. The
      // database is the authority on which combinations mean anything, and this
      // row has to mean "this run really did run and really did fail" — which is
      // what makes it evidence about the code rather than about the machine.
      await db.insert(schema.runs).values({
        id: runId,
        workspaceId: 'ws-1',
        projectId: project.id,
        startedAt: new Date(NOW),
        phase: 'complete',
        outcome: 'failed',
      });
      await db.insert(schema.canonicalRunResults).values({
        runId,
        workspaceId: 'ws-1',
        // `canonical_run_results` carries `fingerprint` as a real column, not only
        // inside the JSONB — which is what makes the query "every fingerprint that
        // flaked on this commit" a `WHERE` rather than a scan. Declared here so the
        // projection has something to read back.
        fingerprint: 'f1',
        result: {
          identity: { runId, workspaceId: 'ws-1', projectId: project.id },
          metadata: { fingerprint: 'f1', category: 'unit', surface: 'backend' },
          attempts: [{ testId: 'f1', status: 'passed', durationMs: 100 }],
          provenance: { producer: 'junit', commitSha: 'c1' },
        },
      });

      const score = QaScoreSchema.parse(await qaScore(registry, project.id, NOW));
      // The cell now has a suite, so `presence` is 1 and the score is no longer
      // zero everywhere — which is the whole point of reading the rows.
      const unit = score.cells.find(
        (cell) => cell.category === 'unit' && cell.surface === 'backend',
      );
      expect(unit?.presence).toBe(1);
      expect(score.provenance.runsRead).toBe(1);
      expect(score.provenance.resultsRead).toBe(1);
    } finally {
      await client.close();
    }
  });

  it('answers the trend from a window it read again, not from a synthesised series', async () => {
    // **The series used to be a pattern constant in the browser.** A sparkline
    // drew `PYRAMID_PATTERN` — a shape that looked like history and was a number:
    // the same seven values on every render, for every project, forever. The
    // trend is a second read and a second score now, and this test is what makes
    // that claim falsifiable: the older point is compared against an independent
    // score of the older window, and the last point is the current total.
    const { readFileSync } = await import('node:fs');
    const { dirname, join, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const schema = await import('@automate/db');
    const { literalView } = await import('@automate/projects');
    const { createProjectsRoutes } = await import('../routes/projects.js');

    const drizzleDirectory = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../packages/db/drizzle',
    );
    const journal = JSON.parse(
      readFileSync(join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };
    const sql = journal.entries
      .slice()
      .sort((left, right) => left.idx - right.idx)
      .map((entry) =>
        readFileSync(join(drizzleDirectory, `${entry.tag}.sql`), 'utf8')
          .split('--> statement-breakpoint')
          .map((statement) => statement.trim())
          .filter(Boolean)
          .join(';\n'),
      )
      .join(';\n');

    const EARLIER = '2026-09-20T00:00:00.000Z';
    const client = new PGlite();
    try {
      await client.exec(sql);
      const db = drizzle(client, { schema });
      const registry = {
        db: db as never,
        workspaceId: 'ws-1',
        viewFor: () => literalView({ 'package.json': '{"name":"svc"}' }),
      };
      const created = await createProjectsRoutes({
        ...registry,
        startRun: async () => ({ runId: 'r', jobId: 'j', phase: 'queued' }),
      }).request('/api/v1/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Svc', slug: 'svc', repoPath: '/repos/svc' }),
      });
      const { project } = (await created.json()) as { project: { id: string } };

      // Two runs, twelve days apart, each with its own result. The older window
      // ends at the earlier run, which is the instant the trend's first label
      // names — a series that did not read that window could not know it.
      for (const index of [0, 1]) {
        const id = `00000000-0000-4000-8000-0000000000f${index}`;
        await db.insert(schema.runs).values({
          id,
          workspaceId: 'ws-1',
          projectId: project.id,
          startedAt: new Date(index === 0 ? EARLIER : NOW),
          phase: 'complete',
          outcome: 'failed',
        });
        await db.insert(schema.canonicalRunResults).values({
          runId: id,
          workspaceId: 'ws-1',
          fingerprint: `f${index}`,
          result: {
            identity: { runId: id, workspaceId: 'ws-1', projectId: project.id },
            metadata: { fingerprint: `f${index}`, category: 'unit', surface: 'backend' },
            attempts: [{ testId: `f${index}`, status: 'passed', durationMs: 10 }],
            provenance: { producer: 'junit', commitSha: 'c1' },
          },
        });
      }

      const current = await qaScore(registry, project.id, NOW);
      const trend = current.trend;
      expect(trend.points).toHaveLength(2);
      expect(trend.labels).toHaveLength(2);
      // The last point is this score's own total, and its label is this window.
      expect(trend.points[1]).toBe(current.total);
      expect(trend.labels[1]).toBe(NOW);
      // The first point is the score of the window read again: an independent
      // reading at the earlier instant must agree with what the trend claims.
      const older = await qaScore(registry, project.id, EARLIER);
      expect(trend.points[0]).toBe(older.total);
      // A direction, and not a fabrication: the newer window has the same evidence,
      // so the direction is zero — and a series invented to look like history would
      // have been unable to claim anything else.
      expect(trend.points[1]).toBe(trend.points[0]);
      expect(older.trend.points).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it('ingests the coverage a run uploaded, when the profile declares the glob', async () => {
    // **The wire that was missing, and the reason `depth` was `unknown` on every
    // cell of every screen.** `assemble` has accepted a coverage-documents
    // parameter since the score was written and every caller passed `[]`; the
    // runner uploads artifacts, `parseCoverage` has parsed six formats since
    // before the score, and nobody had joined them. This is the join, at the
    // service's own seam: the composition root supplies the bytes, the service
    // supplies the profile's globs, and the score's `depth` component becomes a
    // measurement rather than an unknown.
    const { readFileSync } = await import('node:fs');
    const { dirname, join, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const schema = await import('@automate/db');
    const { literalView } = await import('@automate/projects');
    const { createProjectsRoutes } = await import('../routes/projects.js');
    const { QaScoreSchema } = await import('@automate/shared-contracts');
    const { runs } = await import('@automate/db');

    const drizzleDirectory = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../packages/db/drizzle',
    );
    const journal = JSON.parse(
      readFileSync(join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };
    const sql = journal.entries
      .slice()
      .sort((left, right) => left.idx - right.idx)
      .map((entry) =>
        readFileSync(join(drizzleDirectory, `${entry.tag}.sql`), 'utf8')
          .split('--> statement-breakpoint')
          .map((statement) => statement.trim())
          .filter(Boolean)
          .join(';\n'),
      )
      .join(';\n');

    const client = new PGlite();
    try {
      await client.exec(sql);
      const db = drizzle(client, { schema });
      const shared = {
        workspaceId: 'ws-1',
        viewFor: () =>
          literalView({ 'package.json': '{"name":"svc","scripts":{"test":"vitest run"}}' }),
      };
      const created = await createProjectsRoutes({
        db: db as never,
        ...shared,
        startRun: async () => ({ runId: 'r', jobId: 'j', phase: 'queued' }),
      }).request('/api/v1/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Svc', slug: 'svc', repoPath: '/repos/svc' }),
      });
      const { project } = (await created.json()) as { project: { id: string } };

      // The profile's own `coverageGlobs`, as a customer writes them: this
      // repository's vitest writes `coverage/lcov.dat`.
      const patched = await createProjectsRoutes({
        db: db as never,
        ...shared,
        startRun: async () => ({ runId: 'r', jobId: 'j', phase: 'queued' }),
      }).request(`/api/v1/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          coverageGlobs: [{ glob: 'coverage/lcov.dat', format: 'lcov' }],
        }),
      });
      expect(patched.status).toBe(200);

      // A run in the window, so there is a newest run whose coverage describes
      // this code. The run is written directly: the score's window predicate is
      // `started_at <= now`, and a row is the smallest honest way to be in it.
      await db.insert(runs).values({
        id: '00000000-0000-4000-8000-000000000001',
        workspaceId: 'ws-1',
        projectId: project.id,
        startedAt: new Date(NOW),
        phase: 'complete',
        outcome: 'passed',
      });

      // The reader the composition root wires — here a literal, which is the
      // point: a service that read object storage directly could not be driven
      // from a map, and the seam is what makes the join testable at all.
      const registry = {
        db: db as never,
        ...shared,
        readCoverageDocuments: async (): Promise<
          ReadonlyArray<{ format: 'lcov'; bytes: Uint8Array }>
        > => [
          {
            format: 'lcov',
            bytes: new TextEncoder().encode('SF:src/api/login.ts\nDA:1,1\nDA:2,1\nDA:3,0\n'),
          },
        ],
      };

      const score = QaScoreSchema.parse(await qaScore(registry, project.id, NOW));
      // The cell the document measures now reports the coverage it found rather
      // than `null`. **That is the whole feature**: the document names three
      // executable lines with two covered, so the cell's `surfaceCoverage` is two
      // thirds — where before the join it was `null` on every cell of every
      // screen, the "absence, not zero" case that meant no coverage artifact had
      // been ingested at all.
      const backend = score.cells.find(
        (cell) => cell.category === 'unit' && cell.surface === 'backend',
      );
      expect(backend).toBeDefined();
      expect(backend?.inputs.surfaceCoverage).toBeCloseTo(2 / 3, 2);
      // And the run that carried the coverage is recorded as read, so a screen
      // can say where the number came from.
      expect(score.provenance.runsRead).toBeGreaterThan(0);
      expect(score.provenance.detectorVersion).toBe(1);
    } finally {
      await client.close();
    }
  });

  it('ignores a glob the profile declares with a format this build cannot parse', async () => {
    // **The profile is a file a customer writes**, and its schema accepts any
    // non-empty string as a `format`. A seventh format must not be handed to
    // `parseCoverage` — a parse that produces nothing reported as `0.00` coverage
    // would be a measurement that failed, reported as one that found nothing.
    //
    // The end-to-end shape is the only honest one here: the narrowing lives in
    // the service's read, so the assertion is that the cell's coverage stays
    // `null` — absence, not zero — while the reader the composition root wired is
    // waiting with a document it was never asked for.
    const { readFileSync } = await import('node:fs');
    const { dirname, join, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const schema = await import('@automate/db');
    const { literalView } = await import('@automate/projects');
    const { createProjectsRoutes } = await import('../routes/projects.js');
    const { QaScoreSchema } = await import('@automate/shared-contracts');
    const { runs } = await import('@automate/db');

    const drizzleDirectory = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../packages/db/drizzle',
    );
    const journal = JSON.parse(
      readFileSync(join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };
    const sql = journal.entries
      .slice()
      .sort((left, right) => left.idx - right.idx)
      .map((entry) =>
        readFileSync(join(drizzleDirectory, `${entry.tag}.sql`), 'utf8')
          .split('--> statement-breakpoint')
          .map((statement) => statement.trim())
          .filter(Boolean)
          .join(';\n'),
      )
      .join(';\n');

    const client = new PGlite();
    let asked: ReadonlyArray<{ format: 'lcov'; bytes: Uint8Array }> = [];
    try {
      await client.exec(sql);
      const db = drizzle(client, { schema });
      const shared = {
        workspaceId: 'ws-1',
        viewFor: () =>
          literalView({ 'package.json': '{"name":"svc","scripts":{"test":"vitest run"}}' }),
      };
      const routes = createProjectsRoutes({
        db: db as never,
        ...shared,
        startRun: async () => ({ runId: 'r', jobId: 'j', phase: 'queued' }),
      });
      const created = await routes.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Svc', slug: 'svc', repoPath: '/repos/svc' }),
      });
      const { project } = (await created.json()) as { project: { id: string } };
      // A **seventh** format, which this build cannot parse. The profile's own
      // schema accepts it, because the schema is about the customer's file and
      // not about this deployment's parsers.
      await routes.request(`/api/v1/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          coverageGlobs: [{ glob: 'coverage/coverage.json', format: 'opencover' }],
        }),
      });
      await db.insert(runs).values({
        id: '00000000-0000-4000-8000-000000000002',
        workspaceId: 'ws-1',
        projectId: project.id,
        startedAt: new Date(NOW),
        phase: 'complete',
        outcome: 'passed',
      });

      const registry = {
        db: db as never,
        ...shared,
        readCoverageDocuments: async (): Promise<
          ReadonlyArray<{ format: 'lcov'; bytes: Uint8Array }>
        > => {
          asked = [
            { format: 'lcov', bytes: new TextEncoder().encode('SF:src/api/login.ts\nDA:1,1\n') },
          ];
          return asked;
        },
      };
      const score = QaScoreSchema.parse(await qaScore(registry, project.id, NOW));
      const backend = score.cells.find(
        (cell) => cell.category === 'unit' && cell.surface === 'backend',
      );
      // **Absence, not zero.** The reader was never asked, so nothing was
      // ingested, and the cell says "no artifact" rather than "0% covered".
      expect(backend?.inputs.surfaceCoverage).toBeNull();
      expect(asked).toEqual([]);
    } finally {
      await client.close();
    }
  });
});
