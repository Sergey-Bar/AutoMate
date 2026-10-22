-- MNT-18 — the seven tables that were hard-scoped before 0028 get the key they were missing.
--
-- `schedules` (0015), `outbox_events` (0017), `conversations` and `messages` (0018),
-- `connector_configs` and `vault_entries` (0020) and `canonical_run_results` (0005) each
-- carry `workspace_id text NOT NULL` and an index that leads with it, but no foreign key
-- onto `workspaces`. NOT NULL says a row names *a* workspace; only the key says it names
-- one that exists. 0028's header calls the unkeyed column "a label, not a boundary", and
-- this migration applies the same rule to the tables 0028 did not touch:
--
--     FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict
--
-- `restrict`, never `cascade`, for 0028's reason: deleting a workspace must not silently
-- erase its schedules, its transcripts or its encrypted credentials.
--
-- No index is created. Every one of the seven already has one leading with
-- `workspace_id` (0005, 0015, 0017, 0018, 0020), which is also what the key's
-- `ON DELETE restrict` check scans.
--
-- ## What happens to rows that would violate the key
--
-- Nothing is deleted and nothing is re-labelled, in this order:
--
--   1. A **blank** `workspace_id` names no workspace. Registering `''` would invent a
--      tenant, and none of these rows has a parent to take one from, so the migration
--      raises naming the table and applies nothing.
--   2. A **message whose workspace disagrees with its conversation's** is a cross-tenant
--      record. Registering the message's workspace would make it look valid, so that is a
--      raise too.
--   3. A workspace id the rows **already name** but `workspaces` never registered is
--      registered — 0028's step 2, for the same reason: the rows claim it, and the missing
--      key is the only reason they could.

-- Step 1 — refuse a blank workspace, naming the table.
DO $$
DECLARE
  target text;
  blank integer;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'schedules', 'outbox_events', 'conversations', 'messages',
    'connector_configs', 'vault_entries', 'canonical_run_results'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE btrim(workspace_id) = %L', target, '')
      INTO blank;
    IF blank > 0 THEN
      RAISE EXCEPTION
        '%.workspace_id: % row(s) carry a blank workspace, which names no workspace, and the '
        'table is gaining a foreign key onto workspaces. This migration will not choose one: '
        'give those rows the workspace they belong to, or remove them, before migrating.',
        target, blank;
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint

-- Step 2 — a message belongs to its conversation's workspace, or the migration stops.
DO $$
DECLARE
  disagreeing integer;
BEGIN
  SELECT count(*) INTO disagreeing
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
   WHERE m.workspace_id <> c.workspace_id;
  IF disagreeing > 0 THEN
    RAISE EXCEPTION
      'messages.workspace_id: % message(s) name a different workspace from their conversation, '
      'so the transcript would span two tenants. Reconcile those rows before migrating.',
      disagreeing;
  END IF;
END
$$;
--> statement-breakpoint

-- Step 3 — register the workspaces the data already names.
INSERT INTO workspaces (id, name, config_path, created_at)
SELECT named.id, named.id, 'config', now()
  FROM (
        SELECT workspace_id AS id FROM schedules
        UNION SELECT workspace_id FROM outbox_events
        UNION SELECT workspace_id FROM conversations
        UNION SELECT workspace_id FROM messages
        UNION SELECT workspace_id FROM connector_configs
        UNION SELECT workspace_id FROM vault_entries
        UNION SELECT workspace_id FROM canonical_run_results
       ) AS named
 WHERE NOT EXISTS (SELECT 1 FROM workspaces existing WHERE existing.id = named.id);
--> statement-breakpoint

-- Step 4 — the keys.
ALTER TABLE schedules ADD CONSTRAINT schedules_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE conversations ADD CONSTRAINT conversations_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE messages ADD CONSTRAINT messages_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE connector_configs ADD CONSTRAINT connector_configs_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE vault_entries ADD CONSTRAINT vault_entries_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE canonical_run_results ADD CONSTRAINT canonical_run_results_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
