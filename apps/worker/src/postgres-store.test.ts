import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostgresExecutionStore } from './postgres-store.js';

/**
 * `schedules` and `WORKSPACE_ID`.
 *
 * Before `0015_schedule_workspace_scope.sql`, the tenant of a scheduled run lived only
 * as `run_options->'request'->>'workspaceId'` — a string inside untyped JSONB. The
 * worker had no column to scope by and nothing to validate the value against, so any
 * principal able to insert a schedule row chose the workspace its run executed in.
 *
 * The column is now authoritative and the JSONB is a second opinion, which is what makes
 * a disagreement detectable at all. These cases are written around that trust
 * relationship rather than around the happy path, because the happy path passed before
 * the column existed and would pass again if the check were quietly removed.
 *
 * The pool is stubbed at the prototype. `PostgresExecutionStore` builds its own
 * `pg.Pool` from a connection string, and `pg` connects lazily, so no socket is opened
 * and the stub intercepts the query before it would reach a database.
 */

const WORKSPACE_A = 'workspace-a';
const WORKSPACE_B = 'workspace-b';

interface Row {
  id: string;
  workspace_id: string;
  cron_expr: string;
  run_options: Record<string, unknown>;
  enabled: boolean;
  next_run_at: Date;
}

/** A schedule row whose column and JSONB agree, unless one is overridden. */
function row(overrides: Partial<Row> = {}): Row {
  const workspaceId = overrides.workspace_id ?? WORKSPACE_A;
  return {
    id: 'schedule-1',
    workspace_id: workspaceId,
    cron_expr: '*/5 * * * *',
    run_options: {
      request: {
        workspaceId,
        projectId: 'project-1',
        environmentId: 'environment-1',
        releaseId: 'release-1',
        branch: 'main',
        commit: 'abc123',
      },
    },
    enabled: true,
    next_run_at: new Date('2026-09-27T00:00:00.000Z'),
    ...overrides,
  };
}

/** Capture the SQL the store sends, and answer with `rows`. */
function stubQuery(rows: Row[]): { sql: () => string } {
  const query = vi
    .spyOn(pg.Pool.prototype, 'query')
    .mockResolvedValue({ rows, rowCount: rows.length } as never);
  return { sql: () => String(query.mock.calls[0]?.[0] ?? '') };
}

const store = (): PostgresExecutionStore => new PostgresExecutionStore('postgres://unused/unused');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('schedules are scoped by the workspace column, not by JSONB', () => {
  it('reads the workspace column, so the query can be trusted to carry it', async () => {
    // The first version of this assertion did not exist, which is how the column could
    // be dropped from the SELECT and the mapping still returned a workspace — from the
    // blob. Asserting the SQL is the only thing that pins the read itself.
    const captured = stubQuery([row()]);
    await store().listDueSchedules(new Date('2026-09-27T01:00:00.000Z'), 10);
    expect(captured.sql()).toMatch(/\bworkspace_id\b/);
  });

  it('takes the tenant from the column', async () => {
    stubQuery([row()]);
    const [schedule] = await store().listDueSchedules(new Date('2026-09-27T01:00:00.000Z'), 10);
    expect(schedule?.request.workspaceId).toBe(WORKSPACE_A);
  });

  it('refuses a row whose run_options name a different workspace', async () => {
    // The cross-tenant case, and the reason the column is worth having. The row claims
    // workspace B in its JSONB and workspace A in the column; a run in either tenant
    // would be a run in a workspace its author did not select.
    stubQuery([
      row({
        workspace_id: WORKSPACE_A,
        run_options: {
          request: {
            workspaceId: WORKSPACE_B,
            projectId: 'project-1',
            environmentId: 'environment-1',
            releaseId: 'release-1',
            branch: 'main',
            commit: 'abc123',
          },
        },
      }),
    ]);

    // Refusing, rather than silently preferring the column, is the point: a schedule
    // that cannot be trusted must not be enqueued at all, and the failure has to be
    // loud enough that someone repairs the row.
    await expect(
      store().listDueSchedules(new Date('2026-09-27T01:00:00.000Z'), 10),
    ).rejects.toThrow(/declares workspace workspace-a but its run_options name workspace-b/);
  });

  it('refuses a row whose run_options carry no workspace at all', async () => {
    // The other half of the original defect: there is no column to compare against, so
    // the only way this was ever safe was for something to require the value. A blob
    // with no `workspaceId` must not become a run in an arbitrary tenant.
    stubQuery([
      row({
        run_options: {
          request: {
            projectId: 'project-1',
            environmentId: 'environment-1',
            releaseId: 'release-1',
            branch: 'main',
            commit: 'abc123',
          },
        },
      }),
    ]);
    await expect(
      store().listDueSchedules(new Date('2026-09-27T01:00:00.000Z'), 10),
    ).rejects.toThrow();
  });

  it('returns each schedule under its own workspace, never a shared one', async () => {
    // The worker legitimately serves every workspace, the way the API does, so the
    // property is not "only one workspace appears" — it is that a schedule is never
    // enqueued under a workspace other than its own.
    stubQuery([
      row({ id: 'schedule-a', workspace_id: WORKSPACE_A }),
      row({ id: 'schedule-b', workspace_id: WORKSPACE_B }),
    ]);
    const schedules = await store().listDueSchedules(new Date('2026-09-27T01:00:00.000Z'), 10);
    const byId = Object.fromEntries(schedules.map((s) => [s.id, s.request.workspaceId]));
    expect(byId).toEqual({ 'schedule-a': WORKSPACE_A, 'schedule-b': WORKSPACE_B });
  });

  it('still rejects an invalid misfire policy', async () => {
    // Adjacent to the trust check and worth keeping: a malformed policy is refused for
    // the same reason a mismatched workspace is, and the new guard must not have
    // displaced it.
    stubQuery([
      row({
        run_options: {
          misfirePolicy: 'whenever',
          request: {
            workspaceId: WORKSPACE_A,
            projectId: 'p',
            environmentId: 'e',
            releaseId: 'r',
            branch: 'main',
            commit: 'c',
          },
        },
      }),
    ]);
    await expect(
      store().listDueSchedules(new Date('2026-09-27T01:00:00.000Z'), 10),
    ).rejects.toThrow(/invalid misfire policy/);
  });
});
