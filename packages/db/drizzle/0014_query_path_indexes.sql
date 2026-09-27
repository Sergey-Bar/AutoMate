-- Q0.13 — a per-endpoint EXPLAIN fixture, and the two gaps it immediately surfaced.
--
-- `tests/integration/src/query-index-fixture.test.ts` states, for each hot query, the
-- index it is served by. Two of the statements it made about this schema were wrong,
-- and both were gaps rather than typos:
--
-- 1. `quarantine` had **no index at all**. `GET /api/v1/dashboard/quarantine` is
--    `SELECT … ORDER BY quarantined_at`, so every load sorted the whole table, and the
--    cost grew with every entry ever quarantined. On a self-hosted install where
--    quarantines accumulate for years that is the whole table, every dashboard load.
--
-- 2. The runs listing filters on `workspace_id` and orders by `(created_at, id)`.
--    Only `runs_workspace_id_idx` existed, so Postgres located the workspace's rows
--    by index and then **sorted** them. The `limit`/`cursor` window is a small slice
--    of a sorted set, and sorting the workspace's entire history to take 25 rows is
--    the cost the pagination was added to remove. `(workspace_id, created_at, id)`
--    makes the window an ordered index scan with no sort at all, and the composite
--    order matches the query's `ORDER BY created_at ASC, id ASC` exactly, so the
--    planner does not need to re-sort for the cursor's tiebreak either.
--
-- The two `execution_jobs` indexes the fixture also names —
-- `execution_jobs_claim_idx` on `(state, available_at, priority)` and
-- `execution_jobs_lease_expiry_idx` on `(state, lease_expires_at)` — already existed
-- under different names than the fixture guessed. The names here are the ones in the
-- catalogue, and the fixture reads the catalogue rather than a restated list, so a
-- rename would fail the test rather than silently pass it.

CREATE INDEX IF NOT EXISTS "quarantine_quarantined_idx" ON "quarantine" ("quarantined_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_workspace_created_idx"
  ON "runs" ("workspace_id", "created_at", "id");
