import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostgresExecutionStore } from './postgres-store.js';
import type { JobCompletion, JobResultStatus } from './types.js';

/**
 * `completeJob` writes three `runs` columns from one status: `phase`, `outcome`
 * and `status`. The database constrains all three, and `runs_phase_outcome_check`
 * couples the first two — a run is terminal exactly when its outcome is not null.
 *
 * So writing the three independently is a defect the database refuses, on a path
 * with no handler in production (`main.ts` passes none), which is how it survived:
 * the API found and fixed this exact class in `deriveRunState` and the worker never
 * got the fix, because nothing compared the two.
 *
 * These assertions read the CHECK out of the migration rather than restating it.
 * A test comparing the write against a list written beside it passes while the
 * database rejects every value.
 */

const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/drizzle',
);

/** The `in (...)` list of a named CHECK constraint, read from the last migration naming it. */
function checkValues(name: string): Set<string> {
  const files = readdirSync(drizzleDirectory)
    .filter((entry) => entry.endsWith('.sql'))
    .sort();
  let body: string | undefined;
  for (const file of files) {
    const source = readFileSync(path.join(drizzleDirectory, file), 'utf8');
    const match = new RegExp(`ADD CONSTRAINT "${name}"\\s+CHECK\\s*\\(([\\s\\S]*?)\\);`).exec(
      source,
    );
    if (match?.[1] !== undefined) body = match[1];
  }
  if (body === undefined) throw new Error(`${name} not found in migrations`);
  const values = new Set<string>();
  for (const match of body.matchAll(/'([^']+)'/g)) {
    const value = match[1];
    if (value !== undefined) values.add(value);
  }
  if (values.size === 0) throw new Error(`${name} declares no values`);
  return values;
}

/** The terminal phases `runs_phase_outcome_check` names. */
const terminalPhases = (): Set<string> => checkValues('runs_phase_outcome_check');

/** The statuses `runs_status_check` permits. */
const persistedStatuses = (): Set<string> => checkValues('runs_status_check');

/**
 * Every status the worker can name.
 *
 * `'requeue'` is **not** in `JobCompletion['status']` — `worker.ts` routes it to
 * `releaseJob` instead — but it is in `JobResultStatus`, it is what
 * `worker.execute` computes before that branch, and it is the one member the old
 * fallthrough turned into a pair the CHECK rejects. It is driven here by an
 * explicit widening so the day someone widens the type instead of branching, the
 * violation is already covered.
 */
const WORKER_RESULT_STATUSES: readonly JobResultStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'infra_failed',
  'config_failed',
  'runner_lost',
  'requeue',
];

/** The parameters `completeJob` sent to its `UPDATE runs`. */
interface RunsWrite {
  phase: unknown;
  outcome: unknown;
  status: unknown;
}

/**
 * Runs `completeJob` against a stubbed pool and returns the `runs` write.
 *
 * The pool is stubbed at the prototype: the store builds its own `pg.Pool` from a
 * connection string and `pg` connects lazily, so no socket is opened.
 */
async function runsWriteFor(status: JobResultStatus): Promise<RunsWrite> {
  const sends: RunsWrite[] = [];
  const client = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      if (/UPDATE execution_jobs/.test(text)) return { rows: [{ run_id: 'run-1' }], rowCount: 1 };
      if (/UPDATE runs/.test(text)) {
        const values = (params ?? []) as unknown[];
        sends.push({ phase: values[1], outcome: values[2], status: values[3] });
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  vi.spyOn(pg.Pool.prototype, 'connect').mockResolvedValue(client as never);

  // The widening is deliberate and explicit: `'requeue'` is typed out of
  // `JobCompletion`, which is the type system doing its job. The store's fold is
  // a total function over `JobResultStatus` regardless, and this is what proves
  // it — the day someone widens the type instead of branching in `worker.execute`,
  // the assertion is already here.
  const completion = { leaseId: 'lease-1', fencingToken: 1, status } as unknown as JobCompletion;
  const completed = await new PostgresExecutionStore('postgres://unused/unused').completeJob(
    'job-1',
    completion,
  );
  expect(completed, `${status} did not complete the job`).toBe(true);
  const write = sends.at(-1);
  if (!write) throw new Error(`completeJob wrote no runs row for ${status}`);
  return write;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('completeJob writes a run state the database accepts', () => {
  it.each(WORKER_RESULT_STATUSES)(
    'satisfies both runs CHECK constraints for %s',
    async (status) => {
      const write = await runsWriteFor(status);

      // `runs_phase_outcome_check`, stated as the constraint states it: terminal
      // phase iff non-null outcome. `requeue` is where the hand-written table fell
      // through to `{ phase: 'requeue', outcome: 'requeue' }` — a non-terminal
      // phase carrying an outcome, which the database refuses.
      const terminal = terminalPhases();
      const phaseTerminal = typeof write.phase === 'string' && terminal.has(write.phase);
      const hasOutcome = write.outcome !== null && write.outcome !== undefined;
      expect(phaseTerminal, `${status} -> phase ${String(write.phase)}`).toBe(hasOutcome);

      // `runs_status_check`. The hand-written table carried a fourth value,
      // `legacy`, that had to be kept in step with the others by hand; the
      // derivation produces the column-legal status directly.
      const allowed = persistedStatuses();
      expect(typeof write.status, `${status} wrote a non-string status`).toBe('string');
      expect(allowed.has(String(write.status)), `${status} -> status ${String(write.status)}`).toBe(
        true,
      );
    },
  );

  it('does not treat a cancelled job as a passing run', async () => {
    const write = await runsWriteFor('cancelled');
    expect(write.phase).toBe('cancelled');
    expect(write.outcome).toBe('cancelled');
    expect(write.status).not.toBe('passed');
  });

  it('does not treat an unfinished job as a passing run', async () => {
    // The pair the old fallthrough produced: a non-terminal phase carrying an
    // outcome, which is the injection vector in the worker's own vocabulary.
    for (const status of ['timed_out', 'infra_failed', 'config_failed', 'runner_lost'] as const) {
      const write = await runsWriteFor(status);
      const terminal = terminalPhases();
      const phaseTerminal = typeof write.phase === 'string' && terminal.has(write.phase);
      expect(phaseTerminal, `${status} -> phase ${String(write.phase)}`).toBe(
        write.outcome !== null && write.outcome !== undefined,
      );
      expect(write.outcome, `${status} named an outcome`).toBe(status);
    }
  });
});
