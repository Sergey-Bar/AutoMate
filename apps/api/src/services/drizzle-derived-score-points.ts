import { derivedScorePoints } from '@automate/db';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import type { PgliteQueryResultHKT } from 'drizzle-orm/pglite';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { ScorePointRow } from '@automate/db';
import type { ScorePointStore, ScorePointWrite } from './derived-score-points.js';
import { SCORE_TREND_POINTS } from './derived-score-points.js';

type Driver = PgQueryResultHKT | PgliteQueryResultHKT;

/**
 * The photographs, in PostgreSQL.
 *
 * ## The upsert is the whole invariant
 *
 * `ON CONFLICT (workspace_id, project_id, at) DO UPDATE` is what makes two
 * reads of an unchanged window produce identical points rather than two rows an
 * inch apart. The conflict target is the unique index migration 0027 declares,
 * and it is a plain column list — no expression and no nullable column — which
 * is the distinction from `decision_records`, whose `coalesce(cell, '')` key
 * forced a read-then-write there and a plain upsert here.
 *
 * ## The read is the same index, backwards
 *
 * "The newest N points for this project" is `order by at desc limit N` over
 * `(workspace_id, project_id, at)`, reversed into chronological order on the way
 * out. There is one index, not two, and the plan the trend needs is the plan the
 * upsert already built.
 */
export class DrizzleScorePointStore implements ScorePointStore {
  constructor(private readonly db: PgDatabase<Driver>) {}

  async record(point: ScorePointWrite): Promise<void> {
    const now = new Date();
    await this.db
      .insert(derivedScorePoints)
      .values({
        workspaceId: point.workspaceId,
        projectId: point.projectId,
        at: new Date(point.at),
        total: point.total,
        labels: point.labels,
        writtenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          derivedScorePoints.workspaceId,
          derivedScorePoints.projectId,
          derivedScorePoints.at,
        ],
        set: {
          // `writtenAt` deliberately does **not** move: it is when the window was
          // first photographed, and a second read of the same window did not
          // take a second photograph. `updatedAt` does, because the row was
          // rewritten.
          total: point.total,
          labels: point.labels,
          updatedAt: now,
        },
      });
    await this.retain(point.workspaceId, point.projectId);
  }

  /**
   * Keep the newest `SCORE_TREND_POINTS` points for one project, and no more.
   *
   * ## Why the write carries a prune
   *
   * **`at` is the reading's clock, so the table grows by one row per score read,
   * not per window** — seven per `/today` page load — and nothing else in the
   * product deletes from it. The unique key means a *repeated read of the same
   * instant* is a no-op (which is what the upsert is for, and what a diff read
   * at an earlier instant produces), but each route stamps its own clock, so
   * that path is the exception rather than the rule. A retention timer would be
   * one more thing to remember to wire; a prune in the write cannot be forgotten.
   *
   * The bound is the same number the read asks for, so a project's history is
   * exactly what the trend publishes: nothing is kept that nothing reads, and the
   * trend can never publish less than its own window.
   */
  private async retain(workspaceId: string, projectId: string): Promise<void> {
    const kept = await this.db
      .select({ id: derivedScorePoints.id })
      .from(derivedScorePoints)
      .where(
        and(
          eq(derivedScorePoints.workspaceId, workspaceId),
          eq(derivedScorePoints.projectId, projectId),
        ),
      )
      .orderBy(desc(derivedScorePoints.at))
      .limit(SCORE_TREND_POINTS);
    // Nothing to prune until the project has more history than the trend reads,
    // which is also why `notInArray` is never handed an empty list.
    if (kept.length < SCORE_TREND_POINTS) return;
    await this.db.delete(derivedScorePoints).where(
      notInArray(
        derivedScorePoints.id,
        kept.map((row) => row.id),
      ),
    );
  }

  async listRecent(
    projectId: string,
    workspaceId: string,
    limit: number,
  ): Promise<ScorePointRow[]> {
    const rows = await this.db
      .select()
      .from(derivedScorePoints)
      .where(
        and(
          eq(derivedScorePoints.workspaceId, workspaceId),
          eq(derivedScorePoints.projectId, projectId),
        ),
      )
      .orderBy(desc(derivedScorePoints.at))
      .limit(Math.max(0, limit));
    // Newest first from SQL, oldest first on the way out — the same reversal the
    // in-memory store performs, so the two cannot disagree about the order.
    return rows.reverse().map((row) => ({
      id: row.id,
      projectId: row.projectId,
      workspaceId: row.workspaceId,
      at: row.at.toISOString(),
      total: row.total,
      labels: row.labels,
      writtenAt: row.writtenAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
}
