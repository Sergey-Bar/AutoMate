/**
 * runs.routes.ts — creating, listing, reading, cancelling and retrying runs, plus the derived gate and readiness views.
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

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { CreateRunSchema } from './schemas.js';
import { toCanonicalRun } from '../../execution/canonical.js';
import { createGateEvaluation } from '../../execution/quality-gate.js';
import type { CreateRunInput, ExecutionRun } from '../../execution/types.js';
import type { ExecutionRouteContext } from './shared.js';
import {
  domainStatusesFromRun,
  ensurePolicy,
  error,
  legacyRun,
  pageCursor,
  pageSize,
  parseAfterSequence,
  parseBody,
  parsePageQuery,
  publishCanonical,
} from './shared.js';
export function registerRunRoutes(app: Hono, context: ExecutionRouteContext): void {
  const { options, ws, eventSequences } = context;
  app.post('/api/v1/runs', async (c) => {
    const parsed = await parseBody(c, CreateRunSchema);
    if (!parsed) return error(c, 400, 'INVALID_RUN', 'Run request is invalid');
    const headerKey = c.req.header('idempotency-key');
    const key = headerKey ?? parsed.idempotencyKey;
    const required = options.requireIdempotencyKey ?? process.env['NODE_ENV'] === 'production';
    if (required && !key)
      return error(c, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    if (!key)
      return error(c, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    const input = {
      ...parsed,
      selection: Array.isArray(parsed.selection)
        ? parsed.selection
        : [
            ...(parsed.selection?.paths ?? []),
            ...(parsed.selection?.testIds ?? []),
            ...(parsed.selection?.tags ?? []),
          ],
    } as CreateRunInput;
    const result = await options.store.createRun(input, key, ws);
    c.header('x-idempotent-replay', String(result.duplicate));
    return c.json(toCanonicalRun(result.run), 202);
  });

  app.get('/api/v1/runs', async (c) => {
    const releaseId = c.req.query('releaseId');
    // A hard cap, because this is the dashboard's first request and the listing
    // was unbounded: every run in the install's history, each with its tests and
    // artifacts, each validated through the canonical schema. A busy workspace
    // turned one page load into the whole table.
    const { limit, cursor } = parsePageQuery(c.req.query('limit'), c.req.query('cursor'));
    const page = await options.store.listRuns(ws, releaseId, { limit, after: cursor });
    if (page.runs.length > 0) {
      // The shape stays a bare array, so the client is unaffected; the cursor for
      // the next page rides in a header.
      const last = page.runs[page.runs.length - 1] as ExecutionRun;
      if (page.hasMore) c.header('X-Next-Cursor', pageCursor(last));
    }
    if (!options.legacyRepository) return c.json(page.runs.map(toCanonicalRun));
    const legacy = await options.legacyRepository.listRuns();
    const ids = new Set(page.runs.map((run) => run.id));
    return c.json([
      ...legacy
        .filter((run) => !ids.has(run.id))
        .map((record) => toCanonicalRun(legacyRun(record))),
      ...page.runs.map(toCanonicalRun),
    ]);
  });

  app.get('/api/v1/releases/:releaseId/readiness', async (c) => {
    return c.json(await options.store.getReadiness(c.req.param('releaseId'), ws));
  });

  /**
   * The quality gate for a run — a **read**.
   *
   * This handler used to `saveGate` and publish `gate.evaluated` on every call,
   * which makes a GET that is not safe: a browser prefetch, a link preview, or a
   * crawler's retry created gate rows and outbox events. It was also redundant,
   * because `completeJob` already persists the evaluation when the run finishes,
   * so the write here was a second one racing the first.
   *
   * It now returns the stored evaluation. A run whose completion has not landed
   * yet gets the evaluation it *would* receive, computed and returned but not
   * persisted and not published, with `recorded: false` so a caller can tell a
   * provisional verdict from a recorded one. Recording is the completion path's
   * job, where the evidence it is a verdict about is already durable.
   */
  app.get('/api/v1/runs/:runId/gate', async (c) => {
    const runId = c.req.param('runId');
    const run = await options.store.getRun(runId, ws);
    if (!run) return error(c, 404, 'RUN_NOT_FOUND', 'Run not found');
    const recorded = await options.store.getRunGate(ws, runId);
    if (recorded) return c.json({ ...recorded, recorded: true });
    const policy = run.policyId
      ? await options.store.getPolicy(run.policyId, ws)
      : await ensurePolicy(options.store, ws);
    if (!policy) return error(c, 404, 'POLICY_NOT_FOUND', 'Quality policy not found');
    const evaluation = createGateEvaluation({
      run,
      policy,
      domainStatuses: domainStatusesFromRun(run),
      evaluatedAt: run.completedAt ?? undefined,
    });
    return c.json({ ...evaluation, recorded: false });
  });

  app.get('/api/v1/runs/:runId/events', async (c) => {
    const runId = c.req.param('runId');
    const run = await options.store.getRun(runId, ws);
    if (!run) return error(c, 404, 'RUN_NOT_FOUND', 'Run not found');
    // Paged on the sequence, which is the position `appendEvents` allocates
    // monotonically, so `after` is an exact place to resume rather than a guess.
    // This endpoint read every event a run had ever produced and serialised the lot:
    // a run over 5 000 tests carries tens of thousands of rows, so its cost grew
    // with the size of the *run* rather than the size of the page.
    const after = parseAfterSequence(c.req.query('after'));
    if (after === 'invalid')
      return error(c, 400, 'INVALID_CURSOR', 'after must be a non-negative integer sequence');
    const page = await options.store.listEvents(ws, runId, {
      afterSequence: after,
      limit: pageSize(c.req.query('limit')),
    });
    if (page.hasMore)
      c.header(
        'X-Next-Cursor',
        String(page.events[page.events.length - 1]?.sequence ?? after ?? 0),
      );
    return c.json(
      page.events.map((event) => ({
        version: '1',
        eventId: event.eventId,
        sequence: event.sequence,
        // The stored type is reported verbatim, even when it is not one of
        // CANONICAL_EVENT_TYPES: a silent rewrite makes an unknown event
        // indistinguishable from a real phase change, which is exactly the
        // evidence-integrity failure this product promises never to ship.
        type: event.type,
        occurredAt: event.occurredAt,
        runId: event.runId,
        payload: event.payload,
      })),
    );
  });

  app.post('/api/v1/runs/:runId/cancel', async (c) => {
    const run = await options.store.cancelRun(c.req.param('runId'), ws);
    if (!run) {
      const legacy = options.legacyRepository
        ? await options.legacyRepository.getRun(c.req.param('runId'))
        : null;
      if (!legacy) return error(c, 404, 'RUN_NOT_FOUND', 'Run not found');
      const finishedAt = new Date().toISOString();
      await options.legacyRepository?.patchRun(legacy.id, { status: 'interrupted', finishedAt });
      const updated = (await options.legacyRepository?.getRun(legacy.id)) ?? legacy;
      return c.json(toCanonicalRun(legacyRun(updated)));
    }
    publishCanonical(
      options.bus,
      {
        type: 'run.completed',
        eventId: randomUUID(),
        occurredAt: run.updatedAt,
        runId: run.id,
        payload: {
          phase: run.phase,
          outcome: run.outcome ?? 'cancelled',
          finishedAt: run.updatedAt,
          summary: toCanonicalRun(run).summary,
        },
      },
      eventSequences,
    );
    return c.json(toCanonicalRun(run));
  });

  app.post('/api/v1/runs/:runId/retry', async (c) => {
    const key = c.req.header('idempotency-key');
    const result = await options.store.retryRun(c.req.param('runId'), ws, key);
    if (!result) {
      const legacy = options.legacyRepository
        ? await options.legacyRepository.getRun(c.req.param('runId'))
        : null;
      if (!legacy)
        return error(c, 409, 'RUN_NOT_RETRYABLE', 'Run is not retryable or was not found');
      const created = await options.store.createRun(
        {
          source: 'legacy-retry',
          framework: 'unknown',
          testType: 'unknown',
          branch: legacy.branch ?? undefined,
          commit: legacy.commitSha ?? undefined,
          retryOfRunId: legacy.id,
        },
        key ?? `retry-legacy:${legacy.id}`,
        ws,
      );
      return c.json(toCanonicalRun(created.run), 202);
    }
    c.header('x-idempotent-replay', String(result.duplicate));
    return c.json(toCanonicalRun(result.run), 202);
  });

  app.get('/api/v1/runs/:runId', async (c) => {
    const runId = c.req.param('runId');
    const run = await options.store.getRun(runId, ws);
    if (run) return c.json(toCanonicalRun(run));
    if (options.legacyRepository) {
      const legacy = await options.legacyRepository.getRun(runId);
      if (legacy) return c.json(toCanonicalRun(legacyRun(legacy)));
    }
    return error(c, 404, 'RUN_NOT_FOUND', 'Run not found');
  });
}
