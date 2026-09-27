-- Q0.11.7 — give a quality gate its own `name` column, and stop writing it into
-- `workspace_id`.
--
-- `DrizzleQualityGateStore.add()` stored the gate's **display name** in
-- `workspace_id`, and `list()`/`get()` read the name back out of that same column:
--
--   await this.db.insert(qualityGateConfig).values({ id, workspaceId: gate.name, ... })
--   name: row.workspaceId ?? 'Unnamed gate'
--
-- Two separate defects from one mapping. The row was scoped to a workspace that
-- does not exist, so nothing that scopes by `workspace_id` could ever find it; and
-- the column that scopes a row was carrying a free-text label, so any future code
-- reading `workspace_id` to decide visibility would be reading a gate's name.
--
-- `list()` also filtered the `global` row out with `ne(id, 'global')`, so on a
-- fresh install — where the default gate config is the *only* row — the dashboard
-- reported no gates at all. The row is not noise: it is the default every
-- evaluation falls back to, and hiding it is how a configured threshold becomes
-- an invisible one.
--
-- The backfill recovers the only human-meaningful value that was stored. Where
-- `workspace_id` names a real workspace it is a genuine scope and is left alone —
-- the gate is simply given a name derived from it, because there is nothing else to
-- call it. Where it is not a real workspace it was a gate name written by the
-- mapping above, so it moves to `name` and `workspace_id` is cleared: keeping it
-- would leave a row that claims a scope no workspace has.
--
-- `NOT NULL` with a default afterwards, so an insert that omits `name` still works
-- (the Drizzle column carries the same default) and the database can never hold a
-- nameless gate.

ALTER TABLE "quality_gate_config" ADD COLUMN IF NOT EXISTS "name" text;
--> statement-breakpoint
UPDATE "quality_gate_config"
   SET "name" = CASE
         WHEN "id" = 'global' THEN 'Global default'
         WHEN "workspace_id" IS NULL THEN 'Unnamed gate'
         ELSE "workspace_id"
       END
 WHERE "name" IS NULL;
--> statement-breakpoint
UPDATE "quality_gate_config"
   SET "workspace_id" = NULL
 WHERE "workspace_id" IS NOT NULL
   AND "workspace_id" NOT IN (SELECT "id" FROM "workspaces");
--> statement-breakpoint
ALTER TABLE "quality_gate_config" ALTER COLUMN "name" SET DEFAULT 'Unnamed gate';
--> statement-breakpoint
ALTER TABLE "quality_gate_config" ALTER COLUMN "name" SET NOT NULL;
