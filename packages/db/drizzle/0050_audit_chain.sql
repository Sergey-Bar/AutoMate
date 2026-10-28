-- The audit trail as a hash chain per workspace, and append-only (ADR-014, enterprise).
--
-- A trigger, not a convention: every insert by every writer gets its position in the
-- workspace's chain, the previous row's hash and its own, under an advisory lock per
-- workspace so two concurrent writers cannot fork the chain. `audit_chain_breaks` recomputes
-- it and names each row edited, deleted from the middle, or relinked. An UPDATE is refused.
--
-- What this proves and what it does not: someone who can switch the triggers off and rewrite
-- every row from one point to the end can produce a consistent chain. The export carries the
-- head hash, so a head recorded elsewhere is what makes that rewrite visible too.

ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "chain_seq" bigint;
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "prev_hash" text;
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "hash" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "audit_events_workspace_chain_idx"
  ON "audit_events" ("workspace_id", "chain_seq");
--> statement-breakpoint
-- The hash of one row: every field that says what happened, joined with the unit separator
-- so no field can borrow another's bytes, and the timestamp at microsecond precision in UTC.
CREATE OR REPLACE FUNCTION audit_event_hash(
  prev text, ws text, seq bigint, ts timestamptz, actor text, actor_type text, action text,
  resource_type text, resource_id text, details jsonb
) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws(chr(31),
    coalesce(prev, ''), ws, seq::text,
    to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    actor, actor_type, action, coalesce(resource_type, ''), coalesce(resource_id, ''),
    coalesce(details::text, '')), 'UTF8')), 'hex')
$$;
--> statement-breakpoint
-- The rows written before this migration, chained in the order they were written.
DO $$
DECLARE
  r record;
  previous text;
  position bigint;
  current_ws text := NULL;
BEGIN
  FOR r IN SELECT * FROM audit_events ORDER BY workspace_id, timestamp, created_at, id LOOP
    IF current_ws IS DISTINCT FROM r.workspace_id THEN
      current_ws := r.workspace_id;
      previous := NULL;
      position := 0;
    END IF;
    position := position + 1;
    UPDATE audit_events
       SET chain_seq = position,
           prev_hash = previous,
           hash = audit_event_hash(previous, r.workspace_id, position, r.timestamp, r.actor_id,
                                   r.actor_type, r.action, r.resource_type, r.resource_id,
                                   r.details)
     WHERE id = r.id
     RETURNING hash INTO previous;
  END LOOP;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_events_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_seq bigint;
  last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit_events:' || NEW.workspace_id, 0));
  SELECT chain_seq, hash INTO last_seq, last_hash
    FROM audit_events
   WHERE workspace_id = NEW.workspace_id AND chain_seq IS NOT NULL
   ORDER BY chain_seq DESC
   LIMIT 1;
  NEW.chain_seq := coalesce(last_seq, 0) + 1;
  NEW.prev_hash := last_hash;
  NEW.hash := audit_event_hash(NEW.prev_hash, NEW.workspace_id, NEW.chain_seq, NEW.timestamp,
                               NEW.actor_id, NEW.actor_type, NEW.action, NEW.resource_type,
                               NEW.resource_id, NEW.details);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_chain BEFORE INSERT ON audit_events
FOR EACH ROW EXECUTE FUNCTION audit_events_chain();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_events_refuse_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: a recorded decision is not edited'
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE ON audit_events
FOR EACH ROW EXECUTE FUNCTION audit_events_refuse_update();
--> statement-breakpoint
-- Every break in one workspace's chain: a row whose content no longer matches its hash
-- (`edited`), a gap in the positions (`missing-before`), or a row that no longer names the
-- hash of the row before it (`relinked`). Empty is an intact chain.
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
   WHERE before_position IS NOT NULL AND position <> before_position + 1
  UNION ALL
  SELECT position, 'relinked' FROM ordered
   WHERE before_position IS NOT NULL AND linked IS DISTINCT FROM before_hash
  ORDER BY 1, 2
$$;
