/**
 * runs.ts — Dashboard run detail and status-patch routes
 *
 * GET   /api/v1/dashboard/runs/:id        — retrieve a single run record
 * PATCH /api/v1/dashboard/runs/:id/status — update a run's status field
 */
import { Hono } from 'hono';
import { DomainError } from '../../errors/domain-error.js';
import { PERSISTED_RUN_STATUS_VALUES } from '@automate/shared-contracts';
import type { RunRepository } from '../../repositories/run-repository.js';
import { currentRequestId } from '../../observability/request-context.js';
import { isTerminalRunStatus } from './terminal-status.js';
import type { AuditSink } from './audit-sink.js';
import { PatchRunStatusBodySchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DashboardRunsOptions {
  repository: RunRepository;
  /**
   * Where a status change is recorded.
   *
   * Optional so the three existing call sites keep compiling, and **that is a
   * compromise, not a design**: an absent sink means the write is still unaudited,
   * which is the defect this route carries. Wiring it everywhere is a one-line change
   * per composition root and is the reason the option is visible here rather than
   * hidden.
   */
  audit?: AuditSink;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createDashboardRunsRoutes(options: DashboardRunsOptions): Hono {
  const app = new Hono();

  // ── GET /api/v1/dashboard/runs/:id ────────────────────────────────────────
  app.get('/api/v1/dashboard/runs/:id', async (c) => {
    const id = c.req.param('id');
    const run = await options.repository.getRun(id);
    if (!run) {
      throw new DomainError('RUN_NOT_FOUND', 'Run not found');
    }
    return c.json(run);
  });

  // ── PATCH /api/v1/dashboard/runs/:id/status ───────────────────────────────
  app.patch('/api/v1/dashboard/runs/:id/status', async (c) => {
    const id = c.req.param('id');

    const run = await options.repository.getRun(id);
    if (!run) {
      throw new DomainError('RUN_NOT_FOUND', 'Run not found');
    }

    // `.catch(() => null)` and a schema, not `(await c.req.json()) as
    // Record<string, unknown>` with a hand-rolled field check. `req.json()`
    // **throws** on an empty or malformed body, and the throw used to escape the
    // handler — so `PATCH` with no body at all was a 500 the error boundary could
    // not tell from a real fault, with the validation below it never having run.
    // That is the defect `schemas.ts` was written to undo for the two write
    // routes beside this one; this was the one it missed.
    //
    // (This rationale was present twice, verbatim, until X-2. A comment that says
    // the same thing twice reads as two independent reasons, and a reader
    // maintaining one of them has no way to know the other exists.)
    const parsed = PatchRunStatusBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      // The message used to name the allowed values inside a template literal and the
      // body carried the issues as a sibling of the error — a second renderer, and a
      // message nobody could match on. Both are fields of one `DomainError` now, and
      // the allowed values are a list rather than a sentence, so a client can render
      // them without parsing prose.
      throw new DomainError('INVALID_RUN_STATUS', 'Invalid run status', {
        details: { allowed: PERSISTED_RUN_STATUS_VALUES, issues: parsed.error.issues },
      });
    }

    // `parsed.data.status` is already the persisted subset, because the schema is
    // built from `PERSISTED_RUN_STATUS_VALUES`. That is what `toPersistedStatus`
    // used to be called for here, and the assertion it needed is now the schema's
    // — so no cast can widen a status past the column between the check and the
    // write.
    const next = parsed.data.status;

    // A write that changes nothing is not an event. Recording it would make the audit
    // log a count of requests rather than a record of decisions, and the row asks "who
    // decided this, and when" — which has no answer when nobody decided anything.
    if (run.status === next) {
      return c.json(run);
    }

    // A terminal phase is terminal. Accepting a transition out of one is how a
    // *concluded* run comes back to life, and the value is a claim in every context
    // that reads it: a finished release marked running is a report that will never
    // settle. The refusal is 409 rather than 400 — the request was well formed and
    // the resource exists, but its current state forbids the change.
    // A terminal phase is terminal. Accepting a transition out of one is how a
    // *concluded* run comes back to life, and the value is a claim in every context
    // that reads it: a finished release marked running is a report that will never
    // settle. The refusal is 409 rather than 400 — the request was well formed and
    // the resource exists, but its current state forbids the change.
    if (isTerminalRunStatus(run.status)) {
      throw new DomainError('RUN_STATUS_TERMINAL', 'Run is in a terminal status', {
        details: { from: run.status, to: next },
      });
    }

    await options.repository.patchRun(id, { status: next });

    // The record, for the same reason quarantine writes one: a status change is a
    // claim about a run, and "who moved this run and when" has to be answerable
    // later. `audit-sink.ts` has sat unreferenced in this module for the whole
    // time this route was unaudited.
    await options.audit?.record({
      action: 'run.status_changed',
      resourceType: 'run',
      resourceId: id,
      actorId: c.req.header('x-actor-id') ?? 'anonymous',
      actorType: 'user',
      requestId: currentRequestId() ?? null,
    });

    const updated = await options.repository.getRun(id);
    // Never a literal `null` with a 200. The run existed a moment ago; if it is gone
    // now, the honest answer is that it is gone, and `c.json(null)` returned 200
    // with a body that is not a run — which a client cannot distinguish from a run
    // whose fields are all null.
    if (!updated) {
      throw new DomainError('RUN_VANISHED', 'Run not found');
    }
    return c.json(updated);
  });

  return app;
}
