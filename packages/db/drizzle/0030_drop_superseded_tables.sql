-- MNT-60 — drop the three tables the product superseded (ledger C-6).
--
-- `docs/quality/capability-justification.md` recorded three tables as superseded, and a
-- search of `apps/`, `packages/`, `tools/`, `tests/` and `scripts/` found nothing that
-- reads or writes them:
--
--   results      per-retry results            superseded by `canonical_run_results`
--   blob_shards  sharded blob uploads         superseded by `runs.read_at`
--   api_keys     personal API keys            superseded by the installation key
--
-- ## What else named them
--
-- Two live tables carried a foreign key onto `results`, and that is why this is not a bare
-- DROP TABLE:
--
--   attachments.result_id  -> results.id  (0000, ON DELETE cascade)
--   artifacts.result_id    -> results.id  (0003, ON DELETE set null)
--
-- Both keys are dropped first. The columns, their values and `artifacts_result_idx` stay:
-- they are a record of which legacy result a row came from, and erasing it is not this
-- migration's decision. `CASCADE` is deliberately not used on the DROP, so a dependant
-- nobody found makes the migration fail loudly instead of being removed silently.
--
-- ## Data
--
-- A migration must not delete data by default. If any of the three tables holds a row the
-- migration raises, naming each such table and its row count, and applies nothing. The
-- operator who has reviewed those rows opts in for the session:
--
--     SET automate.allow_drop_nonempty = 'on';
--
-- and an empty table (every install that never used the table) needs no setting.

-- Step 1 — refuse to drop a table that holds rows, unless the operator said so.
DO $$
DECLARE
  target text;
  held integer;
  found text := '';
  allowed boolean;
BEGIN
  allowed := lower(btrim(coalesce(current_setting('automate.allow_drop_nonempty', true), ''))) = 'on';
  FOREACH target IN ARRAY ARRAY['results', 'blob_shards', 'api_keys'] LOOP
    IF to_regclass(format('public.%I', target)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM %I', target) INTO held;
    IF held > 0 THEN
      found := found || format('%s%s: %s row(s)', CASE WHEN found = '' THEN '' ELSE ', ' END, target, held);
    END IF;
  END LOOP;
  IF found <> '' AND NOT allowed THEN
    RAISE EXCEPTION
      'Refusing to drop superseded tables that hold rows (%). Review the rows, then run '
      'SET automate.allow_drop_nonempty = ''on'' in the migrating session to drop them anyway.',
      found;
  END IF;
END
$$;
--> statement-breakpoint

-- Step 2 — the two foreign keys that named `results`. Columns and values are kept.
ALTER TABLE "attachments" DROP CONSTRAINT IF EXISTS "attachments_result_id_results_id_fk";
--> statement-breakpoint
ALTER TABLE "artifacts" DROP CONSTRAINT IF EXISTS "artifacts_result_id_results_id_fk";
--> statement-breakpoint

-- Step 3 — the tables. No CASCADE: an unknown dependant is a failure, not a deletion.
DROP TABLE IF EXISTS "api_keys";
--> statement-breakpoint
DROP TABLE IF EXISTS "blob_shards";
--> statement-breakpoint
DROP TABLE IF EXISTS "results";
