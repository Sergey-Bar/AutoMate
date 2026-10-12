-- F0.3 — the score's photographs: `derived_score_points`.
--
-- ## Why a table the score can be recomputed without
--
-- The trend on `GET /qa/score` was **two points long** — this window and the
-- one before it — because the score is a pure function of one window, and a
-- longer series means re-reading every earlier window on every page load. A
-- chart with two points is not a direction; it is a number with a second number
-- beside it, and a reader who cannot see a trend stops looking for one.
--
-- So each read writes what it produced, and the next read reads the series
-- back. **The row is a photograph, never a re-derivation.** Nothing reads
-- `total` to answer "what is the score": the answer is computed on every
-- request from the runs, exactly as before. Deleting every row in this table
-- changes no verdict, no gate and no score — it shortens a chart, which is the
-- whole of the honesty claim. `qaScore` states the same property about itself.
--
-- ## The point's identity is the window, not the write
--
-- `(workspace_id, project_id, at)` is unique and the write is an upsert, so two
-- reads of an unchanged window produce **identical points** — the second is a
-- no-op rather than a second row an inch from the first. A `written_at`-keyed
-- table would grow one row per page load and the trend would lie: a window read
-- twice would appear twice, as though the score had moved between two identical
-- readings.
--
-- `at` is also the window of whatever was read — usually now, but a diff read
-- at an earlier instant writes the photograph of *that* window, which is a real
-- reading and a real point.
--
-- ## One row per reading, not one row per window — and what bounds it
--
-- **Each route stamps its own `at`, so two reads of the same data do not share a
-- key and the upsert does not fire.** The natural key is what makes a *repeated
-- read of the same instant* a no-op (a diff read at an earlier instant, or two
-- callers agreeing a clock), not what makes the table one row per window. The
-- table therefore grows at one row per score read, and `SCORE_TREND_POINTS` (30)
-- newest points per project are pruned on write by `DrizzleScorePointStore.retain`
-- — a bound in the write, because a retention timer is a thing a deployment can
-- forget to install. The trend reads the same 30, so the history a project keeps
-- is exactly the history a chart publishes.
--
-- ## Why `labels` is jsonb and not columns
--
-- The cells are the schema's fifteen keys, and a column per cell would mean a
-- schema migration the day a cell is renamed. The photograph's job is to say
-- *why* the total was what it was, and the score already publishes every cell
-- as `{ key: score }`; freezing that object is cheaper than normalising it and
-- asks nothing of a reader who wants the reason rather than a query.

CREATE TABLE IF NOT EXISTS "derived_score_points" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Tenancy: a project's score history is as tenant-private as the verdicts
  -- beside it. **`text`, not `uuid`** — the tenant key is a name
  -- (`DEFAULT_WORKSPACE_ID` is `'default-workspace'`) and every other tenant
  -- column in this schema is `text`; a uuid here failed `22P02` on the default
  -- install, which is how `decision_records` was shipped broken for a week. No
  -- `references()`: a workspace id this install has not resolved is a row nobody
  -- can read, not a row that may not exist. `ON DELETE CASCADE` on the project
  -- below, the same choice `decision_records` made: a deleted project leaves
  -- behind nothing describing a repository that no longer exists.
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  -- The instant the window was read at — the point's identity, and the label
  -- the trend publishes beside it.
  "at" timestamp with time zone NOT NULL,
  -- The total that reading produced, 0–100.
  "total" double precision NOT NULL,
  -- The cell totals that produced it, frozen: `{ "unit:api": 0.83, … }`.
  "labels" jsonb NOT NULL,
  "written_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- The natural key, and the reason the upsert needs no `coalesce`: none of these
-- three columns is nullable, so a plain unique index is exact here. (This is
-- the distinction `decision_records` needed `coalesce(cell, '')` for.)
--
-- It doubles as the read index: "the newest N points for this project" is a
-- backward scan of the same three columns in the same order.
CREATE UNIQUE INDEX IF NOT EXISTS "derived_score_points_project_at_key"
    ON "derived_score_points" ("workspace_id", "project_id", "at");
