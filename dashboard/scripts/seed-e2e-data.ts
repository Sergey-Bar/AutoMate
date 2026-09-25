#!/usr/bin/env tsx
/**
 * seed-e2e-data.ts — E2E test data seeder
 *
 * Seeds the SQLite database with demo runs, suites, tests, and results so that
 * every conditional `test.skip()` guard in the E2E specs evaluates to false.
 *
 * Design goals:
 * - Idempotent: safe to run multiple times (uses INSERT OR IGNORE + cleanup)
 * - Schema-safe: applies CREATE TABLE IF NOT EXISTS before any INSERT
 * - Self-contained: no external services required
 *
 * Seeded IDs are printed as JSON to stdout under the key "e2eSeededRunIds"
 * so that global-setup.ts can capture and expose them as env vars.
 *
 * Usage:
 *   npx tsx scripts/seed-e2e-data.ts
 */
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  toISO,
  generateRunDefs,
  generateSuiteTemplates,
  generateSuitesForRuns,
  generateTestTitles,
  generateErrorMessages,
  computeTestStatus,
  generateTrendData,
} from '../apps/server/src/lib/seed-helpers.js';
import type { StatusCounters } from '../apps/server/src/lib/seed-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.resolve(__dirname, '../apps/server/data');
const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, 'dashboard.db');

// Ensure the data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

console.log('[seed-e2e-data] Seeding E2E demo data...');
console.log(`[seed-e2e-data] DB: ${DB_PATH}`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF'); // OFF during schema creation to avoid ordering issues
db.pragma('busy_timeout = 30000');

// ── Apply schema (CREATE TABLE IF NOT EXISTS) ────────────────────────────────
// Read the migration file and convert to IF NOT EXISTS form
const migrationPath = path.resolve(__dirname, '../apps/server/drizzle/0000_mighty_malcolm_colcord.sql');
if (fs.existsSync(migrationPath)) {
  const migrationSql = fs.readFileSync(migrationPath, 'utf-8');
  // Split on statement-breakpoint and apply each statement with IF NOT EXISTS
  const statements = migrationSql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    // Convert CREATE TABLE to CREATE TABLE IF NOT EXISTS
    const safe = stmt.replace(/^CREATE TABLE (`[^`]+`)/gm, 'CREATE TABLE IF NOT EXISTS $1');
    // Convert CREATE INDEX / CREATE UNIQUE INDEX to CREATE ... IF NOT EXISTS
    const safeIdx = safe.replace(
      /^CREATE (UNIQUE )?INDEX (`[^`]+`)/gm,
      'CREATE $1INDEX IF NOT EXISTS $2',
    );
    try {
      db.exec(safeIdx);
    } catch {
      // Ignore errors for statements that already exist (e.g. duplicate indexes)
    }
  }
}

// Re-enable foreign keys for data integrity during seeding
db.pragma('foreign_keys = ON');

// ── Utilities ────────────────────────────────────────────────────────────────
const hex = (n: number) => randomBytes(n).toString('hex');

const now = new Date();
now.setUTCHours(12, 0, 0, 0); // anchor to noon UTC for stable dates

const t = (offsetMs: number) => new Date(now.getTime() - offsetMs);

// ── Clean up existing demo data (idempotent) ─────────────────────────────────
console.log('[seed-e2e-data] Cleaning up existing demo-run-* data...');
db.exec(`
  DELETE FROM nl_query_history WHERE user_id = 'demo-user';
  DELETE FROM fingerprint_categories WHERE fingerprint LIKE 'demo%';
  DELETE FROM attachments WHERE id LIKE 'demo-%';
  DELETE FROM results WHERE id LIKE 'demo-%';
  DELETE FROM tests WHERE run_id LIKE 'demo-run-%';
  DELETE FROM suites WHERE id LIKE 'demo-%';
  DELETE FROM blob_shards WHERE id LIKE 'demo-%';
  DELETE FROM runs WHERE id LIKE 'demo-run-%';
  DELETE FROM quarantine WHERE id LIKE 'demo-%';
  DELETE FROM known_failures WHERE id LIKE 'demo-%';
  DELETE FROM schedules WHERE id LIKE 'demo-%';
  DELETE FROM workspaces WHERE id LIKE 'demo-%';
  DELETE FROM defect_categories WHERE id LIKE 'demo-%';
  DELETE FROM quality_gate_config WHERE id = 'global';
  DELETE FROM trends WHERE project IN ('chromium','firefox','webkit') AND branch = 'main';
`);

// ── Prepared statements ───────────────────────────────────────────────────────
const insertRun = db.prepare(`
  INSERT OR IGNORE INTO runs (
    id, started_at, finished_at, status, total, passed, failed, flaky, skipped,
    duration_ms, branch, commit_sha, commit_message, triggered_by, config, raw_args,
    source, gate_status, workspace_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertSuite = db.prepare(`
  INSERT OR IGNORE INTO suites (id, run_id, parent_id, title, file, project)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertTest = db.prepare(`
  INSERT OR IGNORE INTO tests (
    id, run_id, suite_id, title, file, line, column, stable_id, status,
    duration_ms, tags, annotations, retry_count, expected_status, worker_index
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertResult = db.prepare(`
  INSERT OR IGNORE INTO results (
    id, test_id, run_id, retry, status, duration_ms, started_at,
    error_message, error_stack, worker_index, parallel_index,
    stdout, stderr, steps, attachments, fingerprint
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertAttachment = db.prepare(`
  INSERT OR IGNORE INTO attachments (
    id, result_id, name, content_type, path, size_bytes, thumbnail_path, is_screenshot_diff
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertTrend = db.prepare(`
  INSERT OR IGNORE INTO trends (
    date, project, branch, total, passed, failed, flaky, avg_duration_ms, p95_duration_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertWorkspace = db.prepare(`
  INSERT OR IGNORE INTO workspaces (id, name, config_path, test_results_dir, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

const insertQualityGate = db.prepare(`
  INSERT OR IGNORE INTO quality_gate_config (id, pass_rate_threshold, max_duration_ms, max_flaky_count, updated_at)
  VALUES (?, ?, ?, ?, ?)
`);

const insertDefectCategory = db.prepare(`
  INSERT OR IGNORE INTO defect_categories (id, name, color, created_at)
  VALUES (?, ?, ?, ?)
`);

const insertFingerprintCategory = db.prepare(`
  INSERT OR IGNORE INTO fingerprint_categories (fingerprint, category_id, assigned_at)
  VALUES (?, ?, ?)
`);

const insertQuarantine = db.prepare(`
  INSERT OR IGNORE INTO quarantine (id, test_title, test_file, reason, quarantined_at, quarantined_by)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertKnownFailure = db.prepare(`
  INSERT OR IGNORE INTO known_failures (id, test_title, test_file, comment, created_at, created_by)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertSchedule = db.prepare(`
  INSERT OR IGNORE INTO schedules (id, cron_expr, run_options, enabled, last_run_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertNlQuery = db.prepare(`
  INSERT OR IGNORE INTO nl_query_history (user_query, generated_sql, result_count, user_id, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

// ── Seed all data in a single transaction ─────────────────────────────────────
const seedAll = db.transaction(() => {
  // Workspaces
  insertWorkspace.run('demo-ws-1', 'Main App', 'playwright.config.ts', 'test-results', toISO(now));
  insertWorkspace.run('demo-ws-2', 'API Tests', 'api-tests/playwright.config.ts', 'api-results', toISO(now));

  // Defect categories
  insertDefectCategory.run('demo-cat-timeout', 'Timeout', '#ef4444', toISO(now));
  insertDefectCategory.run('demo-cat-selector', 'Selector Not Found', '#f59e0b', toISO(now));
  insertDefectCategory.run('demo-cat-api', 'API Error', '#3b82f6', toISO(now));
  insertDefectCategory.run('demo-cat-assertion', 'Assertion Failed', '#8b5cf6', toISO(now));

  // Quality gate config
  insertQualityGate.run('global', 95.0, 600000, 5, toISO(now));

  // ── Runs (5) ────────────────────────────────────────────────────────────────
  const runDefs = generateRunDefs(now);

  const config = JSON.stringify({ projects: ['chromium'], workers: 4 });
  const rawArgs = '--reporter=json --workers=4';

  for (const run of runDefs) {
    insertRun.run(
      run.id, toISO(run.startedAt), toISO(run.finishedAt), run.status,
      run.total, run.passed, run.failed, run.flaky, run.skipped, run.durationMs,
      run.branch, run.commitSha, run.commitMessage, run.triggeredBy,
      config, rawArgs, 'live', run.gateStatus, run.workspaceId,
    );
  }

  // ── Suites ──────────────────────────────────────────────────────────────────
  const suiteTemplates = generateSuiteTemplates();
  const suites = generateSuitesForRuns(runDefs, suiteTemplates);

  for (const suite of suites) {
    insertSuite.run(suite.id, suite.runId, null, suite.title, suite.file, suite.project);
  }

  // ── Tests + Results ──────────────────────────────────────────────────────────
  const testTitles = generateTestTitles();
  const errorMessages = generateErrorMessages();

  const errorStack = [
    '    at Object.<anonymous> (tests/auth/login.spec.ts:45:20)',
    '    at runTest (node_modules/@playwright/test/lib/worker.js:234:15)',
  ].join('\n');

  let testCtr = 0;
  let resultCtr = 0;
  let attachCtr = 0;
  const fingerprints: string[] = [];

  for (const run of runDefs) {
    const suitesForRun = suites.filter((s) => s.runId === run.id);
    let counters: StatusCounters = { passedCnt: 0, failedCnt: 0, flakyCnt: 0, skippedCnt: 0, inRun: 0 };

    for (const suite of suitesForRun) {
      const perSuite = Math.ceil(run.total / 3);

      for (let i = 0; i < perSuite && counters.inRun < run.total; i++) {
        const result = computeTestStatus(run, counters);
        if (result.shouldBreak) break;

        const { status, tags, retryCnt } = result;
        counters = result.counters;

        const testId = `demo-test-${testCtr}`;
        // Stable ID mirrors what seed-demo-data produces: "stable-auth-tests-000"
        const stableId = `stable-${suite.title.toLowerCase().replace(/\s+/g, '-')}-${String(i).padStart(3, '0')}`;
        const title = testTitles[testCtr % testTitles.length] ?? '';
        const line = 10 + i * 5;
        const worker = testCtr % 8;

        const dur = status === 'queued' ? 0 : (Math.abs(testCtr * 7919) % 4500) + 500;

        insertTest.run(
          testId, run.id, suite.id, title, suite.file, line, 5,
          stableId, status, dur, tags, JSON.stringify([]), retryCnt, 'passed', worker,
        );

        // Results
        if (status === 'passed') {
          const rid = `demo-result-${resultCtr++}`;
          insertResult.run(
            rid, testId, run.id, 0, 'passed', dur,
            toISO(new Date(run.startedAt.getTime() + counters.inRun * 2000)),
            null, null, worker, 0,
            JSON.stringify([]), JSON.stringify([]),
            JSON.stringify([{ title: 'Before Hooks', duration: 150 }, { title: 'navigate', duration: dur - 150 }]),
            JSON.stringify([]), null,
          );
        } else if (status === 'failed') {
          const rid = `demo-result-${resultCtr++}`;
          const fp = `demo${hex(6)}`;
          fingerprints.push(fp);
          insertResult.run(
            rid, testId, run.id, 0, 'failed', dur,
            toISO(new Date(run.startedAt.getTime() + counters.inRun * 2000)),
            errorMessages[counters.failedCnt % errorMessages.length], errorStack, worker, 0,
            JSON.stringify([]), JSON.stringify([]),
            JSON.stringify([{ title: 'Before Hooks', duration: 150 }]),
            JSON.stringify([]), fp,
          );
          // Screenshot attachment
          insertAttachment.run(
            `demo-attach-${attachCtr++}`, rid, 'screenshot', 'image/png',
            `test-results/${run.id}/${testId}/screenshot.png`, 45678, null, 0,
          );
        } else if (status === 'flaky') {
          // retry 0: failed
          const rid0 = `demo-result-${resultCtr++}`;
          const fp = `demo${hex(6)}`;
          fingerprints.push(fp);
          insertResult.run(
            rid0, testId, run.id, 0, 'failed', dur,
            toISO(new Date(run.startedAt.getTime() + counters.inRun * 2000)),
            errorMessages[counters.flakyCnt % errorMessages.length], errorStack, worker, 0,
            JSON.stringify([]), JSON.stringify([]),
            JSON.stringify([{ title: 'Before Hooks', duration: 150 }]),
            JSON.stringify([]), fp,
          );
          // retry 1: passed
          const rid1 = `demo-result-${resultCtr++}`;
          insertResult.run(
            rid1, testId, run.id, 1, 'passed', dur - 200,
            toISO(new Date(run.startedAt.getTime() + counters.inRun * 2000 + dur + 500)),
            null, null, worker, 0,
            JSON.stringify([]), JSON.stringify([]),
            JSON.stringify([{ title: 'Before Hooks', duration: 150 }]),
            JSON.stringify([]), null,
          );
        } else if (status === 'skipped') {
          const rid = `demo-result-${resultCtr++}`;
          insertResult.run(
            rid, testId, run.id, 0, 'skipped', 0,
            toISO(new Date(run.startedAt.getTime() + counters.inRun * 2000)),
            null, null, worker, 0,
            JSON.stringify([]), JSON.stringify([]),
            JSON.stringify([]), JSON.stringify([]), null,
          );
        }

        counters = { ...counters, inRun: counters.inRun + 1 };
        testCtr++;
      }
    }
  }

  // Fingerprint → category mappings
  const cats = ['demo-cat-timeout', 'demo-cat-selector', 'demo-cat-api', 'demo-cat-assertion'];
  fingerprints.slice(0, Math.min(10, fingerprints.length)).forEach((fp, idx) => {
    insertFingerprintCategory.run(fp, cats[idx % cats.length], toISO(now));
  });

  // ── Trends (30 days × 3 projects) ───────────────────────────────────────────
  const trendRows = generateTrendData(now, ['chromium', 'firefox', 'webkit']);
  for (const row of trendRows) {
    insertTrend.run(row.date, row.project, row.branch, row.total, row.passed, row.failed, row.flaky, row.avgDurationMs, row.p95DurationMs);
  }

  // ── Quarantine ───────────────────────────────────────────────────────────────
  insertQuarantine.run(
    'demo-quar-1', 'should handle concurrent user sessions', 'tests/auth/sessions.spec.ts',
    'Flaky due to race condition - JIRA-234', toISO(t(2 * 86_400_000)), 'qa-team',
  );
  insertQuarantine.run(
    'demo-quar-2', 'should refresh auth token automatically', 'tests/auth/token.spec.ts',
    'Intermittent timeout on CI', toISO(t(3 * 86_400_000)), 'dev-team',
  );
  insertQuarantine.run(
    'demo-quar-3', 'should upload files with progress indicator', 'tests/dashboard/upload.spec.ts',
    'Random failures when network is slow', toISO(t(7 * 86_400_000)), 'qa-lead',
  );

  // ── Known Failures ───────────────────────────────────────────────────────────
  insertKnownFailure.run(
    'demo-known-1', 'should display notification badges', 'tests/dashboard/notifications.spec.ts',
    'Known WebSocket disconnect issue - JIRA-456', toISO(t(7 * 86_400_000)), 'product-team',
  );
  insertKnownFailure.run(
    'demo-known-2', 'should handle browser back button navigation', 'tests/navigation/history.spec.ts',
    'Expected Safari limitation - JIRA-789', toISO(t(3 * 86_400_000)), 'qa-team',
  );

  // ── Schedules ────────────────────────────────────────────────────────────────
  insertSchedule.run(
    'demo-sched-1', '0 2 * * *',
    JSON.stringify({ projects: ['chromium', 'firefox'], workers: 8 }),
    1, toISO(t(3_600_000)), toISO(t(7 * 86_400_000)),
  );
  insertSchedule.run(
    'demo-sched-2', '0 * * * *',
    JSON.stringify({ grep: '@smoke', workers: 4 }),
    1, toISO(t(3_600_000)), toISO(t(7 * 86_400_000)),
  );
  insertSchedule.run(
    'demo-sched-3', '0 6 * * 0',
    JSON.stringify({ grep: '@regression', workers: 16, retries: 2 }),
    1, toISO(t(7 * 86_400_000)), toISO(t(30 * 86_400_000)),
  );

  // ── NL Query History ─────────────────────────────────────────────────────────
  insertNlQuery.run(
    'Show me all failed tests in the last 7 days',
    "SELECT * FROM tests WHERE status = 'failed'",
    42, 'demo-user', toISO(t(86_400_000)),
  );
  insertNlQuery.run(
    'What is the pass rate trend for chromium?',
    "SELECT date, passed * 100.0 / total FROM trends WHERE project = 'chromium'",
    30, 'demo-user', toISO(t(2 * 86_400_000)),
  );
});

seedAll();

// ── Print summary ─────────────────────────────────────────────────────────────
const runsCount = (db.prepare("SELECT COUNT(*) as c FROM runs WHERE id LIKE 'demo-run-%'").get() as { c: number }).c;
const testsCount = (db.prepare("SELECT COUNT(*) as c FROM tests WHERE run_id LIKE 'demo-run-%'").get() as { c: number }).c;
const seededRunIds = (db.prepare("SELECT id FROM runs WHERE id LIKE 'demo-run-%' ORDER BY started_at DESC").all() as Array<{ id: string }>).map((r) => r.id);

console.log(`[seed-e2e-data] Seeded ${runsCount} runs, ${testsCount} tests`);
console.log(`[seed-e2e-data] Run IDs: ${seededRunIds.join(', ')}`);

// Output machine-readable JSON for global-setup to consume
// This line must remain last and must be valid JSON
console.log(JSON.stringify({ e2eSeededRunIds: seededRunIds }));

db.close();
