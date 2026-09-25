import Database from 'better-sqlite3';
import { Pool } from 'pg';
import type { Pool as PgPool } from 'pg';

const BATCH_SIZE = 100;

type SqliteValue = string | number | bigint | Buffer | null;
type SourceRow = Record<string, SqliteValue>;
type LogFn = (message: string) => void;

export interface MigrateOptions {
  from: string;
  to: string;
  dryRun: boolean;
  log?: LogFn;
}

export interface MigrationTableReport {
  table: string;
  rowCount: number;
  inserted: number;
  failed: number;
}

export interface MigrationErrorReport {
  table: string;
  id: string;
  error: string;
}

export interface MigrationReport {
  dryRun: boolean;
  tables: MigrationTableReport[];
  errors: MigrationErrorReport[];
}

interface ColumnMapping {
  sqlite: string;
  pg: string;
  kind?: 'json' | 'boolean';
}

interface TableMapping {
  table: string;
  columns: readonly ColumnMapping[];
  idColumns: readonly string[];
}

const column = (name: string, kind?: ColumnMapping['kind']): ColumnMapping => ({
  sqlite: name,
  pg: name,
  ...(kind === undefined ? {} : { kind }),
});

const table = (
  name: string,
  columns: readonly ColumnMapping[],
  idColumns: readonly string[] = ['id'],
): TableMapping => ({ table: name, columns, idColumns });

const TABLES: readonly TableMapping[] = [
  table('conversations', [
    column('id'),
    column('title'),
    column('flow_template_id'),
    column('created_at'),
    column('updated_at'),
  ]),
  table('messages', [
    column('id'),
    column('conversation_id'),
    column('role'),
    column('content'),
    column('tool_call_id'),
    column('tool_name'),
    column('metadata', 'json'),
    column('created_at'),
  ]),
  table('message_attachments', [
    column('id'),
    column('message_id'),
    column('name'),
    column('content_type'),
    column('path'),
    column('size_bytes'),
  ]),
  table('connector_configs', [
    column('id'),
    column('connector_name'),
    column('enabled', 'boolean'),
    column('credential_ref'),
    column('settings', 'json'),
    column('updated_at'),
  ]),
  table('flow_templates', [
    column('id'),
    column('name'),
    column('description'),
    column('system_prompt'),
    column('steps', 'json'),
    column('category'),
    column('is_built_in', 'boolean'),
    column('created_at'),
    column('updated_at'),
  ]),
  table('execution_log', [
    column('id'),
    column('conversation_id'),
    column('tool_name'),
    column('input', 'json'),
    column('output', 'json'),
    column('status'),
    column('duration_ms'),
    column('error_message'),
    column('created_at'),
  ]),
  table('model_config', [
    column('id'),
    column('provider'),
    column('model'),
    column('endpoint'),
    column('temperature'),
    column('max_tokens'),
    column('system_prompt'),
    column('updated_at'),
  ]),
  table('trace_links', [
    column('id'),
    column('source_type'),
    column('source_id'),
    column('target_type'),
    column('target_id'),
    column('link_type'),
    column('metadata', 'json'),
    column('created_at'),
    column('created_by'),
  ]),
  table('workspaces', [
    column('id'),
    column('name'),
    column('config_path'),
    column('test_results_dir'),
    column('created_at'),
  ]),
  table('runs', [
    column('id'),
    column('started_at'),
    column('finished_at'),
    column('status'),
    column('total'),
    column('passed'),
    column('failed'),
    column('flaky'),
    column('skipped'),
    column('duration_ms'),
    column('branch'),
    column('commit_sha'),
    column('commit_message'),
    column('triggered_by'),
    column('config', 'json'),
    column('raw_args'),
    column('source'),
    column('gate_status'),
    column('workspace_id'),
    column('pr_number'),
    column('pr_branch'),
    column('base_branch'),
    column('commit_author'),
  ]),
  table('suites', [
    column('id'),
    column('run_id'),
    column('parent_id'),
    column('title'),
    column('file'),
    column('project'),
  ]),
  table(
    'tests',
    [
      column('id'),
      column('run_id'),
      column('suite_id'),
      column('title'),
      column('file'),
      column('line'),
      column('column'),
      column('stable_id'),
      column('status'),
      column('duration_ms'),
      column('tags', 'json'),
      column('annotations', 'json'),
      column('retry_count'),
      column('expected_status'),
      column('worker_index'),
    ],
    ['id', 'run_id'],
  ),
  table('results', [
    column('id'),
    column('test_id'),
    column('run_id'),
    column('retry'),
    column('status'),
    column('duration_ms'),
    column('started_at'),
    column('error_message'),
    column('error_stack'),
    column('worker_index'),
    column('parallel_index'),
    column('stdout', 'json'),
    column('stderr', 'json'),
    column('steps', 'json'),
    column('attachments', 'json'),
    column('fingerprint'),
  ]),
  table('attachments', [
    column('id'),
    column('result_id'),
    column('name'),
    column('content_type'),
    column('path'),
    column('size_bytes'),
    column('thumbnail_path'),
    column('is_screenshot_diff', 'boolean'),
  ]),
  table(
    'trends',
    [
      column('date'),
      column('project'),
      column('branch'),
      column('total'),
      column('passed'),
      column('failed'),
      column('flaky'),
      column('avg_duration_ms'),
      column('p95_duration_ms'),
    ],
    ['date', 'project', 'branch'],
  ),
  table('quarantine', [
    column('id'),
    column('test_title'),
    column('test_file'),
    column('reason'),
    column('quarantined_at'),
    column('quarantined_by'),
    column('status'),
    column('flakiness_category'),
    column('category_confidence'),
    column('category_evidence', 'json'),
    column('resolved_at'),
    column('resolution_type'),
    column('ttf_ms'),
  ]),
  table('known_failures', [
    column('id'),
    column('test_title'),
    column('test_file'),
    column('comment'),
    column('created_at'),
    column('created_by'),
  ]),
  table('schedules', [
    column('id'),
    column('cron_expr'),
    column('run_options', 'json'),
    column('enabled', 'boolean'),
    column('last_run_at'),
    column('created_at'),
  ]),
  table('quality_gate_config', [
    column('id'),
    column('workspace_id'),
    column('pass_rate_threshold'),
    column('max_duration_ms'),
    column('max_flaky_count'),
    column('max_quarantine_percent'),
    column('updated_at'),
  ]),
  table('defect_categories', [column('id'), column('name'), column('color'), column('created_at')]),
  table(
    'fingerprint_categories',
    [column('fingerprint'), column('category_id'), column('assigned_at')],
    ['fingerprint'],
  ),
  table('blob_shards', [
    column('id'),
    column('run_id'),
    column('shard_index'),
    column('total_shards'),
    column('file_path'),
    column('uploaded_at'),
    column('merged', 'boolean'),
  ]),
  table('nl_query_history', [
    column('id'),
    column('user_query'),
    column('generated_sql'),
    column('result_count'),
    column('user_id'),
    column('created_at'),
  ]),
  table('failure_taxonomy_rules', [
    column('id'),
    column('priority'),
    column('category'),
    column('pattern'),
    column('pattern_target'),
    column('description'),
    column('is_built_in', 'boolean'),
    column('enabled', 'boolean'),
    column('created_at'),
    column('updated_at'),
  ]),
  table('failure_classifications', [
    column('id'),
    column('fingerprint'),
    column('run_id'),
    column('category'),
    column('confidence'),
    column('matched_rule_id'),
    column('rationale'),
    column('is_manual_override', 'boolean'),
    column('created_at'),
  ]),
  table('test_failure_correlations', [
    column('id'),
    column('test_stable_id'),
    column('source_file_path'),
    column('failure_count'),
    column('total_occurrences'),
    column('last_updated_run_id'),
    column('window_start_date'),
    column('created_at'),
    column('updated_at'),
  ]),
  table('locator_suggestions', [
    column('id'),
    column('test_id'),
    column('run_id'),
    column('original_selector'),
    column('suggested_selector'),
    column('confidence'),
    column('rationale'),
    column('status'),
    column('created_at'),
  ]),
  table('failure_clusters', [
    column('id'),
    column('fingerprint'),
    column('cluster_label'),
    column('first_seen_run_id'),
    column('last_seen_run_id'),
    column('occurrence_count'),
    column('representative_error'),
    column('category'),
    column('status'),
    column('created_at'),
    column('updated_at'),
  ]),
  table('users', [
    column('id'),
    column('email'),
    column('display_name'),
    column('role'),
    column('saml_subject'),
    column('tenant_id'),
    column('created_at'),
    column('updated_at'),
  ]),
  table('roles', [
    column('id'),
    column('name'),
    column('description'),
    column('permissions', 'json'),
    column('tenant_id'),
    column('created_at'),
    column('updated_at'),
  ]),
  table('api_keys', [
    column('id'),
    column('name'),
    column('key_hash'),
    column('user_id'),
    column('role'),
    column('scopes', 'json'),
    column('last_used_at'),
    column('expires_at'),
    column('revoked_at'),
    column('tenant_id'),
    column('created_at'),
  ]),
  table('agent_sessions', [
    column('id'),
    column('provider'),
    column('repository'),
    column('pr_number'),
    column('pr_branch'),
    column('base_branch'),
    column('pr_title'),
    column('pr_author'),
    column('agent_name'),
    column('matched_rule'),
    column('status'),
    column('created_at'),
    column('updated_at'),
    column('closed_at'),
    column('files_last_synced_at'),
    column('file_sync_status'),
  ]),
  table(
    'agent_session_runs',
    [column('session_id'), column('run_id'), column('linked_at')],
    ['session_id', 'run_id'],
  ),
  table('agent_session_files', [
    column('id'),
    column('session_id'),
    column('file_path'),
    column('change_type'),
    column('created_at'),
  ]),
  table('generated_test_suggestions', [
    column('id'),
    column('session_id'),
    column('run_id'),
    column('source_type'),
    column('status'),
    column('original_content'),
    column('edited_content'),
    column('language'),
    column('framework'),
    column('model_provider'),
    column('model_name'),
    column('warnings', 'json'),
    column('source_metadata', 'json'),
    column('reviewed_by'),
    column('reviewed_at'),
    column('created_at'),
    column('updated_at'),
  ]),
  table('repair_attempts', [
    column('id'),
    column('session_id'),
    column('run_id'),
    column('attempt_number'),
    column('status'),
    column('payload', 'json'),
    column('comment_url'),
    column('comment_id'),
    column('rerun_run_id'),
    column('last_processed_sha'),
    column('error_message'),
    column('created_at'),
    column('updated_at'),
  ]),
  table('agent_conflicts', [
    column('id'),
    column('repository'),
    column('session_ids', 'json'),
    column('overlapping_files', 'json'),
    column('severity'),
    column('status'),
    column('first_detected_at'),
    column('last_detected_at'),
    column('resolved_at'),
    column('notified_at'),
  ]),
  table('saml_config', [
    column('id'),
    column('entry_point'),
    column('issuer'),
    column('idp_cert'),
    column('callback_url'),
    column('sp_private_key'),
    column('default_role'),
    column('updated_at'),
  ]),
  table('audit_events', [
    column('id'),
    column('timestamp'),
    column('actor_id'),
    column('actor_type'),
    column('action'),
    column('resource_type'),
    column('resource_id'),
    column('ip'),
    column('user_agent'),
    column('request_id'),
    column('details', 'json'),
    column('tenant_id'),
    column('created_at'),
  ]),
];

const BLOCKED_TABLES = new Set(['users', 'saml_config', 'saml_configs', 'sp_private_key']);

export async function migrateToPostgres(options: MigrateOptions): Promise<MigrationReport> {
  const log = options.log ?? console.info;
  const sqlite = new Database(options.from, { readonly: true, fileMustExist: true });
  const errors: MigrationErrorReport[] = [];
  const reports: MigrationTableReport[] = [];

  try {
    const existingTables = getExistingTables(sqlite);
    const blockedTables = [...existingTables].filter((table) => BLOCKED_TABLES.has(table));
    if (blockedTables.length > 0) {
      throw new Error(
        `Blocked source tables require an approved transformation: ${blockedTables.join(', ')}`,
      );
    }
    const tables = TABLES.filter((mapping) => existingTables.has(mapping.table));

    const effectiveTables = tables.map((mapping) => validateTableSchema(sqlite, mapping));

    for (const mapping of effectiveTables) {
      reports.push({
        table: mapping.table,
        rowCount: getTableCount(sqlite, mapping.table),
        inserted: 0,
        failed: 0,
      });
    }

    if (options.dryRun) {
      log('Dry run migration plan:');
      for (const report of reports) {
        log(`${report.table}: ${report.rowCount} ${pluralize('row', report.rowCount)}`);
      }
      return { dryRun: true, tables: reports, errors };
    }

    const pool = new Pool({ connectionString: options.to });
    try {
      for (const report of reports) {
        const mapping = effectiveTableByName(effectiveTables, report.table);
        log(`Migrating ${report.table}... 0/${report.rowCount}`);
        const rows = readRows(sqlite, mapping);
        const result = await insertRows(pool, mapping, rows, errors);
        report.inserted = result.inserted;
        report.failed = result.failed;
        log(`Migrating ${report.table}... ${report.rowCount}/${report.rowCount} ✓`);
      }
    } finally {
      await pool.end();
    }

    if (errors.length > 0) {
      log('Migration completed with row errors:');
      for (const error of errors) {
        log(`${error.table}:${error.id} ${error.error}`);
      }
    }

    return { dryRun: false, tables: reports, errors };
  } finally {
    sqlite.close();
  }
}

function effectiveTableByName(tables: readonly TableMapping[], name: string): TableMapping {
  const mapping = tables.find((candidate) => candidate.table === name);
  if (mapping === undefined) {
    throw new Error(`Unknown table mapping: ${name}`);
  }
  return mapping;
}

function getExistingTables(db: Database.Database): Set<string> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all();
  return new Set(rows.map((row) => readObjectString(row, 'name')));
}

function getTableCount(db: Database.Database, tableName: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteSqliteIdentifier(tableName)}`).get();
  return readObjectNumber(row, 'count');
}

function validateTableSchema(db: Database.Database, mapping: TableMapping): TableMapping {
  const rows = db.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(mapping.table)})`).all();
  const actualColumns = rows.map((row) => readObjectString(row, 'name'));
  const expectedColumns = new Set(mapping.columns.map((mappingColumn) => mappingColumn.sqlite));
  const unknownColumns = actualColumns.filter((actual) => !expectedColumns.has(actual));

  if (unknownColumns.length > 0) {
    throw new Error(
      `Schema mismatch for ${mapping.table}: unknown columns ${unknownColumns.join(', ')}`,
    );
  }

  const actualColumnSet = new Set(actualColumns);
  const columns = mapping.columns.filter((mappingColumn) =>
    actualColumnSet.has(mappingColumn.sqlite),
  );
  const missingIdColumns = mapping.idColumns.filter((idColumn) => !actualColumnSet.has(idColumn));

  if (missingIdColumns.length > 0) {
    throw new Error(
      `Schema mismatch for ${mapping.table}: missing id columns ${missingIdColumns.join(', ')}`,
    );
  }

  return { ...mapping, columns };
}

function readRows(db: Database.Database, mapping: TableMapping): SourceRow[] {
  const selectedColumns = mapping.columns
    .map((mappingColumn) => quoteSqliteIdentifier(mappingColumn.sqlite))
    .join(', ');
  const rows = db
    .prepare(`SELECT ${selectedColumns} FROM ${quoteSqliteIdentifier(mapping.table)}`)
    .all();
  return rows.map((row) => readSourceRow(row));
}

async function insertRows(
  pool: PgPool,
  mapping: TableMapping,
  rows: readonly SourceRow[],
  errors: MigrationErrorReport[],
): Promise<{ inserted: number; failed: number }> {
  let inserted = 0;
  let failed = 0;

  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    try {
      const result = await pool.query(...buildInsertQuery(mapping, batch));
      inserted += result.rowCount ?? 0;
    } catch {
      for (const row of batch) {
        try {
          const result = await pool.query(...buildInsertQuery(mapping, [row]));
          inserted += result.rowCount ?? 0;
        } catch (rowError) {
          failed += 1;
          errors.push({
            table: mapping.table,
            id: rowId(mapping, row),
            error: errorMessage(rowError),
          });
        }
      }
    }
  }

  return { inserted, failed };
}

function buildInsertQuery(mapping: TableMapping, rows: readonly SourceRow[]): [string, unknown[]] {
  const columns = mapping.columns;
  const columnSql = columns.map((mappingColumn) => quotePgIdentifier(mappingColumn.pg)).join(', ');
  const values: unknown[] = [];
  const rowSql = rows
    .map((row, rowIndex) => {
      const placeholders = columns.map((mappingColumn, columnIndex) => {
        values.push(convertValue(row[mappingColumn.sqlite] ?? null, mappingColumn));
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });
      return `(${placeholders.join(', ')})`;
    })
    .join(', ');

  return [
    `INSERT INTO ${quotePgIdentifier(mapping.table)} (${columnSql}) VALUES ${rowSql} ON CONFLICT DO NOTHING`,
    values,
  ];
}

function convertValue(value: SqliteValue, mapping: ColumnMapping): unknown {
  if (value === null) {
    return null;
  }

  if (mapping.kind === 'json') {
    if (typeof value !== 'string') {
      throw new Error(`Expected JSON text in ${mapping.sqlite}`);
    }
    return JSON.parse(value) as unknown;
  }

  if (mapping.kind === 'boolean') {
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'bigint') {
      return value !== 0n;
    }
    if (typeof value === 'string') {
      return value === 'true' || value === '1';
    }
  }

  return value;
}

function rowId(mapping: TableMapping, row: SourceRow): string {
  return mapping.idColumns.map((columnName) => String(row[columnName] ?? '<null>')).join(':');
}

function readSourceRow(value: unknown): SourceRow {
  if (!isRecord(value)) {
    throw new Error('SQLite returned a non-object row');
  }

  const row: SourceRow = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSqliteValue(item)) {
      row[key] = item;
    } else {
      throw new Error(`SQLite returned unsupported value for ${key}`);
    }
  }
  return row;
}

function readObjectString(value: unknown, key: string): string {
  if (!isRecord(value) || typeof value[key] !== 'string') {
    throw new Error(`Expected SQLite string column ${key}`);
  }
  return value[key];
}

function readObjectNumber(value: unknown, key: string): number {
  if (!isRecord(value) || typeof value[key] !== 'number') {
    throw new Error(`Expected SQLite number column ${key}`);
  }
  return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSqliteValue(value: unknown): value is SqliteValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    Buffer.isBuffer(value)
  );
}

function quoteSqliteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quotePgIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
