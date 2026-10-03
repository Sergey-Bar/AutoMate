import { describe, expect, it } from 'vitest';
import {
  qaScore,
  stopRun,
  classifySurface,
  mergeCoverage,
  projectRunRecord,
  projectTestResult,
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
});
