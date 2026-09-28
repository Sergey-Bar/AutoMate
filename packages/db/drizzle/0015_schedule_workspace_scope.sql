-- W1.3 — `schedules` gets a real tenancy column, and the workspace stops being a
-- JSONB string anybody can write.
--
-- `apps/worker/src/postgres-store.ts` selected every enabled schedule with no workspace
-- predicate and then read `workspaceId` out of `run_options->'request'`, which is
-- untyped JSONB. Two problems, and the second is the serious one:
--
--  1. Nothing scoped the read. `WORKSPACE_ID` is the only tenancy boundary in this
--     system, and a schedule in workspace B was handed to whichever worker polled.
--  2. Nothing validated the value. `schedules` had **no** `workspace_id` column at all,
--     so the workspace was whatever a writer put in the JSON. Any principal able to
--     insert a schedule row chose the workspace its run would execute in, and the worker
--     had no way to notice.
--
-- The column is the fix for both. It makes the tenant a first-class, indexable,
-- type-checked fact rather than a string inside a blob, and it gives the worker
-- something to *compare the JSONB against* — which is what turns an unvalidated blob
-- into a checked one. The worker now takes the workspace from this column and refuses a
-- row whose `run_options` disagrees, so a row that disagrees is a loud failure rather
-- than a cross-tenant run.
--
-- **The backfill fails closed.** `workspace_id` is `NOT NULL`, and a row whose JSONB
-- carries no workspace cannot be migrated into one: there is no correct value to invent
-- for it, and defaulting to a placeholder would silently create a schedule that runs in
-- a workspace nobody chose. So the migration raises rather than guessing, and names the
-- rows so an operator can fix them. Every route already derives the workspace from the
-- authenticated principal, so no request is served without one.
--
-- Additive, not destructive: nothing is dropped, rewritten or narrowed, so this is not
-- the kind of migration the rehearsal gate in W6 exists for. It is still a
-- `NOT NULL` addition with a backfill, which is why it carries the reasoning above
-- rather than a bare `ALTER TABLE`.

ALTER TABLE schedules ADD COLUMN workspace_id text;

UPDATE schedules
   SET workspace_id = run_options -> 'request' ->> 'workspaceId'
 WHERE workspace_id IS NULL;

-- Fail closed, and say which rows. Inventing a workspace here would create a schedule
-- that fires in a tenant nobody selected, which is the exact class of defect this
-- column exists to remove.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM schedules
     WHERE workspace_id IS NULL
        OR btrim(workspace_id) = ''
  ) THEN
    RAISE EXCEPTION
      'schedules.workspace_id is NOT NULL and % row(s) carry no workspace in run_options->request->workspaceId. '
      'Every schedule must name the workspace its run executes in. Re-create those rows with an explicit '
      'workspace before migrating; this migration will not choose one for you.',
      (SELECT count(*) FROM schedules
        WHERE workspace_id IS NULL OR btrim(workspace_id) = '');
  END IF;
END
$$;

ALTER TABLE schedules ALTER COLUMN workspace_id SET NOT NULL;

-- Serves the only query that reads this table. `listDueSchedules` filters
-- `enabled = true` and orders by the coalesced next-run timestamp, and the composite
-- order matches the filter rather than the sort, so the batch is an index scan with no
-- sort over every enabled schedule in the installation.
CREATE INDEX schedules_workspace_due_idx
    ON schedules (workspace_id, last_run_at)
 WHERE enabled = true;
