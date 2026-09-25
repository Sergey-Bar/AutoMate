#!/usr/bin/env tsx
/**
 * seed-test-data.ts — Performance benchmark seeder
 *
 * Inserts a single run with 10,000 synthetic test rows into the SQLite DB.
 * Used to validate VALID-03 (TanStack Virtual / react-arborist 60fps at 10K rows).
 *
 * Usage:
 *   pnpm seed:perf
 *
 * The seeded run ID is printed to stdout. Navigate to /runs/<id> to test.
 *
 * Prerequisites: server DB must exist at apps/server/data/dashboard.db
 * (run `pnpm --filter server db:push` first if DB doesn't exist)
 */
import Database from 'better-sqlite3';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH =
  process.env.DB_PATH ??
  path.resolve(__dirname, '../apps/server/data/dashboard.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const runId = `perf-seed-${Date.now()}`;
const now = new Date().toISOString();

// Insert the run
db.prepare(
  `INSERT OR IGNORE INTO runs
   (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, duration_ms, triggered_by)
   VALUES (?, ?, ?, 'passed', 10000, 8500, 500, 200, 800, 300000, 'seed')`,
).run(runId, now, now);

// 200 files × 50 tests each = 10,000 tests
const TOTAL = 10_000;
const TESTS_PER_FILE = 50;

const statuses = [
  'passed', 'passed', 'passed', 'passed', 'passed',
  'passed', 'passed', 'passed', 'passed', 'passed',
  'failed', 'flaky', 'skipped',
] as const;

const insert = db.prepare(
  `INSERT OR IGNORE INTO tests
   (id, run_id, title, file, line, column, status, duration_ms, tags, annotations, retry_count, worker_index)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', 0, ?)`,
);

const seedTests = db.transaction(() => {
  for (let i = 0; i < TOTAL; i++) {
    const fileIdx = Math.floor(i / TESTS_PER_FILE);
    const lineIdx = (i % TESTS_PER_FILE) * 3 + 10;
    const status = statuses[i % statuses.length];
    const durationMs = Math.floor(Math.random() * 4_900) + 100;
    const workerIndex = i % 8;

    insert.run(
      `${runId}-t${i}`,
      runId,
      `test ${i % TESTS_PER_FILE}: ${status} scenario for feature ${i % 100}`,
      `tests/feature-${fileIdx}/suite.spec.ts`,
      lineIdx,
      0,
      status,
      durationMs,
      workerIndex,
    );
  }
});

seedTests();

console.log(`\n✅ Seeded run: ${runId}`);
console.log(`   Tests: ${TOTAL.toLocaleString()} (8500 passed, 500 failed, 200 flaky, 800 skipped)`);
console.log(`   Files: ${TOTAL / TESTS_PER_FILE} (${TESTS_PER_FILE} tests each)`);
console.log(`\nNavigate to: http://localhost:5173/runs/${runId}`);
console.log('Then scroll the test tree to verify 60fps (Chrome DevTools → Rendering → Frame Rendering Stats)\n');

db.close();
