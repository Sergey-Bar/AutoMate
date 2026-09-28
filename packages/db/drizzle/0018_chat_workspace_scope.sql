-- W7 — chat transcripts become workspace-scoped.
--
-- `conversations` carried neither a workspace nor an owner column, and `messages`
-- inherited that from its parent. Every transcript in the installation was therefore
-- globally readable: one query returned every conversation and every message, in every
-- workspace (ledger P-11).
--
-- **The decision, recorded because the plan left it open.** The plan asked whether
-- workspace scope is the intended boundary or whether a per-owner column is required,
-- and noted that the answer blocks the backfill. The answer here is **workspace scope**,
-- for three reasons, and the reasons matter more than the answer because they are what
-- a later reader needs in order to disagree with it:
--
--   1. `WORKSPACE_ID` is the tenancy boundary this repository already commits to
--      everywhere else, and a second boundary would be a new concept introduced by a
--      migration rather than a rule applied consistently.
--   2. Every other tenancy migration in this wave does the same thing to the same class
--      of table — `schedules` in 0015, `outbox_events` in 0017 — so a chat table that
--      behaves differently is a special case someone will trip over.
--   3. Per-user ownership inside a workspace is an *authorisation* question, not a
--      storage one. A workspace is the storage boundary; who inside it may read a given
--      conversation belongs in the route layer, where the request's principal is known.
--      Putting an owner column here would answer half the question in the schema and
--      leave the other half to be re-derived, which is how two different notions of
--      "mine" end up in one product.
--
-- **The backfill cannot be invented.** A conversation with no workspace cannot be
-- attributed to one, and attributing it to the default workspace would silently expose
-- one tenant's transcripts to another — the exact defect being fixed, performed by the
-- fix. The pre-audit therefore raises and counts, and an operator decides per row. In a
-- fresh installation there are no rows and the migration is a no-op; the failing path
-- exists for a populated one, which is where a guess would do damage.
--
-- `messages` inherits the workspace from its conversation rather than carrying its own,
-- because a message cannot exist without its conversation (the foreign key enforces
-- that with `ON DELETE CASCADE`) and a denormalized copy is a second thing that can
-- disagree. It is indexed alongside `conversation_id` so the per-workspace read is a
-- single scan.

-- Step 1 — add the column *nullable*.
--
-- Before the audit, and deliberately. The pre-audit exists to find rows the new
-- constraint would reject, so it has to run while those rows are still permitted —
-- adding the column as `NOT NULL` first would either fail outright on a populated table
-- without saying which rows, or fail the audit with a constraint error instead of the
-- count an operator needs to make a decision.
--> statement-breakpoint
ALTER TABLE conversations ADD COLUMN workspace_id text;
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN workspace_id text;

-- Step 2 — the pre-audit. Read-only, and it counts so an operator sees the blast radius
-- in the transaction rather than in a rollback.
DO $$ DECLARE
  unattributed integer;
BEGIN
  SELECT count(*) INTO unattributed FROM conversations WHERE workspace_id IS NULL;

  IF unattributed > 0 THEN
    RAISE EXCEPTION
      '% conversation(s) carry no workspace_id, and their messages inherit it. Until every row is '
      're-scoped, transcripts remain globally readable — which is the defect this migration fixes — '
      'and guessing an attribution would expose one tenant to another. Re-scope each conversation to '
      'the workspace that owns it, or delete it.',
      unattributed;
  END IF;
END
$$;

-- Step 3 — tighten, now that the audit has cleared the table.
--> statement-breakpoint
ALTER TABLE conversations ALTER COLUMN workspace_id SET NOT NULL;

-- Step 4 — messages inherit it from the parent rather than from anything a caller
-- supplied, so a message cannot claim a workspace its conversation does not have.
--> statement-breakpoint
UPDATE messages
   SET workspace_id = conversations.workspace_id
  FROM conversations
 WHERE messages.conversation_id = conversations.id;
--> statement-breakpoint
ALTER TABLE messages ALTER COLUMN workspace_id SET NOT NULL;

-- Step 5 — the reads that make it usable. The existing indexes are still correct for a
-- single conversation; these are the two queries a workspace-scoped list actually runs.
--> statement-breakpoint
CREATE INDEX conversations_workspace_updated_at_idx
    ON conversations (workspace_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX messages_workspace_conversation_created_idx
    ON messages (workspace_id, conversation_id, created_at);
