/**
 * Brings up the API against a real PostgreSQL, for the performance gate.
 *
 * `performance/smoke.js` measures three endpoints, and until now the only way to
 * produce a target for them was to start the stack by hand. `pnpm
 * test:performance` was wired into no workflow, no `verify`, and no
 * `verify:release`, so nothing in this repository ever executed a threshold —
 * and `observed_on_reference_hardware` in `performance/thresholds.json` is
 * still `null` for every metric because no run has ever populated it.
 *
 * Two things have to be true before a k6 number means anything, and this script
 * guarantees both rather than assuming them:
 *
 *   1. The schema is the real one, from the real migration graph. A measured
 *      query against a hand-made table measures the fixture, not the product.
 *   2. The API is on the Drizzle path. `apps/api/src/index.ts` falls back to the
 *      in-memory store whenever `DATABASE_URL` is absent, so measuring without
 *      it measures a product that does not ship.
 *
 * Readiness is reported through a file rather than a log line, so a caller can
 * distinguish "still migrating" from "failed to migrate" instead of waiting out
 * a timeout in both cases. On failure the script exits non-zero; a load test
 * against the wrong product is worse than no load test, because it produces a
 * number that reads like evidence.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env['PORT'] ?? '3000';
const baseUrl = `http://127.0.0.1:${port}`;
const readyFile = process.env['PERF_READY_FILE'] ?? path.join(root, 'var', 'performance-api.ready');

/**
 * @param {string} state
 * @param {string} detail
 */
function report(state, detail) {
  try {
    mkdirSync(path.dirname(readyFile), { recursive: true });
    writeFileSync(readyFile, `${state} ${detail}\n`, 'utf8');
  } catch (error) {
    console.error(`[performance-server] could not write the ready file: ${String(error)}`);
  }
}

/**
 * @param {string} label
 * @param {string[]} argv
 */
function run(label, argv) {
  console.info(`[performance-server] ${label}: pnpm ${argv.join(' ')}`);
  const result = spawnSync('pnpm', argv, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    report('failed', `${label} could not start: ${result.error.message}`);
    throw result.error;
  }
  if (result.status !== 0) {
    report('failed', `${label} exited ${String(result.status)}`);
    console.error(`[performance-server] ${label} exited ${String(result.status)}.`);
    process.exit(result.status ?? 1);
  }
}

const databaseUrl = process.env['DATABASE_URL']?.trim() ?? '';
if (databaseUrl === '') {
  report('failed', 'DATABASE_URL is not set');
  console.error(
    '[performance-server] DATABASE_URL is not set. The API would fall back to the in-memory ' +
      'store and the measured numbers would describe a product that does not ship.',
  );
  process.exit(1);
}

rmSync(readyFile, { force: true });
run('apply migrations', ['--filter', '@automate/db', 'db:migrate']);

// The key the scenario sends as a bearer token. The load profile has to
// authenticate the way a real reporter does, or it measures the 401 path and
// calls it a fast endpoint.
const api = spawn(
  'pnpm',
  ['--filter', '@automate/api', 'exec', 'tsx', '--import', './src/instrument.ts', 'src/index.ts'],
  {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      AUTOMATE_API_KEY:
        process.env['AUTOMATE_API_KEY'] ?? 'e2e-installation-key-32-characters-long',
      COOKIE_SECRET: process.env['COOKIE_SECRET'] ?? 'performance-gate-cookie-secret-32-chars',
      PUBLIC_APP_URL: process.env['PUBLIC_APP_URL'] ?? 'http://127.0.0.1:5173',
      PORT: port,
      NODE_ENV: process.env['NODE_ENV'] ?? 'development',
    },
  },
);

// The literal union rather than a bare string: `process.on` takes a
// `NodeJS.Signals`, and a signal name Node does not recognise throws at
// registration. Naming the two signals is the whole contract, so the type says so.
for (const signal of /** @type {NodeJS.Signals[]} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => api.kill(signal));
}
api.on('exit', (code, signal) => {
  report('failed', `the api exited (code=${String(code)} signal=${String(signal)})`);
  console.error(
    `[performance-server] api exited (code=${String(code)} signal=${String(signal)}). Exiting with it.`,
  );
  process.exit(code ?? 0);
});

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (let attempt = 1; attempt <= 90; attempt += 1) {
  try {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    if (response.ok) {
      report('ready', `${baseUrl} after ${String(attempt)}s`);
      console.info(`[performance-server] ready: ${baseUrl} after ${String(attempt)}s`);
      // Stay alive as the supervisor. The workflow's `&` owns the lifetime; a
      // `Stop the API` step signals this process, which signals the child.
      await new Promise(() => {});
    }
  } catch {
    // Not listening yet. The loop is the readiness check.
  }
  await sleep(1000);
}

report('failed', `the api never became healthy at ${baseUrl}`);
console.error(`[performance-server] api never became healthy at ${baseUrl}.`);
api.kill('SIGTERM');
process.exit(1);
