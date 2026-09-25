/**
 * Playwright global setup — ensure a clean auth state before E2E tests,
 * then seed the database with demo data so every conditional test.skip()
 * has the data it needs.
 *
 * The auth-flow tests toggle auth on/off which can race with other parallel
 * workers.  This setup resets the file-based auth config so every run starts
 * with auth **disabled** and no stale API keys.
 *
 * The seed step writes demo runs/tests/results directly to the SQLite file
 * before the server (re)starts, guaranteeing runIds are always populated.
 * Seeded IDs are exposed as environment variables so spec files can read them
 * directly instead of relying on a live API call that may race with startup.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const AUTH_DIR = path.resolve(process.cwd(), 'apps/server/.automate');
const AUTH_JSON = path.join(AUTH_DIR, 'auth.json');

export default function globalSetup() {
  // ── 1. Reset auth state ──────────────────────────────────────────────────
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  fs.writeFileSync(
    AUTH_JSON,
    JSON.stringify({ keys: [], enabled: false }, null, 2),
    'utf-8',
  );

  // ── 2. Seed demo data into the SQLite DB ─────────────────────────────────
  //    seed-e2e-data.ts creates the schema if it doesn't exist, then seeds
  //    5 demo runs so every conditional `if (runIds.length === 0) test.skip()`
  //    guard never fires.  The script prints a JSON line on stdout that we
  //    parse to capture the seeded run IDs.
  const seedScript = path.resolve(process.cwd(), 'scripts/seed-e2e-data.ts');

  console.log('\n[global-setup] Running E2E data seed...');
  const result = spawnSync('npx', ['tsx', seedScript], {
    stdio: ['ignore', 'pipe', 'inherit'], // capture stdout to parse JSON, inherit stderr
    shell: true,
    env: { ...process.env },
  });

  if (result.status !== 0) {
    const errMsg = `[global-setup] Seed script exited with code ${result.status}`;
    console.error(errMsg);
    throw new Error(errMsg);
  }

  // Parse the last JSON line from the seed script output to get seeded run IDs
  const stdout = result.stdout?.toString() ?? '';
  const lines = stdout.split('\n').filter(Boolean);
  let seededRunIds: string[] = [];

  for (const line of lines) {
    // Forward non-JSON lines to console
    if (!line.startsWith('{')) {
      process.stdout.write(line + '\n');
      continue;
    }
    try {
      const parsed = JSON.parse(line) as { e2eSeededRunIds?: string[] };
      if (Array.isArray(parsed.e2eSeededRunIds)) {
        seededRunIds = parsed.e2eSeededRunIds;
      }
    } catch {
      // Not a JSON line — just print it
      process.stdout.write(line + '\n');
    }
  }

  if (seededRunIds.length === 0) {
    // Seed succeeded but couldn't parse IDs — use known defaults as fallback
    seededRunIds = ['demo-run-1', 'demo-run-2', 'demo-run-3', 'demo-run-4', 'demo-run-5'];
  }

  // ── 3. Expose seeded run IDs as environment variables ─────────────────────
  //    Spec files read these instead of fetching from the API in beforeAll,
  //    which eliminates the race between global-setup and the webServer start.
  process.env.E2E_RUN_IDS = seededRunIds.join(',');
  process.env.E2E_RUN_ID_0 = seededRunIds[0] ?? '';
  process.env.E2E_RUN_ID_1 = seededRunIds[1] ?? '';

  // ── 4. Persist seeded IDs to a JSON file ──────────────────────────────────
  //    Playwright workers run in separate processes that do NOT inherit env vars
  //    set in globalSetup.  Writing to a file gives every worker a reliable
  //    fallback when process.env.E2E_RUN_ID_* is empty.
  const seedFile = path.resolve(process.cwd(), 'e2e/seeded-runs.json');
  fs.writeFileSync(seedFile, JSON.stringify({ e2eSeededRunIds: seededRunIds }), 'utf-8');

  console.log(`[global-setup] Demo data seed complete. Run IDs: ${seededRunIds.join(', ')}\n`);
}
