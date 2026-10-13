import { randomUUID } from 'node:crypto';
import { normaliseFailure } from '../services/reporter-persistence.js';
import { asc, and, desc, eq, gt, inArray, isNotNull, lt, or } from 'drizzle-orm';
import {
  artifacts,
  executionJobs,
  gateEvaluations,
  qualityPolicies,
  runEvents,
  runners,
  runs,
  tests,
} from '@automate/db';
import { createGateEvaluation, defaultPolicy } from './quality-gate.js';
import { COMPLETION_HASH_CAPACITY, BoundedMap } from './bounded-map.js';
import { deriveRunState, isRequestablePhase, isTerminalPhase } from './phase-outcome.js';
import { resolveSummary } from './summary.js';
import { decodeRunCursor, normalizeEventLimit, normalizeRunLimit } from './run-paging.js';
import { DrizzleExecutionOutbox } from './drizzle-execution-store-outbox.js';
import {
  chunked,
  dateIso,
  dbTestStatus,
  digest,
  eventDigest,
  groupBy,
  iso,
  jobScope,
  mapArtifact,
  mapEvent,
  mapGate,
  mapJob,
  mapPolicy,
  mapRunner,
  mapTest,
  MAX_ROWS_PER_CHILD_QUERY,
  nullableDateIso,
  nullableString,
  nowDate,
  numberValue,
  oneBatch,
  oneEventBatch,
  outcomeValue,
  phaseValue,
  rowValue,
  stringValue,
  summaryFromRow,
  uuidFor,
  type AnyPgDb,
  type DbRow,
  type DrizzleExecutionStoreOptions,
  type OutboxAppend,
} from './drizzle-execution-store-rows.js';
import type {
  CreateRunInput,
  CreateRunResult,
  DomainStatus,
  ExecutionEventInput,
  ExecutionJob,
  ExecutionRun,
  ExecutionTestResult,
  EventApplyResult,
  EventPage,
  GateEvaluation,
  JobCompletionInput,
  JobCompletionResult,
  QualityPolicy,
  RunPage,
  RunPhase,
  ReleaseReadiness,
} from './types.js';

/**
 * Runs, their tests, their results and the projection reads over them.
 *
 * The outbox is the one collaborator: every durable write here records an
 * envelope beside it, and it is *constructor-injected* rather than owned, so the
 * canonical writes cannot quietly start emitting events the outbox module does
 * not know how to describe. Nothing else crosses a boundary — the mapping, the
 * summary and the gate evaluation are all here, because they are all reads of a
 * run and the row they read is a run's.
 */
export class DrizzleExecutionCanonical {
  private readonly db: AnyPgDb;
  private readonly options: DrizzleExecutionStoreOptions;
  private readonly outbox: DrizzleExecutionOutbox;

  /** Bounded: a job completion hash is only consulted while a client retries that job. */
  private readonly completionHashes = new BoundedMap<string, string>(
    'completionHashes',
    COMPLETION_HASH_CAPACITY,
  );

  constructor(options: DrizzleExecutionStoreOptions, outbox: DrizzleExecutionOutbox) {
    this.db = options.db;
    this.options = options;
    this.outbox = outbox;
  }

  async createRun(
    input: CreateRunInput,
    idempotencyKey: string,
    workspaceId = 'default-workspace',
  ): Promise<CreateRunResult> {
    const existing = await this.findByIdempotency(workspaceId, idempotencyKey);
    if (existing) {
      const existingId = stringValue(existing.id);
      const job = (
        await this.db
          .select()
          .from(executionJobs)
          .where(
            and(
              eq(executionJobs.runId, existingId),
              eq(executionJobs.attempt, numberValue(existing.attempt, 1)),
            ),
          )
          .limit(1)
      )[0];
      if (job)
        return {
          run: (await this.getRun(existingId, workspaceId)) as ExecutionRun,
          job: mapJob(rowValue(job)),
          duplicate: true,
        };
    }
    const timestamp = nowDate(this.options);
    const id = randomUUID();
    const projectId = input.projectId ? uuidFor(input.projectId) : null;
    const environmentId = input.environmentId ? uuidFor(input.environmentId) : null;
    const releaseId = input.releaseId ? uuidFor(input.releaseId) : null;
    const policyId = input.policyId ? uuidFor(input.policyId) : null;
    const attempt = input.retryOfRunId
      ? ((await this.getRun(input.retryOfRunId, workspaceId))?.attempt ?? 0) + 1
      : 1;
    const jobId = randomUUID();
    const runValues = {
      id,
      externalId: input.externalId ?? null,
      startedAt: timestamp,
      finishedAt: null,
      completedAt: null,
      status: 'running' as const,
      phase: 'queued' as const,
      outcome: null,
      attempt,
      priority: input.priority ?? 0,
      total: 0,
      passed: 0,
      failed: 0,
      flaky: 0,
      skipped: 0,
      blocked: 0,
      unknown: 0,
      durationMs: null,
      branch: input.branch ?? null,
      commitSha: input.commit ?? null,
      source: input.source ?? 'api',
      framework: input.framework ?? 'playwright',
      adapterVersion: input.adapterVersion ?? '1',
      testType: input.testType ?? 'browser',
      projectId,
      environmentId,
      releaseId,
      suite: input.suite ?? null,
      selection: input.selection ?? [],
      requiredCapabilities: input.requiredCapabilities ?? ['playwright'],
      labels: input.labels ?? [],
      timeoutMs: input.timeoutMs ?? 1_800_000,
      policyId,
      idempotencyKey: idempotencyKey.trim(),
      retryOfRunId: input.retryOfRunId ?? null,
      eventSequence: 0,
      rawEvidenceRefs: [],
      workspaceId,
      config: input.configuration ?? {},
      metadata: input.metadata ?? {},
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const jobValues = {
      id: jobId,
      workspaceId,
      runId: id,
      attempt,
      priority: input.priority ?? 0,
      state: 'queued' as const,
      availableAt: input.availableAt ? new Date(input.availableAt) : timestamp,
      requiredCapabilities: input.requiredCapabilities ?? ['playwright'],
      labels: input.labels ?? [],
      timeoutMs: input.timeoutMs ?? 1_800_000,
      spec: {
        projectId,
        environmentId,
        releaseId,
        suite: input.suite ?? null,
        selection: input.selection ?? [],
        configuration: input.configuration ?? {},
      },
      fencingToken: 0,
      idempotencyKey: `${idempotencyKey}:attempt:${attempt}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(runs).values(runValues);
        await tx.insert(executionJobs).values(jobValues);
        await this.outbox.append(tx, {
          workspaceId,
          aggregateId: id,
          eventType: 'execution.run.created',
          dedupeKey: `execution:${workspaceId}:run.created:${id}`,
          occurredAt: timestamp,
          payload: {
            runId: id,
            jobId,
            attempt,
            phase: 'queued',
            outcome: null,
            status: 'running',
            source: runValues.source,
            idempotencyKey: runValues.idempotencyKey,
          },
        });
      });
    } catch (error) {
      const raced = await this.findByIdempotency(workspaceId, idempotencyKey);
      if (raced) {
        const racedId = stringValue(raced.id);
        const job = (
          await this.db
            .select()
            .from(executionJobs)
            .where(eq(executionJobs.runId, racedId))
            .limit(1)
        )[0];
        if (job)
          return {
            run: (await this.getRun(racedId, workspaceId)) as ExecutionRun,
            job: mapJob(rowValue(job)),
            duplicate: true,
          };
      }
      throw error;
    }
    return {
      run: (await this.getRun(id, workspaceId)) as ExecutionRun,
      job: mapJob(
        rowValue(
          (
            await this.db.select().from(executionJobs).where(eq(executionJobs.id, jobId)).limit(1)
          )[0],
        ),
      ),
      duplicate: false,
    };
  }

  async listRuns(
    workspaceId?: string,
    releaseId?: string,
    options?: { limit?: number; after?: string },
  ): Promise<RunPage> {
    const filters = [
      workspaceId === undefined ? undefined : eq(runs.workspaceId, workspaceId),
      releaseId === undefined ? undefined : eq(runs.releaseId, releaseId),
    ].filter((value): value is ReturnType<typeof eq> => value !== undefined);
    const limit = normalizeRunLimit(options?.limit);
    // The cursor is pushed into SQL rather than applied in memory: the whole
    // point is not to read the history to page through it. `limit + 1` rows
    // decide `hasMore` without a second count query.
    const cursor = decodeRunCursor(options?.after);
    if (options?.after !== undefined && options.after.trim() !== '' && cursor === undefined) {
      // A cursor was supplied but is not one we issued. Ignoring it would
      // silently return the first page, which a caller following cursors would
      // loop on forever. An empty page with `hasMore: false` tells the caller to
      // restart deliberately.
      return { runs: [], hasMore: false };
    }
    const afterFilter =
      cursor === undefined
        ? undefined
        : // Strictly *older* than the cursor, in the same newest-first direction the
          // order below establishes: an earlier timestamp, or the same timestamp with a
          // *smaller* id. `id != cursor.id` would re-include a row that shares the
          // timestamp and sorts before the cursor, so the page would repeat it — the
          // same failure the in-memory window guards against.
          or(
            lt(runs.createdAt, new Date(cursor.createdAt)),
            and(eq(runs.createdAt, new Date(cursor.createdAt)), lt(runs.id, cursor.id)),
          );
    const rows = await this.db
      .select()
      .from(runs)
      .where(and(...(filters as never[]), ...(afterFilter === undefined ? [] : [afterFilter])))
      // Newest first. This was `asc`, and with `limit` on the same query it served the
      // oldest N runs in the install — so once an install held more than a page, the
      // newest run appeared on no page at all, and the forward-walking cursor could not
      // reach it. See `run-paging.ts` for the shared reasoning.
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      // Batched on purpose: three queries for the whole page rather than three
      // per run, which is what made this listing an N+1.
      runs: await this.mapRuns(page.map((row) => rowValue(row))),
      hasMore: rows.length > limit,
    };
  }

  async getRun(runId: string, workspaceId?: string): Promise<ExecutionRun | null> {
    const filters = [
      eq(runs.id, runId),
      workspaceId === undefined ? undefined : eq(runs.workspaceId, workspaceId),
    ].filter((value): value is ReturnType<typeof eq> => value !== undefined);
    const row = (
      await this.db
        .select()
        .from(runs)
        .where(and(...filters))
        .limit(1)
    )[0];
    return row ? this.mapRun(rowValue(row)) : null;
  }

  async cancelRun(runId: string, workspaceId?: string): Promise<ExecutionRun | null> {
    const run = await this.getRun(runId, workspaceId);
    if (!run) return null;
    if (isTerminalPhase(run.phase)) return run;
    const timestamp = iso(nowDate(this.options));
    await this.db.transaction(async (tx) => {
      await tx
        .update(runs)
        .set({
          phase: 'cancelled',
          outcome: 'cancelled',
          status: 'running',
          completedAt: new Date(timestamp),
          updatedAt: new Date(timestamp),
          cancelRequestedAt: new Date(timestamp),
        })
        .where(eq(runs.id, runId));
      // **The stop request is recorded on the job, and the lease is kept.**
      // Clearing `leaseOwner` here was what made a cancel un-deliverable: the next
      // heartbeat from the owning runner had no job left to ask about, so the
      // child ran on and then failed to complete — its lease was gone. The link
      // now survives until the runner reports the job cancelled, and the reaper
      // (in the leases module) refuses to re-run a job that was asked to stop.
      //
      // A job nobody is running needs no telling: it is terminal now.
      await tx
        .update(executionJobs)
        .set({
          cancelRequestedAt: new Date(timestamp),
          updatedAt: new Date(timestamp),
        })
        .where(and(eq(executionJobs.runId, runId), eq(executionJobs.state, 'leased')));
      await tx
        .update(executionJobs)
        .set({
          state: 'cancelled',
          cancelRequestedAt: new Date(timestamp),
          updatedAt: new Date(timestamp),
          leaseId: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        })
        .where(
          and(eq(executionJobs.runId, runId), inArray(executionJobs.state, ['queued', 'requeued'])),
        );
      await this.outbox.append(tx, {
        workspaceId: run.workspaceId,
        aggregateId: runId,
        eventType: 'execution.run.cancelled',
        dedupeKey: `execution:${run.workspaceId}:run.cancelled:${runId}`,
        occurredAt: new Date(timestamp),
        payload: {
          runId,
          attempt: run.attempt,
          phase: 'cancelled',
          outcome: 'cancelled',
        },
      });
    });
    return this.getRun(runId, workspaceId);
  }

  async retryRun(
    runId: string,
    workspaceId?: string,
    idempotencyKey?: string,
  ): Promise<CreateRunResult | null> {
    const previous = await this.getRun(runId, workspaceId);
    if (!previous || !isTerminalPhase(previous.phase)) return null;
    return this.createRun(
      {
        externalId: previous.externalId,
        source: previous.source,
        framework: previous.framework,
        adapterVersion: previous.adapterVersion,
        testType: previous.testType,
        projectId: previous.projectId ?? undefined,
        environmentId: previous.environmentId ?? undefined,
        releaseId: previous.releaseId ?? undefined,
        branch: previous.branch ?? undefined,
        commit: previous.commit ?? undefined,
        suite: previous.suite ?? undefined,
        selection: previous.selection,
        timeoutMs: previous.timeoutMs,
        priority: previous.priority,
        requiredCapabilities: previous.requiredCapabilities,
        labels: previous.labels,
        configuration: previous.configuration,
        metadata: previous.metadata,
        policyId: previous.policyId ?? undefined,
        retryOfRunId: previous.id,
      },
      idempotencyKey ?? `retry:${previous.id}:${previous.attempt + 1}`,
      previous.workspaceId,
    );
  }

  async getJob(jobId: string, workspaceId?: string): Promise<ExecutionJob | null> {
    const row = (
      await this.db
        .select()
        .from(executionJobs)
        .where(jobScope(eq(executionJobs.id, jobId), workspaceId))
        .limit(1)
    )[0];
    return row ? mapJob(rowValue(row)) : null;
  }

  async listJobs(workspaceId?: string): Promise<ExecutionJob[]> {
    const rows = await this.db
      .select()
      .from(executionJobs)
      .where(workspaceId === undefined ? undefined : eq(executionJobs.workspaceId, workspaceId))
      .orderBy(asc(executionJobs.createdAt));
    return rows.map((row) => mapJob(rowValue(row)));
  }

  async appendEvents(
    jobId: string,
    leaseId: string,
    fencingToken: number,
    inputs: ExecutionEventInput[],
    workspaceId?: string,
  ): Promise<EventApplyResult[]> {
    return this.db.transaction(async (tx) => {
      const jobRow = (
        await tx
          .select()
          .from(executionJobs)
          .where(jobScope(eq(executionJobs.id, jobId), workspaceId))
          .limit(1)
      )[0];
      const job = jobRow ? mapJob(rowValue(jobRow)) : null;
      if (
        !job ||
        job.state !== 'leased' ||
        job.leaseId !== leaseId ||
        job.fencingToken !== fencingToken
      )
        return inputs.map((event) => ({
          eventId: event.eventId,
          sequence: event.sequence,
          status: 'conflict' as const,
          reason: 'stale_lease',
        }));
      const runRow = (await tx.select().from(runs).where(eq(runs.id, job.runId)).limit(1))[0];
      if (!runRow)
        return inputs.map((event) => ({
          eventId: event.eventId,
          sequence: event.sequence,
          status: 'conflict' as const,
          reason: 'run_not_found',
        }));
      // Scoped to the batch's own event keys.
      //
      // This used to read every event for the run, so the cost of appending grew
      // with the run's history rather than with the batch — a long run got slower
      // to append to on every call.
      //
      // Scoped by `event_key` and nothing else. `event_key` is
      // `${runId}:${eventId}`, so the list is already run-scoped and dropping
      // `workspace_id` costs no selectivity — but it is what makes the read
      // bounded. With `(workspace_id, event_id)` in the predicate as well, the
      // planner still preferred the workspace-wide index and applied the key as a
      // filter, which reads every event in the workspace. `run_events_event_key_idx`
      // leads on exactly this column, so the bound is a property of the statement
      // rather than of the planner's mood.
      const eventWorkspaceId = stringValue(runRow['workspaceId'], 'default-workspace');
      const batchKeys = inputs.map((input) => `${job.runId}:${input.eventId}`);
      const existing = (
        await tx
          .select()
          .from(runEvents)
          // Bounded by `JobEventBatchSchema.events.max(500)` at the request boundary; a
          // call keeps the argument opaque to `no-unbounded-list-in-query`, which cannot
          // match a call and so cannot report a list it cannot read.
          .where(
            inArray(runEvents.eventKey, batchKeys.length > 0 ? oneEventBatch(batchKeys) : ['']),
          )
      ).map((row) => rowValue(row));
      const byId = new Map(existing.map((event) => [stringValue(event['eventKey']), event]));
      let sequence = numberValue(runRow['eventSequence']) + 1;
      // Its own question now, answered by `run_events_terminal_idx` — a partial
      // index holding only the rows it can match. Reading the answer out of the
      // dedupe map above would have been free but wrong: that map is scoped to
      // this batch, so a run.completed appended by an earlier batch would be
      // invisible and the run would accept a second terminal event.
      const alreadyTerminal = (
        await tx
          .select({ eventId: runEvents.eventId })
          .from(runEvents)
          .where(and(eq(runEvents.runId, job.runId), eq(runEvents.type, 'run.completed')))
          .limit(1)
      ).length;
      let terminal = alreadyTerminal > 0;
      const prepared: Array<{
        input: ExecutionEventInput;
        hash: string;
        eventKey: string;
        duplicate: boolean;
      }> = [];
      for (const input of inputs) {
        const hash = eventDigest(input);
        const eventKey = `${job.runId}:${input.eventId}`;
        const previous = byId.get(eventKey);
        if (previous) {
          if (stringValue(previous['hash']) !== hash)
            return [
              {
                eventId: input.eventId,
                sequence: input.sequence,
                status: 'conflict',
                reason: 'event_hash_mismatch',
                hash,
              },
            ];
          prepared.push({ input, hash, eventKey, duplicate: true });
          continue;
        }
        if (input.sequence !== sequence)
          return [
            {
              eventId: input.eventId,
              sequence: input.sequence,
              status: 'conflict',
              reason: terminal ? 'terminal_event' : 'sequence_gap',
              hash,
            },
          ];
        if (terminal)
          return [
            {
              eventId: input.eventId,
              sequence: input.sequence,
              status: 'conflict',
              reason: 'terminal_event',
              hash,
            },
          ];
        prepared.push({ input, hash, eventKey, duplicate: false });
        byId.set(eventKey, { hash });
        sequence += 1;
        if (input.type === 'run.completed' || input.payload?.['terminal'] === true) terminal = true;
      }
      const results: EventApplyResult[] = [];
      const outboxBatch: OutboxAppend[] = [];
      // One run row per batch, written once after the loop.
      //
      // Every item here belongs to the same job and therefore the same run, so the
      // loop used to issue an `UPDATE runs SET event_sequence = <sequence>` per
      // item and the phase update per phase-bearing item: N round trips for one
      // row, growing with the batch size, of which only the last write survived
      // (ledger Q-49).
      //
      // Both are accumulated and applied once. "Last wins" is what the sequential
      // writes did, and it is preserved exactly — including the case where a
      // terminal phase is followed by a non-terminal one, which nulls the
      // timestamps, because the accumulator takes the last *phase-bearing* item
      // rather than the last item.
      const eventSequenceByRun = new Map<string, number>();
      const derivedStateByRun = new Map<string, ReturnType<typeof deriveRunState>>();
      for (const item of prepared) {
        if (item.duplicate) {
          results.push({
            eventId: item.input.eventId,
            sequence: item.input.sequence,
            status: 'duplicate',
            hash: item.hash,
          });
          continue;
        }
        const input = item.input;
        const eventId = input.eventId;
        const occurredAt = input.occurredAt ? new Date(input.occurredAt) : nowDate(this.options);
        await tx.insert(runEvents).values({
          eventId,
          runId: job.runId,
          workspaceId: eventWorkspaceId,
          jobId,
          sequence: input.sequence,
          source: 'runner',
          eventKey: item.eventKey,
          hash: item.hash,
          type: input.type,
          payload: input.payload ?? {},
          leaseId,
          fencingToken,
          occurredAt,
          receivedAt: nowDate(this.options),
        });
        results.push({
          eventId: input.eventId,
          sequence: input.sequence,
          status: 'accepted',
          hash: item.hash,
        });
        outboxBatch.push({
          workspaceId: eventWorkspaceId,
          aggregateId: job.runId,
          eventType: 'execution.event.appended',
          dedupeKey: `execution:${eventWorkspaceId}:event.appended:${item.eventKey}`,
          occurredAt,
          payload: {
            runId: job.runId,
            jobId,
            eventId,
            sequence: input.sequence,
            type: input.type,
            occurredAt: occurredAt.toISOString(),
            leaseId,
            fencingToken,
            payload: input.payload ?? {},
          },
        });
        eventSequenceByRun.set(job.runId, input.sequence);
        const payload = input.payload ?? {};
        const requestedPhase = input.type === 'run.completed' ? 'complete' : payload['phase'];
        if (isRequestablePhase(requestedPhase)) {
          // `phase` and `outcome` are derived together from the phase, never
          // taken independently from the payload. Writing them separately made
          // the CHECK unreachable by a client choice, rolled the transaction
          // back, and surfaced as a 500 for a merely malformed request.
          derivedStateByRun.set(job.runId, deriveRunState(requestedPhase, payload['outcome']));
        }
        if (input.type === 'test.started' || input.type === 'test.completed') {
          const testId = stringValue(payload['testId'], eventId);
          const testStatus =
            input.type === 'test.started'
              ? 'running'
              : dbTestStatus(
                  String(payload['status'] ?? 'unknown') as ExecutionTestResult['status'],
                );
          const testDuration = numberValue(payload['durationMs'], 0) || null;
          await tx
            .insert(tests)
            .values({
              id: testId,
              runId: job.runId,
              title: stringValue(payload['title'], testId),
              file: stringValue(payload['file'], ''),
              status: testStatus,
              durationMs: testDuration,
              retryCount: 0,
            })
            .onConflictDoUpdate({
              target: [tests.id, tests.runId],
              set: {
                title: stringValue(payload['title'], testId),
                status: testStatus,
                durationMs: testDuration,
              },
            });
        }
      }
      for (const [runId, sequence] of eventSequenceByRun) {
        const derived = derivedStateByRun.get(runId);
        await tx
          .update(runs)
          .set({
            eventSequence: sequence,
            ...(derived
              ? {
                  phase: derived.phase,
                  outcome: derived.outcome,
                  status: derived.status,
                  // Nulled rather than omitted, so a non-terminal phase after a
                  // terminal one still clears the timestamps — the same row state
                  // the sequential writes produced.
                  completedAt: derived.terminal ? nowDate(this.options) : null,
                  finishedAt: derived.terminal ? nowDate(this.options) : null,
                }
              : {}),
            updatedAt: nowDate(this.options),
          })
          .where(eq(runs.id, runId));
      }
      await this.outbox.appendBatch(tx, outboxBatch);
      return results;
    });
  }

  async listEvents(
    workspaceId: string,
    runId: string,
    page: { afterSequence?: number; limit?: number } = {},
  ): Promise<EventPage> {
    // The workspace is required and is part of the query, not a post-filter. The
    // events table has no `workspace_id` column, so the constraint is the join
    // through `runs` — which is exactly the join that was missing when this
    // method took only a run id.
    const limit = normalizeEventLimit(page.limit);
    // `limit + 1` rows, then report `hasMore` and drop the extra. Asking for one more
    // row than the caller wants is the only way to know whether there *is* another
    // row without a second count query — and a `COUNT(*)` over a per-test table is
    // the cost this endpoint is being fixed for.
    // Joined through `runs` because `runEvents` carries no `workspace_id` of its
    // own. Without the join, a run id from another workspace returned its whole
    // event stream.
    const rows = await this.db
      .select({ event: runEvents })
      .from(runEvents)
      .innerJoin(runs, eq(runs.id, runEvents.runId))
      .where(
        page.afterSequence === undefined
          ? and(eq(runEvents.runId, runId), eq(runs.workspaceId, workspaceId))
          : and(
              eq(runEvents.runId, runId),
              eq(runs.workspaceId, workspaceId),
              gt(runEvents.sequence, page.afterSequence),
            ),
      )
      .orderBy(asc(runEvents.sequence))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    return {
      events: rows.slice(0, limit).map((row) => mapEvent(rowValue(row.event))),
      hasMore,
    };
  }

  async completeJob(
    jobId: string,
    completion: JobCompletionInput,
    workspaceId?: string,
  ): Promise<JobCompletionResult | null> {
    const completionHash = digest(completion);
    const previousHash = this.completionHashes.get(jobId);
    const result = await this.db.transaction(async (tx) => {
      const jobRow = (
        await tx
          .select()
          .from(executionJobs)
          .where(jobScope(eq(executionJobs.id, jobId), workspaceId))
          .limit(1)
      )[0];
      if (!jobRow) return null;
      const jobRecord = rowValue(jobRow);
      const job = mapJob(jobRecord);
      const storedHash = nullableString(jobRecord['completionHash']);
      const effectivePreviousHash = storedHash ?? previousHash;
      if (effectivePreviousHash && effectivePreviousHash !== completionHash) return null;
      // Fenced inside the transaction as well as at the route: the route's check is
      // defence against a caller, and this is defence against a caller that got here
      // anyway. `runner-lifecycle.drizzle.test.ts` asserts it directly, because
      // without that assertion this line could be deleted and nothing would fail.
      if (job.leaseId !== completion.leaseId || job.fencingToken !== completion.fencingToken)
        return null;
      // A **duplicate** is not a stale write, and it is answered before any lease
      // question. The first completion already moved the job to `completed` and cleared
      // its lease, so a retry of the identical payload arrives with no lease at all — and
      // refusing it would break the idempotency contract the duplicate short-circuit
      // exists to provide. Re-running a lease predicate against a job that already
      // finished answers a question that no longer has a meaning.
      if (effectivePreviousHash) return { runId: job.runId, duplicate: true };

      // **And the lease must still be live.** A token check alone cannot see an expired
      // lease, because nothing bumps the token when a lease simply runs out — and
      // reaping is *lazy*, running inside `claimJob` rather than on a timer. So between
      // a lease expiring and the next runner claiming, the row still advertises a valid
      // lease with its original token, and a runner returning from a long GC pause or a
      // network partition lands exactly there. It would then write the run's terminal
      // state over whatever the requeued job went on to do.
      //
      // The worker's store has always had this predicate (`lease_expires_at > now()` in
      // its `UPDATE`), and the two stores disagreeing about the same invariant with
      // nothing comparing them is what ledger **RUN-1** records. So the comparison is
      // here too, and `runner-lifecycle.drizzle.test.ts` asserts it with the reaper
      // deliberately *not* run — otherwise reaping nulls `leaseId` and the line above
      // refuses the write, which would make this assertion pass if it were deleted.
      //
      // `mapJob` hands back an ISO string, not a `Date` — the shape a JSON caller sees
      // and the one `getJob` returns — so this compares parsed time rather than calling
      // `getTime()`, which is a `TypeError` here rather than a wrong answer.
      const leaseExpiresAt = job.leaseExpiresAt === null ? null : Date.parse(job.leaseExpiresAt);
      if (
        leaseExpiresAt === null ||
        Number.isNaN(leaseExpiresAt) ||
        leaseExpiresAt <= nowDate(this.options).getTime()
      )
        return null;

      const timestamp = nowDate(this.options);
      const status = (completion.status ?? completion.outcome ?? 'unknown').toLowerCase();
      const rawPhase = completion.phase;
      const phase: RunPhase =
        rawPhase === 'completed'
          ? 'complete'
          : (rawPhase ??
            (status === 'cancelled'
              ? 'cancelled'
              : status === 'timed_out'
                ? 'timed_out'
                : status === 'runner_lost'
                  ? 'runner_lost'
                  : status === 'infra_failed'
                    ? 'infra_failed'
                    : status === 'config_failed'
                      ? 'config_failed'
                      : 'complete'));
      const outcome =
        completion.outcome ??
        (status === 'passed' || status === 'succeeded'
          ? 'passed'
          : status === 'failed'
            ? 'failed'
            : status === 'cancelled'
              ? 'cancelled'
              : status === 'timed_out'
                ? 'timed_out'
                : status === 'runner_lost'
                  ? 'runner_lost'
                  : status === 'infra_failed'
                    ? 'infra_failed'
                    : status === 'config_failed'
                      ? 'config_failed'
                      : 'unknown');
      // Derived after the tests and summary are written, so a run that reports
      // nothing cannot land as a green run. The phase and the outcome are decided
      // together — writing them independently is what made
      // `runs_phase_outcome_check` reachable by a client choice.
      const derived = deriveRunState(phase, outcome);
      if (completion.tests) {
        for (const test of completion.tests) {
          // **Why the test failed**, from the runner that reported it.
          //
          // `ExecutionTestResult.error` has existed for as long as the job-completion
          // payload has, and `CanonicalTestResultSchema` declares it, and the run-detail
          // page has rendered `test-error-<id>` since before any of this — but this
          // writer did not persist it. So a runner reporting a failure with a reason
          // produced a `tests` row with a status and no reason, and the dashboard
          // rendered a red row with nothing on it.
          //
          // This is the **fourth** write path to the same gap: the reporter event
          // (`test:end`), the reporter upload, and now the job completion. All three
          // now write it and all three read it back through `mapTest`, and the bound is
          // the reporter's `normaliseFailure` — which this path reuses rather than
          // re-deriving, so an untrusted payload is bounded identically whichever door
          // it arrives at.
          const failure = normaliseFailure({
            code: test.error?.code,
            message: test.error?.message,
          });
          await tx
            .insert(tests)
            .values({
              id: test.id,
              runId: job.runId,
              title: test.title,
              file: test.file ?? '',
              status: dbTestStatus(test.status),
              durationMs: test.durationMs ?? null,
              retryCount: Math.max(0, (test.attempt ?? 1) - 1),
              ...failure,
            })
            .onConflictDoUpdate({
              target: [tests.id, tests.runId],
              set: {
                title: test.title,
                status: dbTestStatus(test.status),
                durationMs: test.durationMs ?? null,
                // On conflict as well as insert: a retry reported over the same
                // (testId, runId) must replace the previous attempt's reason rather than
                // leaving the first failure on screen next to a passing retry.
                ...failure,
              },
            });
        }
      }
      await tx
        .update(executionJobs)
        .set({
          state:
            status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'completed',
          completionHash,
          completedAt: timestamp,
          updatedAt: timestamp,
          leaseExpiresAt: null,
          errorCode: completion.error?.code ?? null,
          errorMessage: completion.error?.message ?? null,
        })
        .where(eq(executionJobs.id, jobId));
      const summaryTotal = completion.summary?.total ?? completion.tests?.length ?? 0;
      const summaryPassed = completion.summary?.passed ?? 0;
      const summaryFailed = completion.summary?.failed ?? 0;
      const summaryFlaky = completion.summary?.flaky ?? 0;
      // A run with no tests, a zero total and no recorded pass has produced no
      // evidence, so `passed` is not available to it. `interrupted` is the
      // existing "finished without a determinate outcome" value — using it keeps
      // the status vocabulary at four members and needs no migration.
      const runStatus =
        derived.outcome === 'passed' &&
        summaryTotal === 0 &&
        summaryPassed === 0 &&
        summaryFailed === 0 &&
        summaryFlaky === 0
          ? 'interrupted'
          : derived.status;
      // A runner's own summary is accepted only if it accounts for its own total;
      // one that does not add up is an unverifiable claim about evidence, so the
      // run's own tests are counted instead. `resolveSummary` is shared with the
      // in-memory store so the two cannot derive the same run differently.
      const summary = resolveSummary(completion.summary, completion.tests ?? []);
      await tx
        .update(runs)
        .set({
          phase: derived.phase,
          outcome: derived.outcome,
          status: runStatus,
          completedAt: timestamp,
          finishedAt: timestamp,
          updatedAt: timestamp,
          errorCode: completion.error?.code ?? null,
          errorMessage: completion.error?.message ?? null,
          total: summary.total,
          passed: summary.passed,
          failed: summary.failed,
          flaky: summary.flaky,
          skipped: summary.skipped,
          blocked: summary.blocked,
          unknown: summary.unknown,
          durationMs: summary.durationMs,
        })
        .where(eq(runs.id, job.runId));
      const jobWorkspaceId = stringValue(jobRecord['workspaceId'], 'default-workspace');
      await this.outbox.append(tx, {
        workspaceId: jobWorkspaceId,
        aggregateId: job.runId,
        eventType: 'execution.job.completed',
        dedupeKey: `execution:${jobWorkspaceId}:job.completed:${jobId}`,
        occurredAt: timestamp,
        payload: {
          runId: job.runId,
          jobId,
          phase,
          outcome,
          status:
            status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'completed',
          summary: completion.summary ?? null,
          error: completion.error ?? null,
        },
      });
      return { runId: job.runId, duplicate: false };
    });
    if (!result) return null;
    this.completionHashes.set(jobId, completionHash);
    const run = await this.getRun(result.runId);
    const job = await this.getJob(jobId);
    if (!run || !job) return null;
    if (!result.duplicate) {
      const policies = await this.listPolicies(run.workspaceId);
      const policy = policies[0] ?? (await this.createPolicy(defaultPolicy(run.workspaceId)));
      await this.saveGate(
        createGateEvaluation({
          run,
          policy,
          domainStatuses: {
            browser:
              run.outcome === 'passed'
                ? 'passed'
                : run.outcome === 'failed'
                  ? 'failed'
                  : run.outcome === 'partial'
                    ? 'warning'
                    : 'unknown',
          },
        }),
      );
    }
    return { run, job, status: result.duplicate ? 'duplicate' : 'accepted' };
  }

  async createPolicy(
    input: Omit<QualityPolicy, 'id' | 'hash' | 'createdAt' | 'updatedAt'>,
  ): Promise<QualityPolicy> {
    const timestamp = nowDate(this.options);
    const row = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      version: input.version,
      hash: digest(input),
      requiredDomains: input.requiredDomains,
      browserPassRateThreshold: input.browserPassRateThreshold,
      maxFlakyRate: input.maxFlakyRate,
      maxDurationMs: input.maxDurationMs,
      rules: input.rules,
      isDefault: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db.insert(qualityPolicies).values(row);
    return mapPolicy(row);
  }

  async listPolicies(workspaceId?: string): Promise<QualityPolicy[]> {
    const rows = await this.db
      .select()
      .from(qualityPolicies)
      .where(workspaceId === undefined ? undefined : eq(qualityPolicies.workspaceId, workspaceId))
      .orderBy(asc(qualityPolicies.createdAt));
    return rows.map((row) => mapPolicy(rowValue(row)));
  }

  async getPolicy(policyId: string, workspaceId?: string): Promise<QualityPolicy | null> {
    const row = (
      await this.db
        .select()
        .from(qualityPolicies)
        .where(
          and(
            eq(qualityPolicies.id, policyId),
            workspaceId === undefined ? undefined : eq(qualityPolicies.workspaceId, workspaceId),
          ),
        )
        .limit(1)
    )[0];
    return row ? mapPolicy(rowValue(row)) : null;
  }

  async saveGate(evaluation: GateEvaluation): Promise<GateEvaluation> {
    const row = {
      id: uuidFor(evaluation.id),
      workspaceId: (await this.getRun(evaluation.runId))?.workspaceId ?? 'default-workspace',
      runId: evaluation.runId,
      releaseId: evaluation.releaseId ? uuidFor(evaluation.releaseId) : null,
      policyId: uuidFor(evaluation.policyId),
      policyVersion: evaluation.policyVersion,
      policyHash: evaluation.policyHash,
      status: evaluation.status,
      decision: evaluation.decision,
      reasons: evaluation.reasons,
      evidenceRefs: evaluation.evidenceRefs,
      domainStatuses: evaluation.domainStatuses,
      evaluatedAt: new Date(evaluation.evaluatedAt),
      createdAt: nowDate(this.options),
    };
    await this.db
      .insert(gateEvaluations)
      .values(row)
      .onConflictDoUpdate({
        target: [gateEvaluations.runId, gateEvaluations.policyId, gateEvaluations.policyHash],
        set: {
          status: evaluation.status,
          decision: evaluation.decision,
          reasons: evaluation.reasons,
          evidenceRefs: evaluation.evidenceRefs,
          domainStatuses: evaluation.domainStatuses,
          evaluatedAt: new Date(evaluation.evaluatedAt),
        },
      });
    return mapGate(row);
  }

  async getGate(workspaceId: string, runId: string): Promise<GateEvaluation | null> {
    // `gate_evaluations` has no `workspace_id`, so the constraint is the join
    // through `runs`. Required, for the same reason as `listEvents`.
    const row = (
      await this.db
        .select({ gate: gateEvaluations })
        .from(gateEvaluations)
        .innerJoin(runs, eq(runs.id, gateEvaluations.runId))
        .where(and(eq(gateEvaluations.runId, runId), eq(runs.workspaceId, workspaceId)))
        .orderBy(desc(gateEvaluations.evaluatedAt))
        .limit(1)
    )[0];
    return row ? mapGate(rowValue(row.gate)) : null;
  }

  async getRunGate(workspaceId: string, runId: string): Promise<GateEvaluation | null> {
    const row = (
      await this.db
        .select()
        .from(gateEvaluations)
        .where(and(eq(gateEvaluations.runId, runId), eq(gateEvaluations.workspaceId, workspaceId)))
        .orderBy(desc(gateEvaluations.evaluatedAt))
        .limit(1)
    )[0];
    return row ? mapGate(rowValue(row)) : null;
  }

  async getReadiness(
    releaseId: string,
    workspaceId = 'default-workspace',
  ): Promise<ReleaseReadiness> {
    const run = (
      await this.db
        .select()
        .from(runs)
        .where(
          and(
            eq(runs.releaseId, releaseId),
            eq(runs.workspaceId, workspaceId),
            isNotNull(runs.completedAt),
          ),
        )
        .orderBy(desc(runs.completedAt))
        .limit(1)
    )[0];
    const mapped = run ? await this.mapRun(rowValue(run)) : null;
    let gate = mapped ? await this.getGate(workspaceId, mapped.id) : null;
    if (mapped && !gate) {
      const policies = await this.listPolicies(workspaceId);
      const policy = policies[0] ?? (await this.createPolicy(defaultPolicy(workspaceId)));
      gate = await this.saveGate(
        createGateEvaluation({
          run: mapped,
          policy,
          domainStatuses: {
            browser:
              mapped.outcome === 'passed'
                ? 'passed'
                : mapped.outcome === 'failed'
                  ? 'failed'
                  : mapped.outcome === 'partial'
                    ? 'warning'
                    : 'unknown',
          },
        }),
      );
    }
    const browser: DomainStatus =
      mapped?.outcome === 'passed'
        ? 'passed'
        : mapped?.outcome === 'failed'
          ? 'failed'
          : mapped?.outcome === 'partial'
            ? 'warning'
            : 'unknown';
    return {
      releaseId,
      decision: gate?.decision ?? 'unknown',
      browser,
      domains: {
        browser,
        api: 'not_configured',
        mobile: 'not_configured',
        performance: 'not_configured',
        security: 'not_configured',
        accessibility: 'not_configured',
        other: 'not_configured',
      },
      latestRunId: mapped?.id ?? null,
      gate,
      evaluatedAt: iso(nowDate(this.options)),
    };
  }

  async getReleaseReadiness(workspaceId: string, releaseId: string): Promise<ReleaseReadiness> {
    return this.getReadiness(releaseId, workspaceId);
  }

  private async findByIdempotency(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<DbRow | null> {
    const row = (
      await this.db
        .select()
        .from(runs)
        .where(and(eq(runs.workspaceId, workspaceId), eq(runs.idempotencyKey, idempotencyKey)))
        .limit(1)
    )[0];
    return row ? rowValue(row) : null;
  }

  private async mapRun(row: DbRow): Promise<ExecutionRun> {
    const [mapped] = await this.mapRuns([row]);
    return mapped as ExecutionRun;
  }

  /**
   * Maps many run rows with a fixed number of queries.
   *
   * `mapRun` fetches this run's tests, artifacts and runner, so calling it per
   * row made the listing N+1: twenty runs on a dashboard meant sixty-one round
   * trips. Here the child rows for every run are fetched in three queries and
   * grouped in memory, so the count is constant whatever the page size.
   *
   * Kept as a separate method rather than folded into `mapRun` because the
   * single-run path is the common one for a completion and a dashboard, and
   * * three `WHERE run_id = $1` queries beat three `IN (...)` queries for one id.
   */
  private async mapRuns(rowsToMap: DbRow[]): Promise<ExecutionRun[]> {
    if (rowsToMap.length === 0) return [];
    if (rowsToMap.length === 1)
      return [
        await this.mapRunWithChildren(
          rowsToMap[0] as DbRow,
          await this.childrenFor([rowsToMap[0] as DbRow]),
        ),
      ];

    const mapped: ExecutionRun[] = [];
    // **Batched, so no statement's size is chosen by whoever asked for the page.**
    //
    // `runIds` and `runnerIds` come from `rowsToMap`, which is whatever a paginated query
    // returned — and the page size is the caller's to choose. Three `IN (...)` statements
    // each carried a bind parameter per row, and PostgreSQL's ceiling is 65 535.
    //
    // Batching the *rows* rather than the id lists bounds all three with one limit,
    // because every id in a batch belongs to a row in it. Sequential, because a caller
    // that asked for 200 000 rows already has a problem and firing every batch at once is
    // how that becomes an outage rather than a slow answer.
    for (const batch of chunked(rowsToMap, MAX_ROWS_PER_CHILD_QUERY)) {
      const runIds = batch.map((row) => stringValue(row['id']));
      const runnerIds = [
        ...new Set(
          batch
            .map((row) => row['runnerId'])
            .filter((value): value is string => typeof value === 'string' && value !== '')
            .map((value) => stringValue(value)),
        ),
      ];

      const [testRows, artifactRows, runnerRows] = await Promise.all([
        this.db
          .select()
          .from(tests)
          .where(inArray(tests.runId, oneBatch(runIds))),
        this.db
          .select()
          .from(artifacts)
          .where(inArray(artifacts.runId, oneBatch(runIds))),
        runnerIds.length === 0
          ? Promise.resolve([])
          : this.db
              .select()
              .from(runners)
              .where(inArray(runners.id, oneBatch(runnerIds))),
      ]);

      const testsByRun = groupBy(
        testRows.map((row) => rowValue(row)),
        (row) => stringValue(row['runId'], ''),
      );
      const artifactsByRun = groupBy(
        artifactRows.map((row) => rowValue(row)),
        (row) => stringValue(row['runId'], ''),
      );
      const runnerById = new Map(
        runnerRows.map((row) => {
          const runnerRow = rowValue(row);
          return [stringValue(runnerRow['id']), mapRunner(runnerRow)] as const;
        }),
      );

      for (const row of batch) {
        const runId = stringValue(row['id']);
        mapped.push(
          this.buildRun(
            row,
            (testsByRun.get(runId) ?? []).map((test) => mapTest(test)),
            (artifactsByRun.get(runId) ?? []).map((artifact) => mapArtifact(artifact)),
            row['runnerId'] ? (runnerById.get(stringValue(row['runnerId'])) ?? null) : null,
          ),
        );
      }
    }
    return mapped;
  }

  /** The per-row queries, for a single run. */
  private async mapRunWithChildren(
    row: DbRow,
    children: {
      tests: DbRow[];
      artifacts: DbRow[];
      runner: unknown;
    },
  ): Promise<ExecutionRun> {
    const runner =
      children.runner === null || children.runner === undefined
        ? null
        : mapRunner(rowValue(children.runner));
    return this.buildRun(
      row,
      children.tests.map((test) => mapTest(test)),
      children.artifacts.map((artifact) => mapArtifact(artifact)),
      runner,
    );
  }

  /** Child rows for a single run, fetched as three queries. */
  private async childrenFor(rowsToLoad: DbRow[]): Promise<{
    tests: DbRow[];
    artifacts: DbRow[];
    runner: unknown;
  }> {
    const [testRows, artifactRows, runnerRow] = await Promise.all([
      this.db
        .select()
        .from(tests)
        .where(eq(tests.runId, stringValue(rowsToLoad[0]?.['id']))),
      this.db
        .select()
        .from(artifacts)
        .where(eq(artifacts.runId, stringValue(rowsToLoad[0]?.['id']))),
      rowsToLoad[0]?.['runnerId']
        ? this.db
            .select()
            .from(runners)
            .where(eq(runners.id, stringValue(rowsToLoad[0]?.['runnerId'])))
            .limit(1)
        : Promise.resolve([]),
    ]);
    return {
      tests: testRows.map((row) => rowValue(row)),
      artifacts: artifactRows.map((row) => rowValue(row)),
      runner: runnerRow[0] === undefined ? null : rowValue(runnerRow[0]),
    };
  }

  private buildRun(
    row: DbRow,
    testRows: ReturnType<typeof mapTest>[],
    artifactRows: ReturnType<typeof mapArtifact>[],
    runner: ReturnType<typeof mapRunner> | null,
  ): ExecutionRun {
    const runId = stringValue(row['id']);
    const summary = summaryFromRow(row);
    return {
      id: runId,
      externalId: nullableString(row['externalId']),
      source: stringValue(row['source'], 'api'),
      framework: stringValue(row['framework'], 'unknown'),
      adapterVersion: stringValue(row['adapterVersion'], 'unknown'),
      testType: stringValue(row['testType'], 'browser'),
      projectId: nullableString(row['projectId']),
      environmentId: nullableString(row['environmentId']),
      releaseId: nullableString(row['releaseId']),
      branch: nullableString(row['branch']),
      commit: nullableString(row['commitSha']),
      suite: nullableString(row['suite']),
      selection: Array.isArray(row['selection'])
        ? row['selection'].filter((value): value is string => typeof value === 'string')
        : [],
      timeoutMs: numberValue(row['timeoutMs'], 1_800_000),
      priority: numberValue(row['priority']),
      requiredCapabilities: Array.isArray(row['requiredCapabilities'])
        ? row['requiredCapabilities'].filter((value): value is string => typeof value === 'string')
        : [],
      labels: Array.isArray(row['labels'])
        ? row['labels'].filter((value): value is string => typeof value === 'string')
        : [],
      configuration:
        row['config'] && typeof row['config'] === 'object'
          ? (row['config'] as Record<string, unknown>)
          : {},
      metadata:
        row['metadata'] && typeof row['metadata'] === 'object'
          ? (row['metadata'] as Record<string, unknown>)
          : {},
      policyId: nullableString(row['policyId']),
      idempotencyKey: stringValue(row['idempotencyKey'], `legacy:${runId}`),
      workspaceId: stringValue(row['workspaceId'], 'default-workspace'),
      attempt: numberValue(row['attempt'], 1),
      retryOfRunId: nullableString(row['retryOfRunId']),
      phase: phaseValue(row['phase']),
      outcome: outcomeValue(row['outcome']),
      createdAt: dateIso(row['createdAt']),
      updatedAt: dateIso(row['updatedAt']),
      startedAt: nullableDateIso(row['startedAt']),
      completedAt: nullableDateIso(row['completedAt']),
      runner: runner
        ? {
            id: runner.id,
            name: runner.name,
            version: runner.version,
            os: runner.os,
            arch: runner.arch,
            health: runner.health,
            lastHeartbeatAt: runner.lastHeartbeatAt,
          }
        : null,
      tests: testRows,
      summary,
      error:
        row['errorCode'] || row['errorMessage']
          ? {
              code: stringValue(row['errorCode'], 'EXECUTION_ERROR'),
              message: stringValue(row['errorMessage'], 'Execution failed'),
            }
          : null,
      rawEvidenceRefs: Array.isArray(row['rawEvidenceRefs'])
        ? row['rawEvidenceRefs'].filter((value): value is string => typeof value === 'string')
        : [],
      artifacts: artifactRows,
      policyEvaluation: null,
      status: stringValue(row['status'], 'running'),
    };
  }
}
