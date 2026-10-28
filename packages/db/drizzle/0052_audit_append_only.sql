-- The audit trail refuses a DELETE and a TRUNCATE, and the chain check reads its first row
-- (ADR-014, enterprise). Additive, and safe to apply twice.
--
-- `0050_audit_chain` refused an UPDATE and nothing else, so a DELETE of any row and a TRUNCATE
-- of the table went through. Its `audit_chain_breaks` only compared each row with the one before
-- it, so a chain whose first rows were deleted read as intact: the first row left had nothing
-- before it and was never checked. Now a row-level BEFORE DELETE trigger and a statement-level
-- BEFORE TRUNCATE trigger refuse both the way the UPDATE guard does (a TRUNCATE that reaches the
-- table by CASCADE from `workspaces` included), and the check holds a workspace's first chained
-- row to the shape `0050`'s backfill and insert trigger give it: position 1, naming no row
-- before it.
--
-- What this still does not prove. A guard is switched off by whoever may alter the table, its
-- owner or a superuser, which on the bundled stack is the database user the services share:
-- the same bar as an edit. Behind it, two removals are not breaks the chain can see. A removed
-- tail is not a gap, because the insert trigger numbers the next row after the highest position
-- left, so it takes the freed position and links to the row before it; and a trail removed
-- whole leaves nothing to check. A head filed outside Automate covers both: the row at the filed
-- position no longer carries the filed hash, or is not there.

CREATE OR REPLACE FUNCTION audit_events_refuse_removal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: a recorded decision is not removed (%)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER audit_events_append_only_delete BEFORE DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION audit_events_refuse_removal();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER audit_events_append_only_truncate BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT EXECUTE FUNCTION audit_events_refuse_removal();
--> statement-breakpoint
-- `0050`'s three problems, and its first row. The first row left has nothing before it to be
-- compared with, so it is held to the shape every chain starts with: position 1, naming no row
-- before it. Anything else is `missing-before` — the rows ahead of it are gone.
CREATE OR REPLACE FUNCTION audit_chain_breaks(ws text)
RETURNS TABLE (seq bigint, problem text)
LANGUAGE sql STABLE AS $$
  WITH ordered AS (
    SELECT a.chain_seq AS position, a.hash AS stored, a.prev_hash AS linked,
           lag(a.chain_seq) OVER (ORDER BY a.chain_seq) AS before_position,
           lag(a.hash) OVER (ORDER BY a.chain_seq) AS before_hash,
           audit_event_hash(a.prev_hash, a.workspace_id, a.chain_seq, a.timestamp, a.actor_id,
                            a.actor_type, a.action, a.resource_type, a.resource_id,
                            a.details) AS expected
      FROM audit_events a
     WHERE a.workspace_id = ws AND a.chain_seq IS NOT NULL
  )
  SELECT position, 'edited' FROM ordered WHERE stored IS DISTINCT FROM expected
  UNION ALL
  SELECT position, 'missing-before' FROM ordered
   WHERE before_position IS NULL AND (position <> 1 OR linked IS NOT NULL)
  UNION ALL
  SELECT position, 'missing-before' FROM ordered
   WHERE before_position IS NOT NULL AND position <> before_position + 1
  UNION ALL
  SELECT position, 'relinked' FROM ordered
   WHERE before_position IS NOT NULL AND linked IS DISTINCT FROM before_hash
  ORDER BY 1, 2
$$;
