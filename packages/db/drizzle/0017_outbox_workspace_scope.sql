-- W7 — `outbox_events` becomes tenant-scoped, and a dedupe key stops being global.
--
-- Two ways this table silently lost events, both invisible in production because
-- neither raised anything.
--
-- 1. **`dedupe_key` was unique on its own.** Two workspaces using the same dedupe key —
--    and a key derived from something as ordinary as a job id or an idempotency token
--    collides across tenants constantly — meant the second workspace's event was
--    suppressed by `onConflictDoNothing({ target: dedupeKey })`. The append returned
--    `rows[0] ?? null`, the consumer saw no row, and it returned without an error. A
--    tenant's event simply never existed, and the sender believed it was recorded.
--    The key is now unique **per workspace**, which is the only scope in which
--    "duplicate" is meaningful.
--
-- 2. **`workspace_id` was nullable while delivery filtered on it.** `readAfter` matches
--    `workspace_id = $1`, so a row with NULL was invisible to every consumer — yet it
--    still consumed an identity sequence number, so the sequence a consumer was tracking
--    advanced past an event it would never be shown, and it counted toward the retention
--    floor that decides when the table can be trimmed. The gap was not "a delay": it was
--    permanent, and it moved the watermark so the evidence was trimmed sooner too.
--
-- **NULL rows are not repaired here.** A row with no workspace cannot be attributed to
-- one, and inventing an attribution would be the same class of defect as the unvalidated
-- workspace that P-20 removed from `schedules`. The migration raises and counts instead,
-- so an operator decides per row: re-scope it to the workspace that actually owns the
-- event, or delete it. Leaving them is the one option the finding explicitly rules out,
-- because an undeliverable row that still advances the sequence is the whole failure.

-- Step 1 — the pre-audit. Read-only.
DO $$
DECLARE
  unattributed integer;
BEGIN
  SELECT count(*) INTO unattributed
    FROM outbox_events
   WHERE workspace_id IS NULL OR btrim(workspace_id) = '';

  IF unattributed > 0 THEN
    RAISE EXCEPTION
      '% outbox event(s) carry no workspace_id and can never be delivered: readAfter matches on '
      'workspace_id, so these rows are invisible to every consumer while still consuming a sequence '
      'number and counting toward the retention floor. Re-scope each row to the workspace that owns '
      'the event, or delete it. This migration will not guess an attribution.',
      unattributed;
  END IF;
END
$$;

-- Step 2 — the dedupe scope. A duplicate is only a duplicate within a tenant.
ALTER TABLE outbox_events DROP CONSTRAINT IF EXISTS outbox_events_dedupe_idx;
DROP INDEX IF EXISTS outbox_events_dedupe_idx;
CREATE UNIQUE INDEX outbox_events_workspace_dedupe_idx
    ON outbox_events (workspace_id, dedupe_key);

-- Step 3 — and the column can no longer be absent.
ALTER TABLE outbox_events ALTER COLUMN workspace_id SET NOT NULL;
