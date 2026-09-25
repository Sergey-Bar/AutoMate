/**
 * Smoke Test — Automate API
 *
 * Lightweight Node.js script (no k6 required) that verifies the core API
 * endpoints respond correctly.  Designed to run in CI after deployment.
 *
 * Usage:
 *   npx tsx scripts/smoke-dashboard.ts
 *   DASHBOARD_URL=http://staging:4000 npx tsx scripts/smoke-dashboard.ts
 *
 * Exit code 0 = all checks passed, 1 = at least one failure.
 */

const BASE_URL = process.env.DASHBOARD_URL ?? 'http://localhost:4000';
const API_KEY = process.env.AUTOMATE_DASHBOARD_API_KEY ?? '';

interface Check {
  name: string;
  url: string;
  validate: (status: number, body: unknown) => boolean;
}

const checks: Check[] = [
  {
    name: 'GET /health — status 200 and body.status === "ok"',
    url: `${BASE_URL}/health`,
    validate: (status, body) =>
      status === 200 &&
      typeof body === 'object' &&
      body !== null &&
      (body as Record<string, unknown>).status === 'ok',
  },
  {
    name: 'GET /api/runs — status 200 and returns array',
    url: `${BASE_URL}/api/runs?limit=5`,
    validate: (status, body) => status === 200 && Array.isArray(body),
  },
  {
    name: 'GET /api/analytics/trends — not a server error',
    url: `${BASE_URL}/api/analytics/trends`,
    validate: (status) => status < 500,
  },
  {
    name: 'GET /api/analytics/pass-rate — status 200',
    url: `${BASE_URL}/api/analytics/pass-rate`,
    validate: (status) => status === 200,
  },
];

async function run(): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['x-api-key'] = API_KEY;

  let failures = 0;

  for (const check of checks) {
    try {
      const res = await fetch(check.url, { headers, signal: AbortSignal.timeout(10_000) });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        // non-JSON response — body stays null
      }

      if (check.validate(res.status, body)) {
        console.log(`  ✓  ${check.name}`);
      } else {
        console.error(`  ✗  ${check.name} — status ${res.status}`);
        failures++;
      }
    } catch (err) {
      console.error(`  ✗  ${check.name} — ${(err as Error).message}`);
      failures++;
    }
  }

  console.log(`\n${checks.length - failures}/${checks.length} checks passed.`);

  if (failures > 0) {
    process.exit(1);
  }
}

run();
