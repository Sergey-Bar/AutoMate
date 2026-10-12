import type { ScoreTrendPoint } from '@automate/shared-contracts';
import type { ScorePointRow } from '@automate/db';

/**
 * The score's photographs — where a reading is written and read back.
 *
 * ## A photograph, never a re-derivation
 *
 * The score is a pure function of one window, and it stays one. Nothing reads a
 * point to answer "what is the score": deleting every row in this store changes
 * no verdict, no gate and no total. What the store buys is a trend long enough
 * to chart — `ScoreTrendPoint` was two points long before it existed, because a
 * longer series meant re-reading every earlier window on every page load, and a
 * chart with two points is a number with a second number beside it rather than a
 * direction.
 *
 * ## The window is the identity, so an unchanged window is one point
 *
 * `record` is an upsert on `(workspace_id, project_id, at)`. Two reads of an
 * unchanged window therefore produce **identical** points — the second write is a
 * no-op rather than a second row an inch from the first.
 *
 * ## And `at` is the reading's clock, so the table is bounded on purpose
 *
 * Each route stamps its own `at`, so the table grows by one row per score read
 * rather than per window — seven per `/today` page load. That is the honest cost
 * of a pure score: an instant is not derivable from the data, so it has to be
 * chosen. What keeps it honest is the bound, not the hope that two reads will
 * share an instant: `SCORE_TREND_POINTS` newest points per project, pruned on
 * write, in both stores.
 *
 * ## Every method takes the workspace
 *
 * The same rule the execution stores follow, for the same reason: a project's
 * score history is tenant-private, and a caller who has the value cannot forget
 * it. `workspace-isolation.test.ts` claims this module and its Drizzle sibling.
 */
export interface ScorePointStore {
  /** Writes the photograph of one window. Idempotent per `(workspace, project, at)`. */
  record(point: ScorePointWrite): Promise<void>;
  /** The newest `limit` points for one project, **oldest first**. */
  listRecent(projectId: string, workspaceId: string, limit: number): Promise<ScorePointRow[]>;
}

/** The photograph one reading produces. */
export interface ScorePointWrite {
  projectId: string;
  workspaceId: string;
  /** The instant the window was read at — the point's identity, not its write time. */
  at: string;
  /** The total that reading produced, `0`–`100`. */
  total: number;
  /** The cell totals that produced it, as the score published them: `{ key: score }`. */
  labels: Record<string, number>;
}

/**
 * The points as a trend: totals oldest first, with the instant each names.
 *
 * **Not a re-derivation and not a re-sort.** The store returns oldest first, so
 * this is a projection — which is what keeps the two arrays the same length the
 * contract demands (`ScoreTrendPointSchema` enforces it at the source).
 */
export function seriesOf(points: readonly ScorePointRow[]): ScoreTrendPoint {
  return {
    points: points.map((point) => point.total),
    labels: points.map((point) => point.at),
  };
}

/**
 * How many windows the trend reads back.
 *
 * Thirty, and the number is about the chart rather than the data: a series long
 * enough to see a quarter of weekly runs, short enough that the read is one
 * backward index scan. The store keeps every point it is given — this is a
 * *read* limit, not a retention window — so raising it later costs nothing but
 * the wider scan.
 */
export const SCORE_TREND_POINTS = 30;

/**
 * The in-memory store, for an install with no database and for a test.
 *
 * Same upsert rule as the SQL one — the window replaces, the identity is
 * `(workspace, project, at)` — because a test that writes two points for one
 * window and reads one back is asserting the production rule, and an in-memory
 * store that appended would let the test pass against a store that cannot ship.
 */
export class InMemoryScorePointStore implements ScorePointStore {
  private readonly rows = new Map<string, ScorePointRow>();
  private counter = 0;

  private static key(workspaceId: string, projectId: string, at: string): string {
    return [workspaceId, projectId, at].join('\u0000');
  }

  async record(point: ScorePointWrite): Promise<void> {
    const key = InMemoryScorePointStore.key(point.workspaceId, point.projectId, point.at);
    const existing = this.rows.get(key);
    const writtenAt = new Date().toISOString();
    this.counter += 1;
    this.rows.set(key, {
      id: existing?.id ?? `score-point-${String(this.counter)}`,
      projectId: point.projectId,
      workspaceId: point.workspaceId,
      at: point.at,
      total: point.total,
      labels: point.labels,
      writtenAt: existing?.writtenAt ?? writtenAt,
      updatedAt: writtenAt,
    });
    // The same bound the SQL store enforces, for the same reason: the table is one
    // row per reading, and a store that grew without limit would make a test and a
    // deployment disagree about how much history exists. Scoped to the project
    // being written, exactly as the SQL `retain` is — a global bound would let one
    // busy project evict another's history.
    const mine = [...this.rows.values()].filter(
      (row) => row.workspaceId === point.workspaceId && row.projectId === point.projectId,
    );
    if (mine.length > SCORE_TREND_POINTS) {
      const oldest = mine
        .sort((left, right) => right.at.localeCompare(left.at))
        .slice(SCORE_TREND_POINTS);
      for (const row of oldest) {
        this.rows.delete(InMemoryScorePointStore.key(row.workspaceId, row.projectId, row.at));
      }
    }
  }

  async listRecent(
    projectId: string,
    workspaceId: string,
    limit: number,
  ): Promise<ScorePointRow[]> {
    return (
      [...this.rows.values()]
        .filter((row) => row.workspaceId === workspaceId && row.projectId === projectId)
        .sort((left, right) => right.at.localeCompare(left.at))
        .slice(0, Math.max(0, limit))
        // Newest first internally, oldest first on the way out: the trend's series
        // is chronological, and reversing here rather than in the caller is what
        // keeps one store's ordering decision instead of two.
        .reverse()
    );
  }
}
