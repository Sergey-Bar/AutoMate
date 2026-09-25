/**
 * Automate endpoint benchmarks
 *
 * Usage:   node benchmarks/endpoints.bench.mjs
 * Requires: pnpm build  (compiles apps/server to apps/server/dist/)
 *
 * Starts the Fastify server programmatically on port 3099 (in-memory SQLite),
 * runs autocannon against 4 endpoints for 5 s each at 10 concurrent connections,
 * prints a p99 / avg / req-per-sec table, and exits non-zero if any p99 exceeds
 * its threshold.
 *
 * Thresholds:
 *   GET  /health              <  10 ms p99
 *   GET  /api/conversations   <  50 ms p99
 *   POST /api/conversations   < 100 ms p99
 *   GET  /api/connectors      <  50 ms p99
 */

import autocannon from 'autocannon';

const PORT = 3099;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DURATION = 5;       // seconds per endpoint
const CONNECTIONS = 10;   // concurrent connections

const ENDPOINTS = [
  {
    label: 'GET  /health',
    method: 'GET',
    path: '/health',
    threshold: 10,
  },
  {
    label: 'GET  /api/conversations',
    method: 'GET',
    path: '/api/conversations',
    threshold: 50,
  },
  {
    label: 'POST /api/conversations',
    method: 'POST',
    path: '/api/conversations',
    threshold: 100,
    body: JSON.stringify({ title: 'bench' }),
    headers: { 'content-type': 'application/json' },
  },
  {
    label: 'GET  /api/connectors',
    method: 'GET',
    path: '/api/connectors',
    threshold: 50,
  },
];

// ── Ensure in-memory SQLite before the server module initialises its DB client ──
process.env.DATABASE_URL = ':memory:';

const { buildServer } = await import('../apps/server/dist/index.js');

console.log(`Starting Automate server on port ${PORT} (in-memory DB)…`);
const app = await buildServer({ logger: false });
await app.listen({ port: PORT, host: '127.0.0.1' });
console.log('Server ready.\n');

const results = [];
let anyFailed = false;

for (const ep of ENDPOINTS) {
  process.stdout.write(`  ${ep.label.padEnd(32)} … `);

  /** @type {import('autocannon').Options} */
  const opts = {
    url: `${BASE_URL}${ep.path}`,
    method: ep.method,
    duration: DURATION,
    connections: CONNECTIONS,
  };

  if (ep.body) {
    opts.body = ep.body;
    opts.headers = ep.headers;
  }

  const res = await autocannon(opts);

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

await app.close();

printTable(results);

if (anyFailed) {
  console.error('\nFAIL — one or more endpoints exceeded their p99 latency threshold.');
  process.exit(1);
}

console.log('\nPASS — all endpoints within latency thresholds.');

// ── Helpers ──────────────────────────────────────────────────────────────────

function printTable(rows) {
  const sep = '+----------------------------------+--------+--------+----------+--------+';
  const hdr = '| Endpoint                         | p99 ms | avg ms |  req/sec | Status |';

  console.log('\n Automate Endpoint Benchmarks');
  console.log(sep);
  console.log(hdr);
  console.log(sep);

  for (const r of rows) {
    const status = r.passed ? ' PASS ' : ' FAIL ';
    console.log(
      `| ${r.label.padEnd(32)} | ${String(r.p99).padStart(6)} | ${String(r.avg).padStart(6)} | ${String(r.rps).padStart(8)} | ${status} |`,
    );
  }

  console.log(sep);
}
