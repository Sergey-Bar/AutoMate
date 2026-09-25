/**
 * Automate endpoint benchmarks
 *
 * Usage:   node benchmarks/endpoints.bench.mjs
 *
 * Spawns the Dashboard server on port 4099 (in-memory SQLite, auto-migrate),
 * waits for /health to respond, runs autocannon against 5 endpoints for 5 s
 * each at 10 concurrent connections, prints a p99 / avg / req-per-sec table,
 * and exits non-zero if any p99 exceeds its threshold.
 *
 * The spawned server is unconditionally killed before the process exits.
 *
 * Thresholds:
 *   GET  /health                   <  10 ms p99
 *   GET  /api/runs                 <  50 ms p99
 *   GET  /api/runs/nonexistent     <  50 ms p99
 *   GET  /api/features             <  10 ms p99
 *   GET  /api/settings/db-stats    < 100 ms p99
 */

import autocannon from 'autocannon';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const PORT = 4099;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DURATION = 5;       // seconds per endpoint
const CONNECTIONS = 10;   // concurrent connections
const READY_TIMEOUT = 30_000; // ms to wait for /health to respond

const ENDPOINTS = [
  {
    label: 'GET  /health',
    method: 'GET',
    path: '/health',
    threshold: 10,
  },
  {
    label: 'GET  /api/runs',
    method: 'GET',
    path: '/api/runs',
    threshold: 50,
  },
  {
    label: 'GET  /api/runs/nonexistent',
    method: 'GET',
    path: '/api/runs/nonexistent',
    threshold: 50,
  },
  {
    label: 'GET  /api/features',
    method: 'GET',
    path: '/api/features',
    threshold: 10,
  },
  {
    label: 'GET  /api/settings/db-stats',
    method: 'GET',
    path: '/api/settings/db-stats',
    threshold: 100,
  },
];

// ── Spawn server ─────────────────────────────────────────────────────────────

console.log(`Spawning Dashboard server on port ${PORT} (in-memory DB)…`);

const server = spawn('node', ['--import', 'tsx', 'apps/server/src/index.ts'], {
  cwd: rootDir,
  env: {
    ...process.env,
    PORT: String(PORT),
    DATABASE_URL: ':memory:',
    AUTO_MIGRATE: 'true',
    NODE_ENV: 'development',
    LOG_LEVEL: 'error',
    DISABLE_AUTH: 'true',
  },
  stdio: 'pipe',
});

// Suppress server log noise; forward unexpected stderr lines for debugging
server.stderr.on('data', (chunk) => {
  const line = chunk.toString();
  // Only surface lines that look like real errors (not info-level Fastify logs)
  if (/\bERROR\b|\bFATAL\b|\bUnhandledRejection\b/i.test(line)) {
    process.stderr.write(line);
  }
});

// Ensure the child is killed if the benchmark process exits for any reason
function killServer() {
  try { server.kill(); } catch { /* already dead */ }
}
process.on('exit', killServer);
process.on('SIGINT', () => { killServer(); process.exit(130); });

// ── Wait for server readiness ─────────────────────────────────────────────────

await waitForReady(`${BASE_URL}/health`, READY_TIMEOUT);
console.log('Server ready.\n');

// ── Run benchmarks ────────────────────────────────────────────────────────────

const results = [];
let anyFailed = false;

for (const ep of ENDPOINTS) {
  process.stdout.write(`  ${ep.label.padEnd(35)} … `);

  const res = await autocannon({
    url: `${BASE_URL}${ep.path}`,
    method: ep.method,
    duration: DURATION,
    connections: CONNECTIONS,
  });

  const p99 = res.latency.p99;
  const avg = Math.round(res.latency.average);
  const rps = Math.round(res.requests.average);
  const passed = p99 <= ep.threshold;

  if (!passed) anyFailed = true;

  results.push({ label: ep.label, p99, avg, rps, threshold: ep.threshold, passed });
  process.stdout.write(
    passed
      ? 'PASS\n'
      : `FAIL  (p99 ${p99} ms > threshold ${ep.threshold} ms)\n`,
  );
}

// ── Shutdown ──────────────────────────────────────────────────────────────────

killServer();

// Give the process a moment to die before printing results
await new Promise((r) => setTimeout(r, 200));

printTable(results);

if (anyFailed) {
  console.error('\nFAIL — one or more endpoints exceeded their p99 latency threshold.');
  process.exit(1);
}

console.log('\nPASS — all endpoints within latency thresholds.');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* server not yet listening */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  killServer();
  throw new Error(`Dashboard server did not become ready within ${timeoutMs} ms`);
}

function printTable(rows) {
  const sep = '+-------------------------------------+--------+--------+----------+--------+';
  const hdr = '| Endpoint                            | p99 ms | avg ms |  req/sec | Status |';

  console.log('\n Automate Endpoint Benchmarks');
  console.log(sep);
  console.log(hdr);
  console.log(sep);

  for (const r of rows) {
    const status = r.passed ? ' PASS ' : ' FAIL ';
    console.log(
      `| ${r.label.padEnd(35)} | ${String(r.p99).padStart(6)} | ${String(r.avg).padStart(6)} | ${String(r.rps).padStart(8)} | ${status} |`,
    );
  }

  console.log(sep);
}
