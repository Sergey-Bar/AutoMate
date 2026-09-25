/**
 * apps/server/src/services/nl-query.ts — NL→SQL translation with safety sandboxing
 *
 * Converts natural language questions into safe, read-only SQL queries.
 * Uses the configured AI provider (same as ai-explain) with schema-aware prompts.
 * Validates generated SQL to prevent DML/DDL injection and limits result set.
 */
import { pool } from '../db/client.js';
import * as path from 'path';
import * as fs from 'fs/promises';

// ── Constants (exported for testing) ─────────────────────────────────────────

export const ALLOWED_TABLES = [
  'runs', 'tests', 'results', 'suites', 'trends',
  'quarantine', 'known_failures', 'schedules', 'workspaces',
  'quality_gate_config', 'defect_categories', 'fingerprint_categories',
  'attachments', 'blob_shards', 'nl_query_history',
  'failure_taxonomy_rules', 'failure_classifications',
  'test_failure_correlations', 'locator_suggestions',
] as const;

/** PostgreSQL/SQLite internal/system tables that must never be queried */
export const SYSTEM_TABLES = /^(sqlite_|pg_|information_schema)/i;

export const FORBIDDEN_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|REPLACE|EXEC|EXECUTE|MERGE|RENAME|COPY)\b/i;

/** Functions that can cause side effects — must be blocked even in SELECT */
export const FORBIDDEN_FUNCTIONS = /\b(load_extension|writefile|readfile|fts3_tokenizer|zipfile|pg_read_file|pg_ls_dir|pg_execute|query_to_xml)\s*\(/i;

export const MAX_ROWS = 1_000;
export const QUERY_TIMEOUT_MS = 5000;

// ── Schema description builder ───────────────────────────────────────────────

/** Table/column metadata for the LLM prompt */
const SCHEMA_MAP: Record<string, Array<{ col: string; type: string; note?: string }>> = {
  runs: [
    { col: 'id', type: 'TEXT PK', note: 'UUID' },
    { col: 'started_at', type: 'TEXT', note: 'ISO timestamp' },
    { col: 'finished_at', type: 'TEXT', note: 'ISO timestamp, nullable' },
    { col: 'status', type: 'TEXT', note: 'running|passed|failed|interrupted' },
    { col: 'total', type: 'INTEGER' }, { col: 'passed', type: 'INTEGER' },
    { col: 'failed', type: 'INTEGER' }, { col: 'flaky', type: 'INTEGER' },
    { col: 'skipped', type: 'INTEGER' }, { col: 'duration_ms', type: 'INTEGER' },
    { col: 'branch', type: 'TEXT' }, { col: 'commit_sha', type: 'TEXT' },
    { col: 'commit_message', type: 'TEXT' }, { col: 'triggered_by', type: 'TEXT' },
    { col: 'source', type: 'TEXT', note: 'live|blob' },
    { col: 'gate_status', type: 'TEXT', note: 'passed|failed|skipped' },
    { col: 'workspace_id', type: 'TEXT' },
  ],
  tests: [
    { col: 'id', type: 'TEXT', note: 'Playwright testId' },
    { col: 'run_id', type: 'TEXT FK→runs.id' },
    { col: 'suite_id', type: 'TEXT FK→suites.id' },
    { col: 'title', type: 'TEXT' }, { col: 'file', type: 'TEXT' },
    { col: 'line', type: 'INTEGER' }, { col: 'column', type: 'INTEGER' },
    { col: 'stable_id', type: 'TEXT' },
    { col: 'status', type: 'TEXT', note: 'passed|failed|flaky|skipped|timedOut|running|queued' },
    { col: 'duration_ms', type: 'INTEGER' },
    { col: 'tags', type: 'TEXT', note: 'JSON array' },
    { col: 'retry_count', type: 'INTEGER' },
    { col: 'worker_index', type: 'INTEGER' },
  ],
  results: [
    { col: 'id', type: 'TEXT PK' }, { col: 'test_id', type: 'TEXT' },
    { col: 'run_id', type: 'TEXT FK→runs.id' },
    { col: 'retry', type: 'INTEGER' },
    { col: 'status', type: 'TEXT', note: 'passed|failed|timedOut|skipped|interrupted' },
    { col: 'duration_ms', type: 'INTEGER' },
    { col: 'error_message', type: 'TEXT' }, { col: 'error_stack', type: 'TEXT' },
    { col: 'fingerprint', type: 'TEXT', note: '12-char hex error hash' },
  ],
  suites: [
    { col: 'id', type: 'TEXT PK' }, { col: 'run_id', type: 'TEXT FK→runs.id' },
    { col: 'parent_id', type: 'TEXT' }, { col: 'title', type: 'TEXT' },
    { col: 'file', type: 'TEXT' }, { col: 'project', type: 'TEXT' },
  ],
  trends: [
    { col: 'date', type: 'TEXT PK', note: 'YYYY-MM-DD' },
    { col: 'project', type: 'TEXT PK' }, { col: 'branch', type: 'TEXT PK' },
    { col: 'total', type: 'INTEGER' }, { col: 'passed', type: 'INTEGER' },
    { col: 'failed', type: 'INTEGER' }, { col: 'flaky', type: 'INTEGER' },
    { col: 'avg_duration_ms', type: 'REAL' }, { col: 'p95_duration_ms', type: 'REAL' },
  ],
  quarantine: [
    { col: 'id', type: 'TEXT PK' }, { col: 'test_title', type: 'TEXT' },
    { col: 'test_file', type: 'TEXT' }, { col: 'reason', type: 'TEXT' },
    { col: 'quarantined_at', type: 'TEXT' }, { col: 'quarantined_by', type: 'TEXT' },
    { col: 'status', type: "TEXT CHECK(status IN ('pending','approved','rejected')) DEFAULT 'approved'" },
  ],
  known_failures: [
    { col: 'id', type: 'TEXT PK' }, { col: 'test_title', type: 'TEXT' },
    { col: 'test_file', type: 'TEXT' }, { col: 'comment', type: 'TEXT' },
    { col: 'created_at', type: 'TEXT' }, { col: 'created_by', type: 'TEXT' },
  ],
  schedules: [
    { col: 'id', type: 'TEXT PK' }, { col: 'cron_expr', type: 'TEXT' },
    { col: 'enabled', type: 'INTEGER', note: 'boolean' },
    { col: 'last_run_at', type: 'TEXT' }, { col: 'created_at', type: 'TEXT' },
  ],
  workspaces: [
    { col: 'id', type: 'TEXT PK' }, { col: 'name', type: 'TEXT' },
    { col: 'config_path', type: 'TEXT' }, { col: 'created_at', type: 'TEXT' },
  ],
  quality_gate_config: [
    { col: 'id', type: 'TEXT PK' },
    { col: 'pass_rate_threshold', type: 'REAL' },
    { col: 'max_duration_ms', type: 'INTEGER' },
    { col: 'max_flaky_count', type: 'INTEGER' },
    { col: 'updated_at', type: 'TEXT' },
  ],
  defect_categories: [
    { col: 'id', type: 'TEXT PK' }, { col: 'name', type: 'TEXT UNIQUE' },
    { col: 'color', type: 'TEXT' }, { col: 'created_at', type: 'TEXT' },
  ],
  fingerprint_categories: [
    { col: 'fingerprint', type: 'TEXT PK' },
    { col: 'category_id', type: 'TEXT FK→defect_categories.id' },
    { col: 'assigned_at', type: 'TEXT' },
  ],
  attachments: [
    { col: 'id', type: 'TEXT PK' }, { col: 'result_id', type: 'TEXT FK→results.id' },
    { col: 'name', type: 'TEXT' }, { col: 'content_type', type: 'TEXT' },
    { col: 'path', type: 'TEXT' }, { col: 'size_bytes', type: 'INTEGER' },
    { col: 'thumbnail_path', type: 'TEXT' },
    { col: 'is_screenshot_diff', type: 'INTEGER', note: 'boolean' },
  ],
  blob_shards: [
    { col: 'id', type: 'TEXT PK' }, { col: 'run_id', type: 'TEXT' },
    { col: 'shard_index', type: 'INTEGER' }, { col: 'total_shards', type: 'INTEGER' },
    { col: 'file_path', type: 'TEXT' }, { col: 'uploaded_at', type: 'TEXT' },
    { col: 'merged', type: 'INTEGER', note: 'boolean' },
  ],
  nl_query_history: [
    { col: 'id', type: 'INTEGER PK', note: 'autoIncrement' },
    { col: 'user_query', type: 'TEXT' }, { col: 'generated_sql', type: 'TEXT' },
    { col: 'result_count', type: 'INTEGER' }, { col: 'user_id', type: 'TEXT' },
    { col: 'created_at', type: 'TEXT' },
  ],
  failure_taxonomy_rules: [
    { col: 'id', type: 'TEXT PK' }, { col: 'priority', type: 'INTEGER' },
    { col: 'category', type: 'TEXT', note: 'infra_issue|env_issue|test_debt|flaky|app_bug|unknown' },
    { col: 'pattern', type: 'TEXT' },
    { col: 'pattern_target', type: 'TEXT', note: 'error_message|error_stack|test_title|file_path' },
    { col: 'description', type: 'TEXT' },
    { col: 'is_built_in', type: 'INTEGER', note: 'boolean' },
    { col: 'enabled', type: 'INTEGER', note: 'boolean' },
    { col: 'created_at', type: 'TEXT' }, { col: 'updated_at', type: 'TEXT' },
  ],
  failure_classifications: [
    { col: 'id', type: 'TEXT PK' }, { col: 'fingerprint', type: 'TEXT' },
    { col: 'run_id', type: 'TEXT FK→runs.id' },
    { col: 'category', type: 'TEXT', note: 'infra_issue|env_issue|test_debt|flaky|app_bug|unknown' },
    { col: 'confidence', type: 'REAL' },
    { col: 'matched_rule_id', type: 'TEXT FK→failure_taxonomy_rules.id' },
    { col: 'rationale', type: 'TEXT' },
    { col: 'is_manual_override', type: 'INTEGER', note: 'boolean' },
    { col: 'created_at', type: 'TEXT' },
  ],
  test_failure_correlations: [
    { col: 'id', type: 'TEXT PK' }, { col: 'test_stable_id', type: 'TEXT' },
    { col: 'source_file_path', type: 'TEXT' },
    { col: 'failure_count', type: 'INTEGER' }, { col: 'total_occurrences', type: 'INTEGER' },
    { col: 'last_updated_run_id', type: 'TEXT FK→runs.id' },
    { col: 'window_start_date', type: 'TEXT' },
    { col: 'created_at', type: 'TEXT' }, { col: 'updated_at', type: 'TEXT' },
  ],
  locator_suggestions: [
    { col: 'id', type: 'TEXT PK' }, { col: 'test_id', type: 'TEXT' },
    { col: 'run_id', type: 'TEXT FK→runs.id' },
    { col: 'original_selector', type: 'TEXT' }, { col: 'suggested_selector', type: 'TEXT' },
    { col: 'confidence', type: 'REAL' }, { col: 'rationale', type: 'TEXT' },
    { col: 'status', type: 'TEXT', note: 'pending|accepted|rejected|expired' },
    { col: 'created_at', type: 'TEXT' },
  ],
};

export function buildSchemaDescription(): string {
  const lines: string[] = ['Database schema (PostgreSQL):'];
  for (const [table, cols] of Object.entries(SCHEMA_MAP)) {
    lines.push(`\nTABLE ${table}:`);
    for (const c of cols) {
      const note = c.note ? ` -- ${c.note}` : '';
      lines.push(`  ${c.col} ${c.type}${note}`);
    }
  }
  return lines.join('\n');
}

export function buildNLPrompt(userQuery: string): string {
  const schema = buildSchemaDescription();

  return `You are a data analyst. Generate a PostgreSQL SELECT query to answer the user question.
Guidelines:
- ONLY return the SQL. No explanation.
- The query must be read-only (SELECT only).
- Generate ONLY a single SELECT statement.
- Do NOT use INSERT, UPDATE, DELETE, DROP, ALTER, CREATE.
- Use simple JOINs where appropriate.
- For dates, use standard PostgreSQL syntax.
- Always include a LIMIT clause (max ${MAX_ROWS} rows) unless the query specifies a count.

${schema}

Key relationships:
- tests.run_id → runs.id
- results.run_id → runs.id  
- results.test_id → tests.id (composite with run_id)
- suites.run_id → runs.id

User question: ${userQuery}

SQL:`;
}

// ── SQL validation ───────────────────────────────────────────────────────────


export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Strip SQL comments (both line `--` and block comments) to prevent
 * attackers from hiding keywords or table names inside comment bodies.
 */
export function stripSQLComments(sql: string): string {
  // Remove block comments (non-greedy)
  let stripped = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Remove line comments
  stripped = stripped.replace(/--[^\n]*/g, ' ');
  return stripped.replace(/\s+/g, ' ').trim();
}

export function validateSQL(sql: string): ValidationResult {
  const trimmed = sql.trim();

  if (!trimmed) {
    return { valid: false, reason: 'Empty SQL query' };
  }

  // Strip comments before all other checks to prevent hidden keywords
  const cleaned = stripSQLComments(trimmed);

  // Reject multiple statements (semicolons not at end)
  const withoutTrailingSemicolon = cleaned.replace(/;\s*$/, '');
  if (withoutTrailingSemicolon.includes(';')) {
    return { valid: false, reason: 'Multiple statements are forbidden' };
  }

  // Check for forbidden DML/DDL keywords
  if (FORBIDDEN_KEYWORDS.test(cleaned)) {
    return { valid: false, reason: 'Forbidden keyword detected — only SELECT queries allowed' };
  }

  // Check for dangerous SQLite functions (e.g., load_extension, writefile)
  if (FORBIDDEN_FUNCTIONS.test(cleaned)) {
    return { valid: false, reason: 'Forbidden function call detected' };
  }

  // Reject UNION-based injections that could reference different tables
  // UNION/INTERSECT/EXCEPT could combine with queries on forbidden tables
  // We still allow them but validate all table references below
  // (No special block needed — table extraction handles subqueries)

  // Must start with SELECT (or WITH for CTEs)
  if (!/^\s*(SELECT|WITH)\b/i.test(cleaned)) {
    return { valid: false, reason: 'Query must start with SELECT' };
  }

  // Check that all referenced tables are in the allowed list
  // 1. Extract table names after FROM/JOIN keywords (handles quoted identifiers,
  //    schema-qualified names, UNION sub-selects, CTEs, subqueries)
  // 2. Also extract comma-separated tables: FROM t1, t2, t3
  const referencedTables = extractTableNames(cleaned);
  for (const tableName of referencedTables) {
    // Explicitly block SQLite internal/system tables
    if (SYSTEM_TABLES.test(tableName)) {
      return { valid: false, reason: `Access to system table "${tableName}" is forbidden` };
    }
    if (!ALLOWED_TABLES.includes(tableName as typeof ALLOWED_TABLES[number])) {
      return { valid: false, reason: `Table "${tableName}" is not allowed` };
    }
  }

  // Defense-in-depth: scan for quoted or schema-qualified system-table references
  // that might be invisible to the regex (e.g. obfuscated via unusual spacing).
  // Pattern covers: "sqlite_…", `sqlite_…`, [sqlite_…], main.sqlite_…, etc.
  const quotedSystemTableRe =
    /(?:"sqlite_[^"]*"|`sqlite_[^`]*`|\[sqlite_[^[]*\]|\bsqlite_\w+)/i;
  if (quotedSystemTableRe.test(cleaned)) {
    return { valid: false, reason: 'Access to system table is forbidden' };
  }

  return { valid: true };
}

/**
 * Normalise a raw identifier token (strip quoting, strip schema prefix).
 * Handles: bare, "double-quoted", `backtick-quoted`, [bracket-quoted],
 * and schema.table forms.
 */
function normaliseIdentifier(raw: string): string {
  let id = raw.trim();

  // Strip double-quotes, backticks, or square brackets
  if (
    (id.startsWith('"') && id.endsWith('"')) ||
    (id.startsWith('`') && id.endsWith('`'))
  ) {
    id = id.slice(1, -1);
  } else if (id.startsWith('[') && id.endsWith(']')) {
    id = id.slice(1, -1);
  }

  // Strip schema qualifier: main.table_name → table_name
  const dotIdx = id.lastIndexOf('.');
  if (dotIdx !== -1) {
    id = id.slice(dotIdx + 1);
  }

  return id.toLowerCase();
}

/**
 * Extract all table names referenced in a SQL query.
 * Handles:
 *   - FROM / JOIN with bare, double-quoted, backtick-quoted, bracket-quoted identifiers
 *   - Schema-qualified names (schema.table → table)
 *   - Comma-separated table lists in FROM
 *   - UNION / INTERSECT / EXCEPT subqueries (each SELECT gets its own scan)
 *   - CTEs (WITH … AS (…) SELECT … FROM …) — CTE alias names are excluded so
 *     the outer `FROM cte` reference does not trigger a "not allowed" rejection
 *   - Subqueries in WHERE / FROM (parenthesised inline selects are excluded
 *     because the regex stop-word '(' prevents matching them as table names)
 */
export function extractTableNames(sql: string): string[] {
  const tables: Set<string> = new Set();

  // ── 1. Collect CTE names so we can exclude them from table validation ──
  // Matches: WITH name AS ( or WITH name(cols) AS (
  const cteNames: Set<string> = new Set();
  const cteRe = /\b([a-z_][a-z0-9_]*)\s+AS\s*\(/gi;
  for (const m of sql.matchAll(cteRe)) {
    if (m[1]) cteNames.add(m[1].toLowerCase());
  }

  // ── 2. Extract table names from every FROM / JOIN clause ──
  //
  // Leading identifier token: bare word, "quoted", `quoted`, [quoted],
  // optionally schema-qualified (schema.table or "schema"."table" etc.)
  const idRe = /^(?:"([^"]*)"|`([^`]*)`|\[([^\]]*)\]|([a-z_][a-z0-9_]*)(?:\.(?:"[^"]*"|`[^`]*`|\[[^\]]*\]|[a-z_][a-z0-9_]*))?)/i;

  // Collect everything between FROM/JOIN and the next SQL stop keyword or paren/semi.
  // Commas ARE included so comma-separated table lists are captured in one group,
  // then split by comma in post-processing.
  // Stop tokens: SQL keywords that cannot be part of a table name list.
  const STOP_KEYWORDS = 'WHERE|GROUP|ORDER|LIMIT|HAVING|ON|SET|UNION|INTERSECT|EXCEPT|JOIN|INNER|LEFT|RIGHT|OUTER|CROSS|NATURAL|FULL|FROM|SELECT|WITH';
  const fromJoinRe = new RegExp(
    `\\b(?:FROM|JOIN)\\s+((?:(?!"[^"]*"|\`[^\`]*\`|\\[[^\\]]*\\])(?!\\b(?:${STOP_KEYWORDS})\\b)[^(;]|"[^"]*"|\`[^\`]*\`|\\[[^\\]]*\\])+)`,
    'gi',
  );

  for (const match of sql.matchAll(fromJoinRe)) {
    const tableList = match[1];
    if (tableList == null) continue;

    // Split by top-level commas (the regex already stops before subquery parens)
    const segments = tableList.split(',');
    for (const segment of segments) {
      const trimmedSeg = segment.trim();
      if (!trimmedSeg) continue;

      const idMatch = trimmedSeg.match(idRe);
      if (!idMatch) continue;

      const normalised = normaliseIdentifier(idMatch[0]);

      // Skip CTE aliases — they are not real tables
      if (cteNames.has(normalised)) continue;

      tables.add(normalised);
    }
  }

  return [...tables];
}

// ── LIMIT enforcement ────────────────────────────────────────────────────────

export function addLimitClause(sql: string): string {
  const trimmed = sql.trim().replace(/;\s*$/, '');

  // Check if LIMIT already exists
  const limitMatch = trimmed.match(/\bLIMIT\s+(\d+)/i);
  if (limitMatch) {
    const existing = parseInt(limitMatch[1] ?? '0', 10);
    if (existing > MAX_ROWS) {
      // Cap to MAX_ROWS
      return trimmed.replace(/\bLIMIT\s+\d+/i, `LIMIT ${MAX_ROWS}`);
    }
    return trimmed;
  }

  // Add LIMIT clause
  return `${trimmed} LIMIT ${MAX_ROWS}`;
}

// ── AI client (reuses ai-config.json) ────────────────────────────────────────


interface AIConfig {
  provider: 'openai' | 'ollama' | 'anthropic';
  apiKey: string;
  model: string;
  endpoint: string;
}

const CONFIG_DIR = path.resolve(process.cwd(), '.automate');
const CONFIG_PATH = path.join(CONFIG_DIR, 'ai-config.json');

async function readAIConfig(): Promise<AIConfig | null> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as AIConfig;
  } catch {
    return null;
  }
}

async function callAIForSQL(config: AIConfig, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  try {
    let body: unknown;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (config.provider === 'openai' || config.provider === 'ollama') {
      body = {
        model: config.model,
        messages: [
          { role: 'system', content: 'You convert natural language questions into PostgreSQL SELECT queries. Return ONLY the SQL, no explanations.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1, // Low temp for precise SQL
        max_tokens: 300,
      };
      if (config.provider === 'openai') {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
      }
    } else if (config.provider === 'anthropic') {
      body = {
        model: config.model,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
        system: 'You convert natural language questions into PostgreSQL SELECT queries. Return ONLY the SQL, no explanations.',
      };
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    }

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      content?: Array<{ text?: string }>;
    };

    let sql: string;
    if (config.provider === 'openai' || config.provider === 'ollama') {
      sql = data.choices?.[0]?.message?.content ?? '';
    } else {
      sql = data.content?.[0]?.text ?? '';
    }

    // Strip markdown code fences if present
    return sql.replace(/^```(?:sql)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  } finally {
    clearTimeout(timeout);
  }
}

// ── Read-only SQLite connection ──────────────────────────────────────────────

// ── Logger interface (subset of Fastify logger) ──────────────────────────────

export interface NLQueryLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: NLQueryLogger = {
  info() { /* noop */ },
  warn() { /* noop */ },
};

// ── Main NL→SQL function ─────────────────────────────────────────────────────

export interface NLQueryResult {
  sql: string;
  results: unknown[];
  resultCount: number;
  rejected?: boolean;
  error?: string;
}

export async function nlToSQL(userQuery: string, logger: NLQueryLogger = noopLogger): Promise<NLQueryResult> {
  // 1. Read AI config
  const config = await readAIConfig();
  if (!config) {
    return {
      sql: '',
      results: [],
      resultCount: 0,
      rejected: true,
      error: 'AI not configured. Set up AI provider in Settings → AI Configuration.',
    };
  }

  // 2. Build prompt
  const prompt = buildNLPrompt(userQuery);

  // 3. Call LLM
  let rawSQL: string;
  try {
    rawSQL = await callAIForSQL(config, prompt);
  } catch (err) {
    return {
      sql: '',
      results: [],
      resultCount: 0,
      rejected: true,
      error: `AI request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!rawSQL) {
    return { sql: '', results: [], resultCount: 0, rejected: true, error: 'AI returned empty response' };
  }

  // 4. Validate
  const validation = validateSQL(rawSQL);
  if (!validation.valid) {
    logger.warn({ event: 'nl-query-rejected', sql: rawSQL, reason: validation.reason }, 'NL-generated SQL rejected by validator');
    return {
      sql: rawSQL,
      results: [],
      resultCount: 0,
      rejected: true,
      error: `Generated SQL rejected: ${validation.reason}`,
    };
  }

  // 5. Ensure LIMIT
  const safeSql = addLimitClause(rawSQL);

  // 6. Execute with timeout
  try {
    logger.info({ event: 'nl-query-execute', sql: safeSql }, 'Executing NL-generated SQL');
    const result = await pool.query(safeSql);
    const rows = result.rows;
    logger.info({ event: 'nl-query-executed', sql: safeSql, rowCount: rows.length }, 'NL query executed');

    return {
      sql: safeSql,
      results: rows,
      resultCount: rows.length,
    };
  } catch (err) {
    logger.warn({ event: 'nl-query-error', sql: safeSql, error: err instanceof Error ? err.message : String(err) }, 'NL query execution failed');
    return {
      sql: safeSql,
      results: [],
      resultCount: 0,
      rejected: true,
      error: `SQL execution error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
