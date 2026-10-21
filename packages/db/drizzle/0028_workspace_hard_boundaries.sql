-- MNT-17 — every workspace-scoped table gets a hard tenancy boundary.
--
-- `WORKSPACE_ID` is the only tenancy boundary in this system, and `pnpm tenancy:check`
-- reported 28 workspace-scoped tables without one: `runs` and `audit_events` with a
-- nullable `workspace_id`, `quality_gate_config` nullable by design, and 25 tables with no
-- column at all. Each of them now carries
--
--     workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT
--
-- and an index that leads with it. `restrict`, never `cascade`: deleting a workspace must
-- not silently erase its evidence, which is the rule `execution_jobs`, `run_events` and
-- `gate_evaluations` already follow. The foreign key is the half `schedules` (0015),
-- `outbox_events` (0017) and the chat tables (0018) did not get: a NOT NULL column that
-- can name a workspace nobody registered is a label, not a boundary — and `runs` held
-- exactly such ids, because nothing stopped it.
--
-- ## The backfill, and why it fails closed
--
-- A row given the wrong workspace is a cross-tenant disclosure performed by the fix, so
-- the value is derived, in this order, and never guessed:
--
--   1. **From the parent**, where the row has one: a test, a result, an artifact, a shard
--      or a classification takes its run's workspace; an attachment takes its result's; a
--      message attachment takes its message's; a session file takes its session's.
--   2. **From an explicit operator choice**, `SET automate.backfill_workspace = '<id>'`
--      (or `ALTER DATABASE … SET`), which must name a workspace that exists.
--   3. **From the only workspace**, when exactly one exists — the single-tenant install
--      ADR-006 describes, which is every install today.
--   4. Otherwise the migration **raises, naming the table**, and nothing is applied.
--
-- Before any of that, a workspace id the data **already names** — on `runs`,
-- `audit_events` or `quality_gate_config` — but `workspaces` never registered is
-- registered. That is not an invention: those rows claim the workspace, and the missing
-- foreign key is the only reason they could. It does mean an install that set
-- `WORKSPACE_ID` to something other than the `default-workspace` 0003 seeds will have two
-- workspaces, and a row with no parent then needs rule 2. That is the point: the
-- migration cannot know which of the two such a row belongs to.
--
-- ## `audit_events.tenant_id` is dropped
--
-- It is the second tenant column on one table, with no writer and no reader in the
-- product — `auditRow` never set it, and nothing selects it — so it could only ever
-- disagree with `workspace_id`. It is folded in rather than discarded: a NULL
-- `workspace_id` takes `tenant_id` when that names a registered workspace, and the
-- migration raises if any row carries a `tenant_id` that disagrees with its
-- `workspace_id` or names no workspace, so no value is lost silently.
--
-- ## `quality_gate_config.workspace_id` stays nullable
--
-- NULL there is a meaning, not a gap: it is the installation-wide default gate (id
-- `global`) and every gate the dashboard creates. Forcing a value would turn the
-- installation default into one workspace's private gate. It gains the foreign key — a
-- gate that names a workspace must name a real one — and keeps its NULLs. The tenancy
-- register classifies it `global` and says why.
--
-- Two uniqueness rules were global across tenants and are made per-workspace, for the
-- reason 0017 gave for `outbox_events`: `trends`' primary key and
-- `test_failure_correlations_test_file_unique`. A duplicate is only a duplicate within a
-- tenant.

-- Step 0 — the one place the fallback is decided. Created here and dropped at the end, so
-- nothing outside this migration can call it.
CREATE FUNCTION automate_backfill_workspace(target text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  chosen text;
  candidates integer;
BEGIN
  chosen := nullif(btrim(coalesce(current_setting('automate.backfill_workspace', true), '')), '');
  IF chosen IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = chosen) THEN
      RAISE EXCEPTION
        '%.workspace_id: automate.backfill_workspace names "%", which is not a registered workspace. '
        'Name one of the ids in the workspaces table.', target, chosen;
    END IF;
    RETURN chosen;
  END IF;
  SELECT count(*) INTO candidates FROM workspaces;
  IF candidates = 1 THEN
    SELECT id INTO chosen FROM workspaces;
    RETURN chosen;
  END IF;
  RAISE EXCEPTION
    '%.workspace_id is becoming NOT NULL, and % holds rows with no parent to take a workspace '
    'from while % workspaces exist. This migration will not choose one: run it with '
    'automate.backfill_workspace set to the workspace those rows belong to '
    '(SET automate.backfill_workspace = ''<id>''), or remove the rows first.',
    target, target, candidates;
END
$$;
--> statement-breakpoint

-- Step 1 — a blank workspace is no workspace.
UPDATE runs SET workspace_id = NULL WHERE btrim(workspace_id) = '';
--> statement-breakpoint
UPDATE audit_events SET workspace_id = NULL WHERE btrim(workspace_id) = '';
--> statement-breakpoint
UPDATE audit_events SET tenant_id = NULL WHERE btrim(tenant_id) = '';
--> statement-breakpoint
UPDATE quality_gate_config SET workspace_id = NULL WHERE btrim(workspace_id) = '';
--> statement-breakpoint

-- Step 2 — register the workspaces the data already names.
INSERT INTO workspaces (id, name, config_path, created_at)
SELECT named.id, named.id, 'config', now()
  FROM (
        SELECT workspace_id AS id FROM runs WHERE workspace_id IS NOT NULL
        UNION
        SELECT workspace_id FROM audit_events WHERE workspace_id IS NOT NULL
        UNION
        SELECT workspace_id FROM quality_gate_config WHERE workspace_id IS NOT NULL
       ) AS named
 WHERE NOT EXISTS (SELECT 1 FROM workspaces existing WHERE existing.id = named.id);
--> statement-breakpoint

-- Step 3 — runs, the parent of most of what follows.
UPDATE runs SET workspace_id = automate_backfill_workspace('runs') WHERE workspace_id IS NULL;
--> statement-breakpoint
ALTER TABLE runs ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE runs ADD CONSTRAINT runs_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

-- Step 4 — the tables whose parent is a run. `run_id` is NOT NULL with a foreign key on
-- each, so the join reaches every row.
ALTER TABLE suites ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE suites SET workspace_id = runs.workspace_id FROM runs WHERE runs.id = suites.run_id;
--> statement-breakpoint
ALTER TABLE tests ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE tests SET workspace_id = runs.workspace_id FROM runs WHERE runs.id = tests.run_id;
--> statement-breakpoint
ALTER TABLE results ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE results SET workspace_id = runs.workspace_id FROM runs WHERE runs.id = results.run_id;
--> statement-breakpoint
ALTER TABLE artifacts ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE artifacts SET workspace_id = runs.workspace_id FROM runs WHERE runs.id = artifacts.run_id;
--> statement-breakpoint
ALTER TABLE blob_shards ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE blob_shards SET workspace_id = runs.workspace_id FROM runs WHERE runs.id = blob_shards.run_id;
--> statement-breakpoint
ALTER TABLE failure_classifications ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE failure_classifications SET workspace_id = runs.workspace_id
  FROM runs WHERE runs.id = failure_classifications.run_id;
--> statement-breakpoint
ALTER TABLE locator_suggestions ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE locator_suggestions SET workspace_id = runs.workspace_id
  FROM runs WHERE runs.id = locator_suggestions.run_id;
--> statement-breakpoint
ALTER TABLE agent_session_runs ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE agent_session_runs SET workspace_id = runs.workspace_id
  FROM runs WHERE runs.id = agent_session_runs.run_id;
--> statement-breakpoint

-- Step 5 — one level further down.
ALTER TABLE attachments ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE attachments SET workspace_id = results.workspace_id
  FROM results WHERE results.id = attachments.result_id;
--> statement-breakpoint
ALTER TABLE message_attachments ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE message_attachments SET workspace_id = messages.workspace_id
  FROM messages WHERE messages.id = message_attachments.message_id;
--> statement-breakpoint

-- Step 6 — an optional parent first, then the fallback.
ALTER TABLE test_failure_correlations ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE test_failure_correlations SET workspace_id = runs.workspace_id
  FROM runs WHERE runs.id = test_failure_correlations.last_updated_run_id;
--> statement-breakpoint
UPDATE test_failure_correlations SET workspace_id = automate_backfill_workspace('test_failure_correlations')
 WHERE workspace_id IS NULL;
--> statement-breakpoint
ALTER TABLE execution_log ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE execution_log SET workspace_id = conversations.workspace_id
  FROM conversations WHERE conversations.id = execution_log.conversation_id;
--> statement-breakpoint
UPDATE execution_log SET workspace_id = automate_backfill_workspace('execution_log')
 WHERE workspace_id IS NULL;
--> statement-breakpoint

-- A cluster names the first and the last run it was seen in, with no foreign key on
-- either. Two runs in two workspaces would make the cluster itself a cross-tenant record,
-- and there is no correct single owner to give it — so that is a raise, not a pick.
DO $$
DECLARE
  spanning integer;
BEGIN
  SELECT count(*) INTO spanning
    FROM failure_clusters c
    JOIN runs first_run ON first_run.id = c.first_seen_run_id
    JOIN runs last_run ON last_run.id = c.last_seen_run_id
   WHERE first_run.workspace_id <> last_run.workspace_id;
  IF spanning > 0 THEN
    RAISE EXCEPTION
      'failure_clusters.workspace_id: % cluster(s) were first and last seen in runs of different '
      'workspaces, so no single workspace owns them. Split or delete those clusters before migrating.',
      spanning;
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE failure_clusters ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE failure_clusters SET workspace_id = runs.workspace_id
  FROM runs WHERE runs.id = coalesce(failure_clusters.last_seen_run_id, failure_clusters.first_seen_run_id);
--> statement-breakpoint
UPDATE failure_clusters SET workspace_id = automate_backfill_workspace('failure_clusters')
 WHERE workspace_id IS NULL;
--> statement-breakpoint

-- Step 7 — the agent tables: a session has no parent, and its children take its workspace.
ALTER TABLE agent_sessions ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE agent_sessions SET workspace_id = automate_backfill_workspace('agent_sessions')
 WHERE workspace_id IS NULL;
--> statement-breakpoint
ALTER TABLE agent_session_files ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE agent_session_files SET workspace_id = agent_sessions.workspace_id
  FROM agent_sessions WHERE agent_sessions.id = agent_session_files.session_id;
--> statement-breakpoint
ALTER TABLE repair_attempts ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE repair_attempts SET workspace_id = agent_sessions.workspace_id
  FROM agent_sessions WHERE agent_sessions.id = repair_attempts.session_id;
--> statement-breakpoint
ALTER TABLE generated_test_suggestions ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE generated_test_suggestions SET workspace_id = runs.workspace_id
  FROM runs WHERE runs.id = generated_test_suggestions.run_id;
--> statement-breakpoint
UPDATE generated_test_suggestions SET workspace_id = agent_sessions.workspace_id
  FROM agent_sessions
 WHERE generated_test_suggestions.workspace_id IS NULL
   AND agent_sessions.id = generated_test_suggestions.session_id;
--> statement-breakpoint
UPDATE generated_test_suggestions SET workspace_id = automate_backfill_workspace('generated_test_suggestions')
 WHERE workspace_id IS NULL;
--> statement-breakpoint
ALTER TABLE agent_conflicts ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE agent_conflicts SET workspace_id = automate_backfill_workspace('agent_conflicts')
 WHERE workspace_id IS NULL;
--> statement-breakpoint

-- Step 8 — the tables with no parent at all.
ALTER TABLE quarantine ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE quarantine SET workspace_id = automate_backfill_workspace('quarantine') WHERE workspace_id IS NULL;
--> statement-breakpoint
ALTER TABLE known_failures ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE known_failures SET workspace_id = automate_backfill_workspace('known_failures')
 WHERE workspace_id IS NULL;
--> statement-breakpoint
ALTER TABLE trends ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE trends SET workspace_id = automate_backfill_workspace('trends') WHERE workspace_id IS NULL;
--> statement-breakpoint
ALTER TABLE nl_query_history ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE nl_query_history SET workspace_id = automate_backfill_workspace('nl_query_history')
 WHERE workspace_id IS NULL;
--> statement-breakpoint
ALTER TABLE flow_templates ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE flow_templates SET workspace_id = automate_backfill_workspace('flow_templates')
 WHERE workspace_id IS NULL;
--> statement-breakpoint
ALTER TABLE model_config ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE model_config SET workspace_id = automate_backfill_workspace('model_config')
 WHERE workspace_id IS NULL;
--> statement-breakpoint
ALTER TABLE trace_links ADD COLUMN workspace_id text;
--> statement-breakpoint
UPDATE trace_links SET workspace_id = automate_backfill_workspace('trace_links')
 WHERE workspace_id IS NULL;
--> statement-breakpoint

-- Step 9 — audit_events: fold `tenant_id` in, refuse a disagreement, then drop it.
DO $$
DECLARE
  disagreeing integer;
  unregistered integer;
BEGIN
  SELECT count(*) INTO disagreeing
    FROM audit_events
   WHERE tenant_id IS NOT NULL AND workspace_id IS NOT NULL AND tenant_id <> workspace_id;
  IF disagreeing > 0 THEN
    RAISE EXCEPTION
      'audit_events: % row(s) carry a tenant_id that disagrees with their workspace_id. tenant_id is '
      'being dropped as a second tenant column, and this migration will not discard a value that says '
      'something different. Reconcile those rows first.', disagreeing;
  END IF;
  SELECT count(*) INTO unregistered
    FROM audit_events a
   WHERE a.workspace_id IS NULL AND a.tenant_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = a.tenant_id);
  IF unregistered > 0 THEN
    RAISE EXCEPTION
      'audit_events: % row(s) have no workspace_id and a tenant_id that names no registered workspace, '
      'so tenant_id cannot be folded into workspace_id. Reconcile those rows first.', unregistered;
  END IF;
END
$$;
--> statement-breakpoint
UPDATE audit_events SET workspace_id = tenant_id WHERE workspace_id IS NULL AND tenant_id IS NOT NULL;
--> statement-breakpoint
UPDATE audit_events SET workspace_id = automate_backfill_workspace('audit_events')
 WHERE workspace_id IS NULL;
--> statement-breakpoint
ALTER TABLE audit_events DROP COLUMN tenant_id;
--> statement-breakpoint
ALTER TABLE audit_events ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE audit_events ADD CONSTRAINT audit_events_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

-- Step 10 — quality_gate_config: the key, and its NULLs kept (see the header).
ALTER TABLE quality_gate_config ADD CONSTRAINT quality_gate_config_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

-- Step 11 — the boundary itself, on every table that gained a column.
ALTER TABLE suites ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE suites ADD CONSTRAINT suites_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX suites_workspace_run_idx ON suites (workspace_id, run_id);
--> statement-breakpoint
ALTER TABLE tests ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE tests ADD CONSTRAINT tests_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX tests_workspace_run_idx ON tests (workspace_id, run_id);
--> statement-breakpoint
ALTER TABLE results ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE results ADD CONSTRAINT results_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX results_workspace_run_idx ON results (workspace_id, run_id);
--> statement-breakpoint
ALTER TABLE attachments ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE attachments ADD CONSTRAINT attachments_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX attachments_workspace_result_idx ON attachments (workspace_id, result_id);
--> statement-breakpoint
ALTER TABLE artifacts ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE artifacts ADD CONSTRAINT artifacts_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX artifacts_workspace_run_idx ON artifacts (workspace_id, run_id);
--> statement-breakpoint
ALTER TABLE trends ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE trends ADD CONSTRAINT trends_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE trends DROP CONSTRAINT trends_date_project_branch_pk;
--> statement-breakpoint
ALTER TABLE trends ADD CONSTRAINT trends_workspace_id_date_project_branch_pk
  PRIMARY KEY (workspace_id, date, project, branch);
--> statement-breakpoint
ALTER TABLE quarantine ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE quarantine ADD CONSTRAINT quarantine_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX quarantine_workspace_quarantined_idx ON quarantine (workspace_id, quarantined_at);
--> statement-breakpoint
ALTER TABLE known_failures ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE known_failures ADD CONSTRAINT known_failures_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX known_failures_workspace_idx ON known_failures (workspace_id);
--> statement-breakpoint
ALTER TABLE blob_shards ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE blob_shards ADD CONSTRAINT blob_shards_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX blob_shards_workspace_run_idx ON blob_shards (workspace_id, run_id);
--> statement-breakpoint
ALTER TABLE nl_query_history ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE nl_query_history ADD CONSTRAINT nl_query_history_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX nl_query_history_workspace_created_idx ON nl_query_history (workspace_id, created_at);
--> statement-breakpoint
ALTER TABLE failure_classifications ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE failure_classifications ADD CONSTRAINT failure_classifications_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX failure_classifications_workspace_run_idx ON failure_classifications (workspace_id, run_id);
--> statement-breakpoint
ALTER TABLE test_failure_correlations ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE test_failure_correlations ADD CONSTRAINT test_failure_correlations_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
DROP INDEX test_failure_correlations_test_file_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX test_failure_correlations_workspace_test_file_unique
    ON test_failure_correlations (workspace_id, test_stable_id, source_file_path);
--> statement-breakpoint
ALTER TABLE locator_suggestions ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE locator_suggestions ADD CONSTRAINT locator_suggestions_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX locator_suggestions_workspace_run_idx ON locator_suggestions (workspace_id, run_id);
--> statement-breakpoint
ALTER TABLE failure_clusters ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE failure_clusters ADD CONSTRAINT failure_clusters_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX failure_clusters_workspace_fingerprint_idx ON failure_clusters (workspace_id, fingerprint);
--> statement-breakpoint
ALTER TABLE agent_sessions ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE agent_sessions ADD CONSTRAINT agent_sessions_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX agent_sessions_workspace_status_idx ON agent_sessions (workspace_id, status);
--> statement-breakpoint
ALTER TABLE agent_session_runs ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE agent_session_runs ADD CONSTRAINT agent_session_runs_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX agent_session_runs_workspace_session_idx ON agent_session_runs (workspace_id, session_id);
--> statement-breakpoint
ALTER TABLE agent_session_files ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE agent_session_files ADD CONSTRAINT agent_session_files_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX agent_session_files_workspace_session_idx ON agent_session_files (workspace_id, session_id);
--> statement-breakpoint
ALTER TABLE generated_test_suggestions ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE generated_test_suggestions ADD CONSTRAINT generated_test_suggestions_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX generated_test_suggestions_workspace_status_idx
    ON generated_test_suggestions (workspace_id, status);
--> statement-breakpoint
ALTER TABLE repair_attempts ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE repair_attempts ADD CONSTRAINT repair_attempts_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX repair_attempts_workspace_session_idx ON repair_attempts (workspace_id, session_id);
--> statement-breakpoint
ALTER TABLE agent_conflicts ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE agent_conflicts ADD CONSTRAINT agent_conflicts_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX agent_conflicts_workspace_status_idx ON agent_conflicts (workspace_id, status);
--> statement-breakpoint
ALTER TABLE message_attachments ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE message_attachments ADD CONSTRAINT message_attachments_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX message_attachments_workspace_message_idx ON message_attachments (workspace_id, message_id);
--> statement-breakpoint
ALTER TABLE flow_templates ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE flow_templates ADD CONSTRAINT flow_templates_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX flow_templates_workspace_idx ON flow_templates (workspace_id);
--> statement-breakpoint
ALTER TABLE execution_log ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE execution_log ADD CONSTRAINT execution_log_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX execution_log_workspace_created_idx ON execution_log (workspace_id, created_at);
--> statement-breakpoint
ALTER TABLE model_config ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE model_config ADD CONSTRAINT model_config_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX model_config_workspace_idx ON model_config (workspace_id);
--> statement-breakpoint
ALTER TABLE trace_links ALTER COLUMN workspace_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE trace_links ADD CONSTRAINT trace_links_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX trace_links_workspace_source_idx ON trace_links (workspace_id, source_type, source_id);
--> statement-breakpoint

-- Step 12 — nothing outside this migration may call the fallback.
DROP FUNCTION automate_backfill_workspace(text);
