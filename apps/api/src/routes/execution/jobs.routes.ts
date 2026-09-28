/**
 * jobs.routes.ts — a runner's job lifecycle: event ingestion, artifact upload, completion.
 *
 * One of the five route groups, extracted from a single 1139-line module. The
 * handler bodies are moved verbatim; only this wrapper and the imports are new.
 *
 * What that buys is not tidiness. It is that the registration order is now written
 * down once, in `createExecutionRoutes`, instead of being an accident of where a
 * handler sat in a long file — and that the helpers and request bodies those handlers
 * use are decided in one file each, so a response shape cannot drift between two
 * routes that each had their own copy.
 *
 * `route-manifest.test.ts` asserts the resulting route set, that no method+path is
 * registered twice, and that the order matches the mounted app.
 */

import { Hono, type Context } from 'hono';
import { decodeArtifactBytes } from '../../http/artifact-bytes.js';
import { jobLeaseIsCurrent } from './shared.js';
import type { ExecutionRouteContext } from './shared.js';
import type {} from './schemas.js';
import { artifactKind, parseBody, publishCanonical, safeName, workspace } from './shared.js';
import {
  ArtifactSchema,
  CANONICAL_EVENT_TYPES,
  CompleteSchema,
  EventBatchSchema,
} from './schemas.js';
import { CanonicalRealtimeEvent } from '../../realtime/realtime-bus.js';
import { DomainError, isDomainError } from '../../errors/domain-error.js';
import { JobCompletionInput } from '../../execution/types.js';
import { toCanonicalRun } from '../../execution/canonical.js';
import { authenticate } from './shared.js';
import { createHash, randomUUID } from 'node:crypto';
export function registerJobRoutes(app: Hono, context: ExecutionRouteContext): void {
  const { options, ws, eventSequences, maxArtifactBytes } = context;
  const handleEvents = async (c: Context): Promise<Response> => {
    const runner = await authenticate(c, options.store);
    if (!runner) throw new DomainError('RUNNER_UNAUTHORIZED', 'Runner token is invalid');
    const body = await c.req.json().catch(() => null);
    const parsed = Array.isArray(body) ? null : EventBatchSchema.safeParse(body);
    if (!parsed?.success) throw new DomainError('INVALID_EVENT_BATCH', 'Event batch is invalid');
    const jobId = c.req.param('jobId');
    if (!jobId) throw new DomainError('INVALID_JOB_ID', 'Job id is required');
    const batch = parsed.data;
    // The runner must present its own lease credentials. Falling back to the
    // stored lease would let any authenticated runner write events into any
    // job in any workspace.
    if (batch.leaseId === undefined || batch.fencingToken === undefined)
      throw new DomainError('JOB_LEASE_REQUIRED', 'Job lease credentials are required');
    const workspaceId = workspace(options);
    const job = await options.store.getJob(jobId, workspaceId);
    if (!job) throw new DomainError('JOB_NOT_FOUND', 'Job not found');
    if (job.leaseOwner !== runner.id)
      throw new DomainError('JOB_LEASE_NOT_OWNED', 'Job lease is not owned by this runner');
    if (job.leaseId !== batch.leaseId)
      throw new DomainError('JOB_LEASE_INVALID', 'Job lease is stale');
    if (job.fencingToken !== batch.fencingToken)
      throw new DomainError('JOB_FENCING_STALE', 'Job fencing token is stale');
    const results = await options.store.appendEvents(
      jobId,
      batch.leaseId,
      batch.fencingToken,
      batch.events,
      workspaceId,
    );
    for (const [index, result] of results.entries()) {
      if (result.status !== 'accepted') continue;
      const input = batch.events[index];
      if (!input) continue;
      const type = input.type === 'run.phase' ? 'run.phase_changed' : input.type;
      if (!CANONICAL_EVENT_TYPES.has(type)) continue;
      publishCanonical(
        options.bus,
        {
          type: type as CanonicalRealtimeEvent['type'],
          eventId: input.eventId,
          occurredAt: input.occurredAt ?? new Date().toISOString(),
          runId: job.runId,
          payload: input.payload ?? {},
        },
        eventSequences,
      );
    }
    if (results.some((result) => result.status === 'conflict'))
      return c.json({ results, duplicate: false }, 409);
    return c.json(
      {
        results,
        duplicate: results.length > 0 && results.every((result) => result.status === 'duplicate'),
      },
      202,
    );
  };
  app.post('/api/v1/jobs/:jobId/events', handleEvents);
  app.post('/api/v1/jobs/:jobId/events/batch', handleEvents);

  app.post('/api/v1/jobs/:jobId/artifacts', async (c) => {
    const runner = await authenticate(c, options.store);
    if (!runner) throw new DomainError('RUNNER_UNAUTHORIZED', 'Runner token is invalid');
    const parsed = await parseBody(c, ArtifactSchema);
    if (!parsed) throw new DomainError('INVALID_ARTIFACT', 'Artifact metadata is invalid');
    const job = await options.store.getJob(c.req.param('jobId'), ws);
    if (!job) throw new DomainError('JOB_NOT_FOUND', 'Job not found');
    if (job.leaseOwner !== runner.id || !job.leaseId)
      throw new DomainError('JOB_LEASE_NOT_OWNED', 'Job lease is not owned by runner');
    const lease = jobLeaseIsCurrent(job, parsed);
    if (!lease.ok) throw new DomainError(lease.code, 'Job lease or fencing token is stale');
    // The decode rules — shape, padding, and the ceiling applied to the *decoded*
    // length — are one unit in `http/artifact-bytes.ts`, because that is what they are.
    // Inline they were six branches in a handler that also authenticates a runner,
    // checks two lease predicates and writes a row, and a reader could not see the whole
    // rule without reading the whole route.
    const decoded = decodeArtifactBytes(
      parsed.bytesBase64 ?? parsed.contentBase64 ?? parsed.bytes,
      maxArtifactBytes,
    );
    if (!decoded.ok)
      throw new DomainError(decoded.code, decoded.message, { details: decoded.details });
    const bytes = decoded.bytes;
    const name = safeName(parsed.name);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (parsed.checksum !== undefined && parsed.checksum.toLowerCase() !== checksum)
      throw new DomainError('ARTIFACT_CHECKSUM_MISMATCH', 'Artifact checksum does not match bytes');
    if (parsed.sizeBytes !== undefined && parsed.sizeBytes !== bytes.byteLength)
      throw new DomainError('ARTIFACT_SIZE_MISMATCH', 'Artifact size does not match bytes');
    try {
      const descriptor = await options.store.addArtifact({
        runId: job.runId,
        jobId: job.id,
        testId: parsed.testId ?? null,
        kind: artifactKind(parsed.kind),
        name,
        contentType: parsed.contentType,
        storageKey: `runs/${job.runId}/${randomUUID()}-${name}`,
        expiresAt: parsed.expiresAt ?? null,
        legalHold: parsed.legalHold ?? false,
        metadata: parsed.metadata ?? {},
        bytes,
      });
      publishCanonical(
        options.bus,
        {
          type: 'artifact.created',
          eventId: randomUUID(),
          occurredAt: descriptor.createdAt,
          runId: job.runId,
          payload: { artifact: descriptor },
        },
        eventSequences,
      );
      return c.json(descriptor, 201);
    } catch (failure) {
      // 400 said "your request was wrong". Nothing about the request is wrong
      // when the object store is unreachable, full, or refusing — a caller that
      // believed a 400 would not retry, and an operator reading the access log
      // would go looking for a bad request that never existed. `addArtifact` also
      // inserts a row, so this can be a constraint violation rather than a
      // storage fault; the boundary classifies whichever it is and records it.
      if (isDomainError(failure)) throw failure;
      throw new DomainError('ARTIFACT_STORAGE_FAILED', 'Artifact storage is unavailable');
    }
  });

  app.post('/api/v1/jobs/:jobId/complete', async (c) => {
    const runner = await authenticate(c, options.store);
    if (!runner) throw new DomainError('RUNNER_UNAUTHORIZED', 'Runner token is invalid');
    const parsed = await parseBody(c, CompleteSchema);
    if (!parsed) throw new DomainError('INVALID_COMPLETION', 'Job completion is invalid');
    const jobId = c.req.param('jobId');
    // The completion path is a write into a run's terminal state, so it needs
    // the same lease-ownership proof the artifact path already had.
    const job = await options.store.getJob(jobId, ws);
    if (!job) throw new DomainError('JOB_NOT_FOUND', 'Job not found');
    if (job.leaseOwner !== runner.id)
      throw new DomainError('JOB_LEASE_NOT_OWNED', 'Job lease is not owned by this runner');
    const completion: JobCompletionInput = {
      ...parsed,
      leaseId: parsed.leaseId,
      fencingToken: parsed.fencingToken,
      phase: parsed.phase === 'completed' ? 'complete' : parsed.phase,
      tests: parsed.tests?.map((test) => ({
        ...test,
        id: test.id ?? test.testId ?? randomUUID(),
      })),
    };
    const result = await options.store.completeJob(jobId, completion, ws);
    if (!result) throw new DomainError('JOB_LEASE_INVALID', 'Job lease or completion is stale');
    publishCanonical(
      options.bus,
      {
        type: 'run.completed',
        eventId: randomUUID(),
        occurredAt: result.run.completedAt ?? new Date().toISOString(),
        runId: result.run.id,
        payload: {
          phase: result.run.phase,
          outcome: result.run.outcome ?? 'unknown',
          finishedAt: result.run.completedAt ?? new Date().toISOString(),
          summary: toCanonicalRun(result.run).summary,
        },
      },
      eventSequences,
    );
    return c.json(toCanonicalRun(result.run), 200);
  });
}
