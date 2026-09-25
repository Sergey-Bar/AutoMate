/**
 * Test helper: creates a Fastify app backed by an in-memory SQLite database.
 *
 * Usage in tests:
 *   const { app, db, sqlite } = await createTestApp();
 *   await someRoutes(app);
 *   await app.ready();
 *
 *   const res = await app.inject({ method: 'GET', url: '/api/runs' });
 *   expect(res.statusCode).toBe(200);
 *
 *   // Cleanup
 *   await app.close();
 *   sqlite.close();
 */
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';

export interface TestApp {
  app: FastifyInstance;
  db: BetterSQLite3Database<typeof schema>;
  poolConnection: InstanceType<typeof Database> & {
    query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
  };
  sqlite: InstanceType<typeof Database>;
}

/**
 * Patch pg boolean columns so they serialize to 0/1 for SQLite compatibility.
 * The pg boolean type passes true/false directly, but SQLite only accepts numbers.
 */
function patchBooleanColumns(): void {
  for (const table of Object.values(schema)) {
    if (typeof table !== 'object' || table === null) continue;
    for (const col of Object.values(table as Record<string, unknown>)) {
      if (
        typeof col === 'object' &&
        col !== null &&
        'columnType' in col &&
        (col as { columnType: string }).columnType === 'PgBoolean' &&
        'mapToDriverValue' in col
      ) {
        (col as { mapToDriverValue: (v: unknown) => unknown }).mapToDriverValue = (v: unknown) =>
          v === null || v === undefined ? v : (v ? 1 : 0);
      }
    }
  }
}

patchBooleanColumns();

/**
 * Build a Fastify app with an in-memory SQLite database.
 * The schema is pushed via raw DDL extracted from Drizzle table definitions.
 */
export async function createTestApp(): Promise<TestApp> {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Create all tables from schema
  pushSchema(sqlite);

  const db = drizzle(sqlite, { schema });
  // Polyfill .execute() for SQLite Drizzle client to match Postgres Drizzle client behavior in tests
  (db as any).execute = (query: any) => {
    // For Drizzle SQL objects, we can't easily get the SQL string without a dialect.
    // However, in our metrics.ts we only use SELECT for metrics, except maybe some deletes in tests.
    // We'll try to guess based on whether it's returning rows.
    try {
      const rows = (db as any).all(query);
      return Promise.resolve({ rows });
    } catch {
      const res = (db as any).run(query);
      return Promise.resolve({ rows: [], rowCount: res.changes });
    }
  };
  // Polyfill .transaction() to support async callbacks (not supported by better-sqlite3 driver)
  // In tests, we skip real transactions to allow async/await inside them.
  (db as any).transaction = (async (callback: any) => {
    return callback(db);
  }) as any;

  const app = Fastify({ logger: false });

  const poolConnection = sqlite as unknown as TestApp['poolConnection'];
  poolConnection.query = async (sql: string, params: unknown[] = []) => {
    // Handle information_schema queries from health checks — not supported in SQLite
    if (sql.includes('information_schema')) {
      const countRows = sqlite.prepare("SELECT count(*) AS cnt FROM sqlite_master WHERE type='table'").all() as Array<{ cnt: number }>;
      return { rows: [{ cnt: countRows[0]?.cnt ?? 0 }] };
    }
    // Convert $1, $2, ... to :p1, :p2, ... for SQLite compatibility in tests
    // PostgreSQL uses $1 for the first param, even if repeated. 
    // better-sqlite3 supports named parameters like :p1.
    const sqliteSql = sql.replace(/\$(\d+)/g, ':p$1');
    const stmt = sqlite.prepare(sqliteSql);
    
    const paramsObj: Record<string, unknown> = {};
    if (params) {
      params.forEach((val, i) => {
        paramsObj[`p${i + 1}`] = val;
      });
    }
    
    // Determine if it's a SELECT or something else
    const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
    
    if (isSelect) {
      const rows = stmt.all(paramsObj);
      return { rows };
    } else {
      const info = stmt.run(paramsObj);
      return { rows: [], rowCount: info.changes };
    }
  };

  return { app, db, poolConnection, sqlite };
}

/**
 * Push the Drizzle schema to an in-memory SQLite database.
 * We generate CREATE TABLE statements from the schema definitions.
 */
function pushSchema(sqlite: InstanceType<typeof Database>): void {
  // We create the tables directly using SQL DDL matching the Drizzle schema.
  // This is more reliable than trying to introspect Drizzle table objects at runtime.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      total INTEGER NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      flaky INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      branch TEXT,
      commit_sha TEXT,
      commit_message TEXT,
      triggered_by TEXT DEFAULT 'manual',
      config TEXT,
      raw_args TEXT,
      source TEXT NOT NULL DEFAULT 'live',
      gate_status TEXT,
      workspace_id TEXT,
      pr_number INTEGER,
      pr_branch TEXT,
      base_branch TEXT,
      commit_author TEXT
    );

    CREATE TABLE IF NOT EXISTS suites (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      parent_id TEXT,
      title TEXT NOT NULL,
      file TEXT,
      project TEXT
    );

    CREATE TABLE IF NOT EXISTS tests (
      id TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      suite_id TEXT REFERENCES suites(id),
      title TEXT NOT NULL,
      file TEXT NOT NULL,
      line INTEGER,
      "column" INTEGER,
      stable_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      duration_ms INTEGER,
      tags TEXT,
      annotations TEXT,
      retry_count INTEGER DEFAULT 0,
      expected_status TEXT,
      worker_index INTEGER,
      PRIMARY KEY (id, run_id)
    );

    CREATE TABLE IF NOT EXISTS results (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      retry INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      duration_ms INTEGER,
      started_at TEXT,
      error_message TEXT,
      error_stack TEXT,
      worker_index INTEGER,
      parallel_index INTEGER,
      stdout TEXT,
      stderr TEXT,
      steps TEXT,
      attachments TEXT,
      fingerprint TEXT
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      path TEXT NOT NULL,
      size_bytes INTEGER,
      thumbnail_path TEXT,
      is_screenshot_diff INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS trends (
      date TEXT NOT NULL,
      project TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'main',
      total INTEGER NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      flaky INTEGER NOT NULL DEFAULT 0,
      avg_duration_ms REAL,
      p95_duration_ms REAL,
      PRIMARY KEY (date, project, branch)
    );

    CREATE TABLE IF NOT EXISTS quarantine (
      id TEXT PRIMARY KEY,
      test_title TEXT NOT NULL,
      test_file TEXT NOT NULL,
      reason TEXT,
      quarantined_at TEXT NOT NULL,
      quarantined_by TEXT DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'approved',
      flakiness_category TEXT,
      category_confidence REAL,
      category_evidence TEXT,
      resolved_at TEXT,
      resolution_type TEXT,
      ttf_ms INTEGER
    );

    CREATE TABLE IF NOT EXISTS known_failures (
      id TEXT PRIMARY KEY,
      test_title TEXT NOT NULL,
      test_file TEXT NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT DEFAULT 'manual'
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      cron_expr TEXT NOT NULL,
      run_options TEXT,
      enabled INTEGER DEFAULT 1,
      last_run_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config_path TEXT NOT NULL,
      test_results_dir TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quality_gate_config (
      id TEXT PRIMARY KEY DEFAULT 'global',
      workspace_id TEXT,
      pass_rate_threshold REAL NOT NULL DEFAULT 100,
      max_duration_ms INTEGER,
      max_flaky_count INTEGER,
      max_quarantine_percent REAL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS defect_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#6b7280',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fingerprint_categories (
      fingerprint TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES defect_categories(id) ON DELETE CASCADE,
      assigned_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blob_shards (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      shard_index INTEGER NOT NULL,
      total_shards INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      merged INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS nl_query_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_query TEXT NOT NULL,
      generated_sql TEXT NOT NULL,
      result_count INTEGER,
      user_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_type TEXT NOT NULL DEFAULT 'user',
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      ip TEXT,
      user_agent TEXT,
      request_id TEXT,
      details TEXT,
      tenant_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events (actor_id);
    CREATE INDEX IF NOT EXISTS audit_events_action_idx ON audit_events (action);
    CREATE INDEX IF NOT EXISTS audit_events_timestamp_idx ON audit_events (timestamp);

    CREATE TABLE IF NOT EXISTS failure_clusters (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      cluster_label TEXT NOT NULL,
      first_seen_run_id TEXT,
      last_seen_run_id TEXT,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      representative_error TEXT NOT NULL,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS failure_clusters_fingerprint_idx ON failure_clusters (fingerprint);
    CREATE INDEX IF NOT EXISTS failure_clusters_status_idx ON failure_clusters (status);

    CREATE TABLE IF NOT EXISTS locator_suggestions (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      original_selector TEXT NOT NULL,
      suggested_selector TEXT NOT NULL,
      confidence REAL NOT NULL,
      rationale TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_failure_correlations (
      id TEXT PRIMARY KEY,
      test_stable_id TEXT NOT NULL,
      source_file_path TEXT NOT NULL,
      failure_count INTEGER NOT NULL DEFAULT 0,
      total_occurrences INTEGER NOT NULL DEFAULT 0,
      last_updated_run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
      window_start_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (test_stable_id, source_file_path)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      saml_subject TEXT,
      tenant_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      scopes TEXT,
      last_used_at TEXT,
      expires_at TEXT,
      revoked_at TEXT,
      tenant_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_unique ON api_keys (key_hash);
    CREATE INDEX IF NOT EXISTS api_keys_user_id_idx ON api_keys (user_id);

    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      repository TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      pr_branch TEXT NOT NULL,
      base_branch TEXT,
      pr_title TEXT,
      pr_author TEXT,
      agent_name TEXT NOT NULL,
      matched_rule TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT,
      files_last_synced_at TEXT,
      file_sync_status TEXT,
      CONSTRAINT agent_sessions_status_check CHECK (status IN ('active', 'closed', 'error')),
      CONSTRAINT agent_sessions_file_sync_status_check CHECK (file_sync_status IS NULL OR file_sync_status IN ('pending', 'synced', 'failed'))
    );
    CREATE INDEX IF NOT EXISTS agent_sessions_pr_number_repository_idx ON agent_sessions (pr_number, repository);
    CREATE INDEX IF NOT EXISTS agent_sessions_status_idx ON agent_sessions (status);
    CREATE INDEX IF NOT EXISTS agent_sessions_pr_branch_idx ON agent_sessions (pr_branch);

    CREATE TABLE IF NOT EXISTS agent_session_runs (
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      linked_at TEXT NOT NULL,
      PRIMARY KEY (session_id, run_id)
    );
    CREATE INDEX IF NOT EXISTS agent_session_runs_session_id_idx ON agent_session_runs (session_id);
    CREATE INDEX IF NOT EXISTS agent_session_runs_run_id_idx ON agent_session_runs (run_id);

    CREATE TABLE IF NOT EXISTS agent_session_files (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      change_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CONSTRAINT agent_session_files_change_type_check CHECK (change_type IN ('added', 'modified', 'removed', 'renamed'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS agent_session_files_session_id_file_path_unique ON agent_session_files (session_id, file_path);
    CREATE INDEX IF NOT EXISTS agent_session_files_session_id_idx ON agent_session_files (session_id);

    CREATE TABLE IF NOT EXISTS generated_test_suggestions (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      source_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      original_content TEXT NOT NULL,
      edited_content TEXT,
      language TEXT,
      framework TEXT,
      source_metadata TEXT,
      model_provider TEXT,
      model_name TEXT,
      warnings TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewed_by TEXT,
      CONSTRAINT generated_test_suggestions_source_type_check CHECK (source_type IN ('pr_diff', 'requirement', 'source')),
      CONSTRAINT generated_test_suggestions_status_check CHECK (status IN ('draft', 'accepted', 'rejected', 'edited'))
    );
    CREATE INDEX IF NOT EXISTS generated_test_suggestions_session_id_idx ON generated_test_suggestions (session_id);
    CREATE INDEX IF NOT EXISTS generated_test_suggestions_status_idx ON generated_test_suggestions (status);

    CREATE TABLE IF NOT EXISTS repair_attempts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      attempt_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      payload TEXT,
      comment_url TEXT,
      comment_id TEXT,
      rerun_run_id TEXT,
      last_processed_sha TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CONSTRAINT repair_attempts_status_check CHECK (status IN ('payload_built', 'comment_posted', 'comment_failed', 'rerun_requested', 'escalated'))
    );
    CREATE INDEX IF NOT EXISTS repair_attempts_session_id_idx ON repair_attempts (session_id);
    CREATE UNIQUE INDEX IF NOT EXISTS repair_attempts_session_id_attempt_number_unique ON repair_attempts (session_id, attempt_number);

    CREATE TABLE IF NOT EXISTS agent_conflicts (
      id TEXT PRIMARY KEY,
      repository TEXT NOT NULL,
      session_ids TEXT NOT NULL,
      overlapping_files TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'warning',
      status TEXT NOT NULL DEFAULT 'active',
      first_detected_at TEXT NOT NULL,
      last_detected_at TEXT NOT NULL,
      resolved_at TEXT,
      notified_at TEXT,
      CONSTRAINT agent_conflicts_severity_check CHECK (severity IN ('info', 'warning', 'critical')),
      CONSTRAINT agent_conflicts_status_check CHECK (status IN ('active', 'resolved'))
    );
    CREATE INDEX IF NOT EXISTS agent_conflicts_repository_idx ON agent_conflicts (repository);
    CREATE INDEX IF NOT EXISTS agent_conflicts_status_idx ON agent_conflicts (status);

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      permissions TEXT NOT NULL,
      tenant_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS roles_name_unique ON roles (name);

    CREATE TABLE IF NOT EXISTS saml_config (
      id TEXT PRIMARY KEY,
      entry_point TEXT NOT NULL,
      issuer TEXT NOT NULL,
      idp_cert TEXT NOT NULL,
      callback_url TEXT NOT NULL,
      sp_private_key TEXT,
      default_role TEXT NOT NULL DEFAULT 'viewer',
      updated_at TEXT NOT NULL
    );
  `);
}
