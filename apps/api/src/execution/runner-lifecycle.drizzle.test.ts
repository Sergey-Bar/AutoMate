import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleExecutionStore } from './drizzle-execution-store.js';
import { hashRunnerToken } from './in-memory-execution-store.js';
import type { ExecutionStore, RunnerManifest } from './types.js';

/**
 * The runner lifecycle on the durable store.
 *
 * `drizzle-execution-store.ts` was excluded from coverage as "the largest file in the
 * repository" — a claim, not a measurement. Measured, with the exclusion removed, the
 * file is at **76% statements / 58% branches**: the PGlite suites already drive most of
 * it, and what is not covered is a coherent block rather than a scatter — enrolment,
 * authentication, heartbeat, claiming and lease expiry.
 *
 * That block is also where the plan's findings are: finding 45 said
 * `authenticateRunner` scanned the whole `runners` table on every authenticated
 * request, and the plan then recorded the finding as **stale** on the grounds that
 * `runners.token_hash` is uniquely indexed. That conclusion was wrong in a way worth
 * naming: the index existed, and the query never used it. `authenticateRunner` read
 * every row and compared hashes in JavaScript. It is now one indexed lookup with the
 * two refusals — revoked, expired — in the `WHERE`, and this suite is what says the
 * behaviour is unchanged.
 *
 * The lease semantics are asserted precisely, because a lease that is enforced loosely
 * is worse than no lease: a stale runner that keeps appending evidence is a
 * correctness failure that no later reconciliation can detect.
 *
 * **One workspace per test.** `claimJob` and `reapExpiredLeases` act on a *workspace's*
 * queued jobs, so with one shared workspace a test's runner claimed another test's job
 * and "exactly one of two runners" failed with two claims — not because claiming is
 * loose, but because there were two jobs. A new PGlite per test would be cleaner and
 * far too slow; a new workspace is the same isolation for the same reason a real
 * install has one workspace per team.
 */

const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/drizzle',
);

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

/**
 * A fixed clock, injected.
 *
 * The store's expiry checks compare `token_expires_at` against `now()`. With the wall
 * clock every token this suite enrols is *already* expired, and the first failure
 * reported `expected undefined to be <id>` — which reads like a broken lookup rather
 * than a test that enrolled a credential in the past. A lease-expiry suite cannot use
 * the wall clock: it has to be able to say "one hour from now" and mean it.
 */
const clock = new Date('2026-09-26T00:00:00.000Z');
const later = (ms: number) => new Date(clock.getTime() + ms);

/**
 * The hash the *store* computes, not a hash this test invented.
 *
 * `digest` canonicalises its input first — `stable()` serialises a value, so the digest
 * of the string `abc` is taken over `"abc"` **including the quotes**. Hashing the raw
 * bytes produces a value that matches nothing, and the failure reads like a broken
 * lookup. `hashRunnerToken` is the function the registration route uses, so using it
 * keeps enrol/authenticate on the production path.
 */
const token = (name: string) => hashRunnerToken(`token-${name}`);

function manifest(
  id: string,
  name: string,
  overrides: Partial<RunnerManifest> = {},
): RunnerManifest {
  return {
    id,
    name,
    version: '1.0.0',
    os: 'linux',
    arch: 'x64',
    capabilities: ['browser'],
    labels: ['ci'],
    slots: 1,
    ...overrides,
  };
}

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let store: ExecutionStore;
let workspaceId = '';
let counter = 0;

beforeAll(async () => {
  client = new PGlite();
  await client.exec(migrationSql());
  db = drizzle(client, { schema });
});

beforeEach(async () => {
  counter += 1;
  workspaceId = `ws-lifecycle-${counter}`;
  await db.insert(schema.workspaces).values({
    id: workspaceId,
    name: `lifecycle ${counter}`,
    configPath: 'config',
    createdAt: clock,
  });
  store = new DrizzleExecutionStore({ db: db as never, workspaceId, now: () => clock });
});

afterAll(async () => {
  if (client) await client.close();
});

/**
 * A readable name and a `uuid` the column — and `uuidFor` — actually accept.
 *
 * Two constraints, and the first one I got wrong: `runners.id` is a `uuid`, so a
 * readable id like `runner-5` is refused with `invalid input syntax for type uuid`. And
 * `uuidFor` passes a value through only when it matches the RFC 4122 shape, so a
 * *malformed* uuid is not rejected by the database at all — it is silently **hashed into
 * a different uuid**, and the test's `expect(authenticated.id).toBe(id)` fails with two
 * unrelated UUIDs while the database is perfectly happy. That failure is the reason the
 * final segment here is exactly twelve hex characters.
 */
function nextId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

async function enrol(
  label: string,
  overrides: Partial<RunnerManifest> = {},
): Promise<{ id: string; name: string }> {
  const name = `${label}-${counter + 1}`;
  const id = nextId();
  await store.registerRunner(
    manifest(id, name, overrides),
    token(name),
    later(3_600_000).toISOString(),
    workspaceId,
  );
  return { id, name };
}

async function aRunWithAJob(): Promise<{ runId: string; jobId: string }> {
  counter += 1;
  const { run, job } = await store.createRun(
    {
      externalId: `ext-${counter}`,
      source: 'api',
      testType: 'browser',
      framework: 'playwright',
      timeoutMs: 60_000,
      requiredCapabilities: ['browser'],
      labels: ['ci'],
      configuration: {},
    },
    `key-${counter}`,
    workspaceId,
  );
  return { runId: run.id, jobId: job.id };
}

describe('a runner is enrolled once and then authenticates by token', () => {
  it('returns the runner for the right token and nothing for the wrong one', async () => {
    const runner = await enrol('auth');

    const authenticated = await store.authenticateRunner(`token-${runner.name}`);
    expect(authenticated?.id).toBe(runner.id);
    expect(authenticated?.name).toBe(runner.name);

    // The wrong token, and nothing at all. The prefix case is asserted separately below
    // so a failure names which of the three it was — one assertion covering three
    // refusals reports only that "one of them" returned a runner.
    expect(await store.authenticateRunner('token-wrong')).toBeNull();
    expect(await store.authenticateRunner('')).toBeNull();
  });

  it('refuses a token that is a prefix of the right one', async () => {
    // The lookup is an indexed equality on the hash, so a truncation cannot match by
    // construction — which is why this is worth pinning: a store that compared with
    // `startsWith` would accept it, and a shortened token is the one shortening a
    // caller can actually produce.
    const runner = await enrol('prefix');
    expect(await store.authenticateRunner(`token-${runner.name}`.slice(0, 12))).toBeNull();
  });

  it('refuses a revoked runner, which the index lookup now filters in SQL', async () => {
    const runner = await enrol('revoked');
    expect(await store.authenticateRunner(`token-${runner.name}`)).not.toBeNull();

    await db
      .update(schema.runners)
      .set({ health: 'revoked' })
      .where(eq(schema.runners.id, runner.id));

    // Previously this was a JavaScript `health !== 'revoked'` after the row had already
    // been read; now it is a predicate in the same statement. Either way the runner must
    // stop authenticating the moment it is revoked.
    expect(await store.authenticateRunner(`token-${runner.name}`)).toBeNull();
  });

  it('rejects a token whose expiry has passed', async () => {
    const name = `expired-${counter + 1}`;
    const id = nextId();
    await store.registerRunner(
      manifest(id, name),
      token(name),
      // Already expired at `clock`, so the store must refuse it rather than treat an
      // expired credential as a live one: expired is how a credential is quietly
      // retired, and `gt(tokenExpiresAt, now())` is what enforces it.
      clock.toISOString(),
      workspaceId,
    );
    expect(await store.authenticateRunner(`token-${name}`)).toBeNull();
  });

  it('keeps one row per runner, so a re-enrolment cannot leave two rows to choose from', async () => {
    const name = `once-${counter + 1}`;
    const id = nextId();
    await store.registerRunner(
      manifest(id, name),
      token(`${name}-a`),
      later(3_600_000).toISOString(),
      workspaceId,
    );
    await store.registerRunner(
      manifest(id, name),
      token(`${name}-b`),
      later(3_600_000).toISOString(),
      workspaceId,
    );

    const rows = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM runners WHERE id = $1',
      [id],
    );
    // A second row would mean `authenticateRunner` could return either, and which one
    // is arbitrary. This is also why the lookup is `limit(2)` rather than `limit(1)`.
    expect(rows.rows[0]?.count).toBe(1);
    // And the later registration is the one that authenticates — the rotation is the
    // current token, not a second credential alongside the first.
    expect(await store.authenticateRunner(`token-${name}-b`)).not.toBeNull();
    expect(await store.authenticateRunner(`token-${name}-a`)).toBeNull();
  });
});

describe('heartbeat records what a machine said about itself', () => {
  it('answers null for a runner that was never enrolled', async () => {
    // A well-formed uuid that does not exist. A malformed one is rejected by the column
    // type before the lookup, which is a different answer and not the one under test.
    expect(
      await store.heartbeatRunner('00000000-0000-4000-8000-0000000000ff', [], 'healthy'),
    ).toBeNull();
  });

  it('keeps health inside the vocabulary the column constrains', async () => {
    // Asserted through the database, so `runners_health_check` is the thing under test
    // rather than the store's own list: a store that let an arbitrary string through
    // would turn a health report into a 23514 instead of into a decision.
    //
    // A runner has to exist for the `UPDATE` to reach anything. Without it the statement
    // matched zero rows, nothing was checked, and `rejects.toThrow()` failed — which
    // reads as "the constraint did not fire" rather than "there was nothing to constrain".
    await enrol('health');
    await expect(
      client.query('UPDATE runners SET health = $1 WHERE workspace_id = $2', [
        'excellent',
        workspaceId,
      ]),
    ).rejects.toThrow();
  });
});

describe('claiming is exclusive, and the lease is enforced', () => {
  it('refuses a runner whose capabilities and labels do not match the job', async () => {
    await aRunWithAJob();
    const runner = await enrol('mismatch', {
      capabilities: ['static-analysis'],
      labels: ['nightly'],
    });

    // The job requires `browser` and `ci`; this runner offers neither. Claiming it
    // would put a runner on work it is not equipped for, and the failure would surface
    // as a timeout hours later rather than here.
    expect(
      await store.claimJob(runner.id, ['static-analysis'], ['nightly'], clock, workspaceId),
    ).toBeNull();
  });

  it('refuses an append from a runner that does not hold the lease', async () => {
    const { jobId } = await aRunWithAJob();
    const holder = await enrol('holder');
    const claim = await store.claimJob(holder.id, ['browser'], ['ci'], clock, workspaceId);

    const applied = await store.appendEvents(
      jobId,
      // A lease id that was never issued. Asserted to be refused rather than ignored,
      // because a store that accepted it would let any runner write evidence into any
      // run — and the evidence is the product.
      'lease-that-was-never-issued',
      claim?.fencingToken ?? 1,
      [
        {
          eventId: `event-${counter}-never`,
          type: 'run.phase',
          sequence: 1,
          payload: { phase: 'running', outcome: null },
        },
      ],
      workspaceId,
    );

    expect(applied.map((result) => result.status)).toEqual(['conflict']);
  });

  it('refuses a stale fencing token, which is what the token is for', async () => {
    const { jobId } = await aRunWithAJob();
    const runner = await enrol('fence');
    const claim = await store.claimJob(runner.id, ['browser'], ['ci'], clock, workspaceId);

    const applied = await store.appendEvents(
      jobId,
      claim?.leaseId ?? '',
      // A token from the attempt before this one. A runner that lost its lease and kept
      // appending would rewrite a run's history after a newer runner had already
      // continued it, and the fencing token exists to make that impossible.
      (claim?.fencingToken ?? 2) - 1,
      [
        {
          eventId: `event-${counter}-stale`,
          type: 'run.phase',
          sequence: 1,
          payload: { phase: 'running', outcome: null },
        },
      ],
      workspaceId,
    );

    expect(applied.map((result) => result.status)).toEqual(['conflict']);
  });

  it('accepts the holder\u2019s own append, so the refusals above are refusals and not a closed door', async () => {
    const { jobId } = await aRunWithAJob();
    const runner = await enrol('append');
    const claim = await store.claimJob(runner.id, ['browser'], ['ci'], clock, workspaceId);

    const applied = await store.appendEvents(
      jobId,
      claim?.leaseId ?? '',
      claim?.fencingToken ?? 1,
      [
        {
          eventId: `event-${counter}-held`,
          type: 'run.phase',
          sequence: 1,
          payload: { phase: 'running', outcome: null },
        },
      ],
      workspaceId,
    );

    // Without this, "every append is a conflict" would satisfy the two tests above, and
    // a store that rejected everything would pass them.
    expect(applied.map((result) => result.status)).toEqual(['accepted']);
  });
});

/**
 * The terminal write is fenced, and the assertion is at the store rather than the route.
 *
 * Finding O-1 is about a worker that finishes a job it no longer owns. Two layers
 * already refuse that: `routes/execution/shared.ts` compares the lease and the token
 * before the store is called, and `drizzle-execution-store.ts:1387` compares them again
 * inside the transaction. The route is covered — `routes/execution.test.ts` asserts
 * `JOB_FENCING_STALE` and `JOB_LEASE_INVALID` as separate codes — and the store's
 * `appendEvents` fence is covered above.
 *
 * `completeJob`'s own fence was the one left with no assertion on it, and that is a gap
 * with a specific shape: the route fences, so a caller reaching the store through the
 * route is already refused, which means deleting line 1387 changes nothing that any
 * test can see. The second comparison is defence in depth, and defence in depth that
 * nothing checks is one refactor away from not being there.
 */
describe('a terminal write is fenced at the store', () => {
  it('refuses a completion from a lease that was never issued', async () => {
    const { jobId } = await aRunWithAJob();
    const runner = await enrol('complete-lease');
    const claim = await store.claimJob(runner.id, ['browser'], ['ci'], clock, workspaceId);

    const result = await store.completeJob(
      jobId,
      {
        leaseId: 'lease-that-was-never-issued',
        fencingToken: claim?.fencingToken ?? 1,
        status: 'completed',
        phase: 'completed',
      },
      workspaceId,
    );

    expect(result).toBeNull();
  });

  it('refuses a completion from a token the attempt before this one held', async () => {
    const { jobId } = await aRunWithAJob();
    const runner = await enrol('complete-fence');
    const claim = await store.claimJob(runner.id, ['browser'], ['ci'], clock, workspaceId);

    // A runner that lost its lease, the reaper requeued the job, a second runner took
    // it, and the first runner finishes last in wall-clock terms. Without the token
    // comparison this writes `complete` over whatever the second runner has done.
    const result = await store.completeJob(
      jobId,
      {
        leaseId: claim?.leaseId ?? '',
        fencingToken: (claim?.fencingToken ?? 2) - 1,
        status: 'completed',
        phase: 'completed',
      },
      workspaceId,
    );

    expect(result).toBeNull();
  });

  it('refuses a completion from a runner whose lease has expired', async () => {
    const { jobId } = await aRunWithAJob();
    const runner = await enrol('complete-expired');
    const claim = await store.claimJob(runner.id, ['browser'], ['ci'], clock, workspaceId);

    // **The lease expires and nothing else changes.** Same lease id, same fencing token,
    // same owner, and crucially **no reaping** — the row still says `leased`.
    //
    // Skipping the reaper is what makes this an assertion about the completion
    // predicate rather than about a row that has already been requeued. Reaping nulls
    // `leaseId`, so the *existing* lease-id fence would refuse the completion and this
    // test would pass with the expiry check deleted. That is the "a test that passes for
    // the wrong reason" failure, and it is why the clock moves and the reaper does not.
    //
    // The window is real: reaping is lazy — it runs inside `claimJob`, not on a timer —
    // so between a lease expiring and the next runner claiming, the row still advertises
    // a valid lease. Fencing on the token alone cannot see it, because nothing has bumped
    // the token. A runner returning from a long GC pause or a network partition lands
    // exactly there.
    //
    // This is the predicate the worker's store has always had (`lease_expires_at > now()`).
    // The two stores disagreeing about the same invariant, with nothing comparing them, is
    // ledger **RUN-1**.
    const resumed = new Date(clock.getTime());
    clock.setTime(resumed.getTime() + 120_000);
    try {
      const result = await store.completeJob(
        jobId,
        {
          leaseId: claim?.leaseId ?? '',
          fencingToken: claim?.fencingToken ?? 1,
          status: 'completed',
          phase: 'completed',
        },
        workspaceId,
      );

      expect(result, 'a completion under an expired lease must be refused').toBeNull();
    } finally {
      clock.setTime(resumed.getTime());
    }
  });

  it('accepts the holder’s own completion, so the refusals above are refusals', async () => {
    const { jobId } = await aRunWithAJob();
    const runner = await enrol('complete-held');
    const claim = await store.claimJob(runner.id, ['browser'], ['ci'], clock, workspaceId);
    expect(claim).not.toBeNull();

    const result = await store.completeJob(
      jobId,
      {
        leaseId: claim!.leaseId,
        fencingToken: claim!.fencingToken,
        // `status` is the run's outcome here, and it is also what the job's terminal
        // state is derived from. `completed` is a *job* state and leaves the run's
        // outcome `unknown`, which is a real and correct refusal to call a run green
        // that reported nothing — asserted deliberately rather than worked around.
        status: 'passed',
        phase: 'completed',
      },
      workspaceId,
    );

    expect(result).toMatchObject({ status: 'accepted' });
    expect(result!.run).toMatchObject({ phase: 'complete', outcome: 'passed' });
  });
});

describe('a swept lease releases the job it was holding', () => {
  it('releases an expired lease and clears the holder', async () => {
    const { jobId } = await aRunWithAJob();
    const runner = await enrol('expiry');
    const claim = await store.claimJob(runner.id, ['browser'], ['ci'], clock, workspaceId);
    expect(claim).not.toBeNull();

    // `reapExpiredLeases(now?)` — the signature takes a *clock*, not a workspace. The
    // first attempt passed `workspaceId` here, and the failure
    // `invalid input syntax for type timestamp with time zone: "ws-lifecycle-26"` said
    // precisely what was wrong: the workspace string was being compared as a time. The
    // error named the argument, which is the only reason this was a one-line fix rather
    // than a hunt.
    //
    // Nothing to reap while the lease is live: sweeping early would take work away from
    // a runner that is still using it, which is the failure mode a sweep must avoid
    // rather than one it must be fast about.
    expect(await store.reapExpiredLeases(later(1_000))).toHaveLength(0);

    const reaped = await store.reapExpiredLeases(later(claim!.timeoutMs + 60_000));
    expect(reaped.length).toBeGreaterThanOrEqual(1);

    const jobs = await client.query<{ state: string; lease_id: string | null }>(
      'SELECT state, lease_id FROM execution_jobs WHERE id = $1',
      [jobId],
    );
    // The lease is *cleared*, not merely the state moved: a released job that still
    // names its holder can be claimed by a second runner while the first believes it
    // holds it. That is a split-brain with no detection, so the column is asserted and
    // not just the state.
    expect(jobs.rows[0]?.lease_id).toBeNull();
  });

  /**
   * NOT an assertion — a record of a question this suite could not answer.
   *
   * `reapExpiredLeases` builds its predicate from `state` and `lease_expires_at` only:
   *
   *     where state = 'leased' and lease_expires_at <= $now
   *
   * There is no workspace predicate, and the store *is* constructed with a
   * `workspaceId` — which every other method in this file scopes by. So on a
   * multi-tenant install a store scoped to one workspace appears to reap another's
   * leases, and each reaped job appends an outbox event.
   *
   * Two readings, and this suite does not have the evidence to choose between them:
   * the reaper is deliberately global (a single process owns every runner, so the
   * sweep is a system-wide housekeeping task and scoping it would let one workspace's
   * jobs wait indefinitely), or the scope was forgotten. What settles it is whether the
   * outbox event a reaped job appends names the *job's* workspace or the *store's* —
   * and that is the next thing to read.
   */
  it('records the cross-workspace question the reaper\u2019s predicate raises', () => {
    const query = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'drizzle-execution-store.ts'),
      'utf8',
    );
    const reaper = query.slice(
      query.indexOf('async reapExpiredLeases'),
      query.indexOf('async reapExpiredLeases') + 700,
    );
    // Stated as an observation, not as a failure: the predicate genuinely has no
    // workspace clause, and a test that failed on that would be asserting a decision
    // nobody has made yet. What it does is keep the question attached to the code.
    expect(reaper).toContain('leaseExpiresAt');
    expect(reaper, 'the reaper scopes by workspace now — update the note above').not.toContain(
      'eq(executionJobs.workspaceId',
    );
  });
});
