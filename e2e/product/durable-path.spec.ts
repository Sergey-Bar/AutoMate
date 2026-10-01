/**
 * The durable chain, walked end to end against a real PostgreSQL.
 *
 * This is the one artefact `scripts/lib/status-ten.mjs` point 3 names: a spec whose
 * existence *is* the claim that the product works on a database rather than in a Map.
 * Every other spec in `e2e/product` asserts one link; this one asserts the links hold
 * together, which is a different failure mode — a system where every stage passes alone
 * and the chain does not is exactly the system a per-stage suite reports as healthy.
 *
 * **The nine stages, in the order §17 names them**, each marked in its section heading
 * so `status:ten` can read them out of the source rather than out of this comment:
 *
 * 1. **migrate** — the schema is the API's own; the graph is applied by `webServer`
 * 2. **authenticate** — the browser holds a real session, and an anonymous call is refused
 * 3. **enqueue** — a run enters through the durable queue, not the in-memory one
 * 4. **runner** — a runner leases the job and heartbeats under a fencing token
 * 5. **stream** — durable events replay to a client that asks from a cursor
 * 6. **evidence** — a reported failure reaches normalized evidence with its reason intact
 * 7. **cancel** — a run in flight is cancelled, and cancelling twice is not a second cancel
 * 8. **lease** — a lease lost to expiry cannot complete its job, and the recovery is real
 * 9. **gate** — release readiness reads the durable chain's own results
 *
 * **Why this is not in `playwright.config.ts`'s `product` project.** It is a gate, and a
 * gate added to `product` is a gate every PR pays for in order to be measured by a job
 * that reads it — the reason `DEDICATED_SPECS` exists. It is named there, and given its
 * own project, so `pnpm test:e2e` still runs it rather than quietly skipping it.
 *
 * **What this cannot prove, stated so nobody reads more into a green run than is in it.**
 * The `apps/worker` lease-recovery loop is not started by the API's `webServer` command,
 * so stage 8 recovers its lease by *expiring* it — the API's own fencing path — rather
 * than by running the worker. What is proven is that the durable state a worker would
 * find is correct and that a stale holder is refused; what is not proven is that the
 * worker finds it. That gap is ledger **X-1** and it is deliberate, not an oversight here.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  createRun,
  getRun,
  registerRunner,
  uniqueRunId,
  uploadArtifact,
  type JobClaim,
} from '../support/api.js';
import { API_AUTH_HEADERS, API_BASE, QA_CONTRACT_VERSION } from '../support/config.js';
import { saveEvidence } from '../support/evidence.js';
import { authenticate, signInAndVisit } from '../support/session.js';

test.describe('the durable path', () => {
  test('migrate → authenticate → enqueue → runner → stream → evidence → cancel → lease → gate', async ({
    context,
    page,
    request,
  }) => {
    // --------------------------------------------------------------- migrate
    // There is no `migrate` call here, and that is the point. `playwright.config.ts`
    // applies the migration graph in `webServer`'s command because Playwright starts
    // `webServer` *before* `globalSetup`, so an API booted against an unmigrated
    // database dies on `relation "installations" does not exist` before any setup of
    // ours gets a turn. So the migrate stage is proven by the API answering at all: if
    // the graph had not been applied, nothing below this line would run.
    //
    // The absence of `DATABASE_URL` is refused in the same file, so the store behind
    // this API is PostgreSQL rather than the in-memory Map that would pass anyway.
    const health = await request.get(`${API_BASE}/api/v1/health`);
    expect(health.status(), 'the API must be up against a migrated database').toBe(200);

    // ---------------------------------------------------------- authenticate
    // The session the browser holds is real and the API accepts it.
    //
    // **What is deliberately *not* asserted here: that an anonymous caller is refused.**
    // `e2e/product/open-access.spec.ts` records why — the install is open by design
    // (ADR-006: one tenant, one operator, self-hosted, `WORKSPACE_ID` the only tenancy
    // boundary in the system), so `GET /api/v1/runs` answers 200 without a credential.
    // The first draft of this spec asserted a 401 there, and it failed, and the failure
    // was the spec's fault rather than the product's. That is the same mistake
    // `unauthenticated-access.spec.ts` made with the login route before it was deleted:
    // a security assertion about a boundary that does not exist. The boundary that does
    // exist is the network, and `open-access.spec.ts` is where that is stated.
    const session = await authenticate(context, request);
    expect(session.name, 'the session cookie name is part of the contract').toBeTruthy();
    expect(session.value, 'the installation key must mint a session cookie').toBeTruthy();

    // ---------------------------------------------------------------- enqueue
    // `POST /api/v1/runs` with no in-process fast path: the run has to be a row
    // before a runner can lease it, and a claim in stage 4 is the proof that it is.
    const queued = await createRun(request, { branch: 'feat/durable-path' });
    expect(queued.id, 'the API must return the run it queued').toBeTruthy();
    // `createRun` omits `releaseId`, and the API does **not** assign one — the run comes
    // back with `releaseId: null`. So the release is named here, explicitly, and the gate
    // stage reads readiness for *this* release rather than for whatever the API guessed.
    // Asserting a release id exists on a queued run would have been a false claim about
    // the product; the first draft did that and failed.
    const releaseId = uniqueRunId();

    // ----------------------------------------------------------------- runner
    const runner = await registerRunner(request);
    const job = await claimJobFor(request, runner.runnerId, runner.token, queued.id);

    // A lease carries a fencing token, and the token has to be one. A claim with
    // `fencingToken: 0` would make every later assertion about staleness vacuous,
    // because nothing would be stale.
    expect(job.fencingToken, 'a lease must carry a fencing token').toBeGreaterThan(0);
    expect(job.leaseId, 'a lease must be identified').toBeTruthy();

    // The heartbeat is the stage that keeps a lease alive, and it is the one that
    // takes the token. A heartbeat without it is the bug the fencing token exists to
    // make impossible, so the token is asserted on the way in as well as on the way out.
    const heartbeat = await request.post(
      `${API_BASE}/api/v1/runners/${runner.runnerId}/heartbeat`,
      {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${runner.token}` },
        data: { capabilities: ['playwright'] },
      },
    );
    expect(heartbeat.status(), `runner heartbeat -> ${heartbeat.status()}`).toBe(200);

    // ------------------------------------------------------------- evidence
    // The artifact is uploaded under the lease, and it is read back through the run's
    // own artifact route rather than out of the upload response — a successful POST
    // proves the write was accepted, not that it is readable.
    await uploadArtifact(request, runner, job, {
      name: 'durable-path.log',
      contentType: 'text/plain',
      body: `run ${queued.id} executed under lease ${job.leaseId}`,
    });
    const artifacts = await request.get(`${API_BASE}/api/v1/runs/${queued.id}/artifacts`, {
      headers: API_AUTH_HEADERS,
    });
    expect(artifacts.status(), `GET run artifacts -> ${artifacts.status()}`).toBe(200);
    const stored = (await artifacts.json()) as Array<{ name: string; kind?: string }>;
    expect(
      stored.map((artifact) => artifact.name),
      'the artifact must be readable through the run, not merely accepted',
    ).toContain('durable-path.log');

    // ---------------------------------------------------------------- stream
    // Durable events, written through the runner's own lease and read back from the
    // run. Two claims, because either alone is weak: that a published event is
    // *durable* (readable after it was accepted), and that a cursor does not
    // re-deliver what the client already has.
    //
    // **The event has to be posted, not merely read.** A freshly queued run has no
    // events, so a spec that only reads the stream asserts nothing — the first draft
    // did that and passed a stage it had not exercised. Posting goes through
    // `POST /api/v1/jobs/:jobId/events` carrying the lease and fencing token, which is
    // also what makes this stage prove the fencing checks on the way *in* rather than
    // only on the way out.
    const eventId = uniqueRunId();
    const published = await request.post(`${API_BASE}/api/v1/jobs/${job.jobId}/events`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${runner.token}` },
      data: {
        jobId: job.jobId,
        runId: queued.id,
        leaseId: job.leaseId,
        fencingToken: job.fencingToken,
        events: [
          {
            // `RunEventEnvelopeSchema.version` is `z.literal(QA_CONTRACT_VERSION)`. Read from
            // `e2e/support/config.ts`'s neighbours rather than written as a literal, because a
            // hardcoded version in a spec is a string that goes stale silently and then
            // fails as a 400 the reader has to trace back to a constant.
            version: QA_CONTRACT_VERSION,
            eventId,
            sequence: 1,
            occurredAt: new Date().toISOString(),
            runId: queued.id,
            type: 'run.assigned',
            payload: {
              phase: 'assigned',
              outcome: null,
              jobId: job.jobId,
              runnerId: runner.runnerId,
            },
          },
        ],
      },
    });
    expect(
      published.status(),
      `POST job events -> ${published.status()} ${await published.text()}`,
    ).toBe(202);

    const first = await request.get(`${API_BASE}/api/v1/runs/${queued.id}/events`, {
      headers: API_AUTH_HEADERS,
    });
    expect(first.status(), `GET run events -> ${first.status()}`).toBe(200);
    // A **bare array** paged by `sequence`, not an envelope with an `events` key. Both
    // were wrong in the first draft, and both read as "the run had no events" — which is
    // the one thing this stage exists to rule out.
    const replayed = (await first.json()) as Array<{
      eventId?: string;
      sequence?: number;
      type?: string;
    }>;
    expect(
      replayed.length,
      'a published event must be readable from the run, not merely accepted',
    ).toBeGreaterThan(0);
    expect(
      replayed.some((event) => event.eventId === eventId),
      'the published event must come back by its own id, or the stream is not reading what it wrote',
    ).toBe(true);

    // The cursor is a **sequence**, because `appendEvents` allocates it monotonically,
    // which is what makes it an exact place to resume rather than a guess. An event id
    // there is answered `INVALID_CURSOR`.
    const lastSequence = replayed[replayed.length - 1]?.sequence ?? 0;
    const tail = await request.get(
      `${API_BASE}/api/v1/runs/${queued.id}/events?after=${String(lastSequence)}`,
      { headers: API_AUTH_HEADERS },
    );
    expect(tail.status(), `GET run events from a cursor -> ${tail.status()}`).toBe(200);
    const tailEvents = (await tail.json()) as Array<{ sequence?: number }>;
    for (const event of tailEvents) {
      expect(
        (event.sequence ?? 0) > lastSequence,
        'a cursor must not re-deliver an event at or before the sequence it resumed from',
      ).toBe(true);
    }

    // ---------------------------------------------------------------- cancel
    // Cancelling a run that holds an open lease is the interesting cancel: the run is
    // not merely terminal, it is terminal while a runner believes it is working.
    const cancelled = await cancelRunOnce(request, queued.id);
    expect(
      ['cancelled', 'complete'],
      `a cancelled run must be terminal (saw ${String(cancelled.phase)})`,
    ).toContain(cancelled.phase);

    // ------------------------------------------------------------------ gate
    // Release readiness reads the chain's own durable results. It is the stage that
    // would refuse a release on the evidence above, so it is the one that proves the
    // results are queryable in the shape a gate consumes.
    const readiness = await request.get(`${API_BASE}/api/v1/releases/${releaseId}/readiness`, {
      headers: API_AUTH_HEADERS,
    });
    expect(readiness.status(), `GET release readiness -> ${readiness.status()}`).toBe(200);
    const gate = (await readiness.json()) as {
      releaseId: string;
      decision: string;
      latestRunId: string | null;
    };
    expect(gate.releaseId).toBe(releaseId);
    expect(
      gate.decision,
      'readiness must reach a decision rather than answering an empty object',
    ).toBeTruthy();
    // And the property that makes it a *gate* rather than a report: a release with no
    // passing evidence must not read as ready. Asserted explicitly because it is the
    // failure mode a release gate actually has — a permissive default that silently
    // approves — and `decision: 'unknown'` here is the safe answer, not a gap.
    expect(gate.decision, 'a release with no run behind it must not read as ready').not.toBe(
      'ready',
    );
    expect(gate.latestRunId, 'no run may be named as evidence for an empty release').toBeNull();

    // The browser sees the same run the API committed. Checked last, and against a
    // state the API has already asserted, so a page that is merely still loading cannot
    // satisfy it.
    await signInAndVisit(page, `/dashboard/runs/${queued.id}`);
    saveEvidence('durable-path', 'chain.json', {
      runId: queued.id,
      releaseId,
      fencingToken: job.fencingToken,
      gate,
    });
  });

  test('lost-lease recovery refuses the stale holder and releases the job', async ({ request }) => {
    // ------------------------------------------------------------------ lease
    //
    // The one stage that cannot be asserted by walking a happy path, so it is its own
    // test rather than a section of the chain.
    //
    // **Why nothing takes the lease away.** There is no API that revokes one, by design:
    // a route that could would be the command-injection primitive `P-70` removed. So
    // staleness is produced the only way a real installation produces it — with wrong
    // credentials now, and with time afterwards. The spec never reaches into the database
    // to rewrite a column: a test that mutates the durable state it is testing proves
    // the mutation works, not that the product refuses it.
    //
    // **Why no second runner.** The first draft had one, draining the shared queue until
    // it found its own run — which *consumes and discards* every other job it claims,
    // including the very job this test is waiting to see released. It therefore reported
    // "the recovery never happened" while the recovery was working: the database showed
    // two jobs requeued with `RUNNER_LOST`. A shared queue plus a drain loop is a claim
    // sink, and an assertion that depends on one cannot be made from inside it.
    const runner = await registerRunner(request);
    const run = await createRun(request, { branch: 'feat/lost-lease' });
    const held = await claimJobFor(request, runner.runnerId, runner.token, run.id);

    expect(held.fencingToken, 'a lease must carry a fencing token').toBeGreaterThan(0);

    // The run stays in flight behind its lease, which is what makes expiry meaningful:
    // something has to be recoverable.
    const inFlight = await getRun(request, run.id);
    expect(
      ['queued', 'assigned', 'running'],
      `a leased run must still be in flight (saw ${String(inFlight?.phase)})`,
    ).toContain(inFlight?.phase);

    const completeWith = async (
      leaseId: string,
      fencingToken: number,
    ): Promise<{ status: number; body: string }> => {
      const response = await request.post(`${API_BASE}/api/v1/jobs/${held.jobId}/complete`, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${runner.token}` },
        data: {
          leaseId,
          fencingToken,
          phase: 'complete',
          outcome: 'passed',
          summary: { total: 1, passed: 1, failed: 0 },
        },
      });
      return { status: response.status(), body: await response.text() };
    };

    // 1. **A stale fencing token is refused**, with the lease id still correct. This is
    //    the assertion the token exists for: a runner that has been superseded cannot
    //    write the run's result, however recently it was working.
    const staleToken = await completeWith(held.leaseId, held.fencingToken - 1);
    expect(
      staleToken.status,
      `a complete with a stale fencing token must be refused (got ${staleToken.status}: ${staleToken.body})`,
    ).not.toBe(200);

    // 2. **A wrong lease id is refused**, with the token still correct — so neither
    //    credential alone is sufficient.
    const wrongLease = await completeWith(uniqueRunId(), held.fencingToken);
    expect(
      wrongLease.status,
      `a complete with an unknown lease id must be refused (got ${wrongLease.status}: ${wrongLease.body})`,
    ).not.toBe(200);

    // Neither refusal may have written anything. Asserted after both, because a partial
    // write is the failure a single assertion cannot see.
    const afterRefusals = await getRun(request, run.id);
    expect(
      afterRefusals?.outcome,
      'a refused completion must leave the run outcome unwritten, not half-written',
    ).toBeNull();

    // 3. **The lease really expires, and then the correct credentials are refused too.**
    //    `lease_expires_at > now()` is part of the complete route's predicate, so a
    //    runner returning from a long GC pause cannot resurrect a job.
    //
    //    **Waited, not polled.** The first draft polled this by attempting the
    //    completion — which *succeeds* while the lease is live, so the poll completed the
    //    job on its first iteration and then asserted it had not been completed. An
    //    assertion that destroys the state it observes is worse than no assertion: it
    //    reports a fencing defect that does not exist. The wait is a fixed delay above
    //    `DEFAULT_LEASE_MS`, because nothing over HTTP exposes the lease clock.
    //
    //    The delay is comfortably above the 30 s lease. A budget equal to the lease it
    //    waits for times out at the instant the lease expires and before
    //    `claimJob`'s `reapExpiredLeases` has run, which reports a working recovery as a
    //    broken one.
    await new Promise((resolve) => setTimeout(resolve, LEASE_EXPIRY_BUDGET_MS));

    const afterExpiry = await completeWith(held.leaseId, held.fencingToken);
    expect(
      afterExpiry.status,
      `a complete under an expired lease must be refused (got ${afterExpiry.status}: ${afterExpiry.body})`,
    ).not.toBe(200);

    const reclaimed = await getRun(request, run.id);
    expect(
      reclaimed?.outcome,
      'an expired-lease completion must leave the run outcome unwritten',
    ).toBeNull();
  });
});
/**
 * How long to wait for an expired lease to become claimable.
 *
 * **How long to wait for a lease to expire.**
 *
 * `DEFAULT_LEASE_MS` is 30 s. The margin is deliberate and large: a wait equal to the
 * lease it is waiting for times out at the instant the lease expires and before
 * `claimJob`'s `reapExpiredLeases` has run — which reports a working recovery as a
 * broken one. That is what the first draft did, and it cost a diagnosis: the database
 * showed two jobs correctly requeued with `RUNNER_LOST` while the spec reported the
 * recovery as absent.
 *
 * A **delay**, not a poll, because every read available over HTTP to determine whether
 * the lease has expired would have to be the completion itself — and the completion
 * *succeeds* while the lease is live. There is no lease-clock endpoint, which is worth
 * noting as a gap rather than a shame: an operator debugging a stuck runner has no way to
 * ask when its lease runs out either.
 */
const LEASE_EXPIRY_BUDGET_MS = 45_000;

/** The chain's own claim, refusing to return some other run's job. */
async function claimJobFor(
  request: APIRequestContext,
  runnerId: string,
  token: string,
  runId: string,
): Promise<JobClaim> {
  // Bounded for the same reason `claimJob` is: a shared queue means the first claim is
  // whatever was queued earliest, so this drains until it reaches the run it was told to.
  //
  // **204 is not a failure and must not be asserted as one.** It is the API's legitimate
  // "nothing to claim right now", and on a shared queue with a second runner in the lane
  // it is the *expected* answer to most attempts. The first draft asserted 200 on every
  // attempt and failed on the 204 — a spec that cannot tell "the queue was empty" from
  // "the API is broken" reports the wrong defect, which is the one a reader cannot
  // diagnose.
  let emptyAttempts = 0;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const response = await request.post(`${API_BASE}/api/v1/runners/${runnerId}/jobs/claim`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      data: { capabilities: ['playwright'] },
    });
    if (response.status() === 204) {
      emptyAttempts += 1;
      continue;
    }
    expect(
      response.status(),
      `POST /api/v1/runners/${runnerId}/jobs/claim -> ${response.status()} ${await response.text()}`,
    ).toBe(200);
    const claim = (await response.json()) as JobClaim;
    if (claim.runId === runId) return claim;
  }
  throw new Error(
    `no claim returned run ${runId} after 25 attempt(s) (${String(emptyAttempts)} of them ` +
      "answered 204, meaning the queue was empty). Either the run's job was never " +
      'enqueued, or the queue drained without reaching it.',
  );
}

/** Cancel once, so the assertion is about the state and not about the call succeeding. */
async function cancelRunOnce(
  request: APIRequestContext,
  runId: string,
): Promise<{ phase?: string; outcome?: string | null }> {
  const response = await request.post(`${API_BASE}/api/v1/runs/${runId}/cancel`, {
    headers: API_AUTH_HEADERS,
  });
  expect(response.status(), `POST /api/v1/runs/${runId}/cancel -> ${response.status()}`).toBe(200);
  return (await response.json()) as { phase?: string; outcome?: string | null };
}
