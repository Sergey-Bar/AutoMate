#!/usr/bin/env node

/**
 * local-smoke.mjs
 *
 * Fast local readiness checks for the unified platform.
 * Default checks:
 * - API health endpoint:   GET http://localhost:3000/health
 * - Web root endpoint:     GET http://localhost:5173/
 *
 * Usage:
 *   node scripts/local-smoke.mjs
 *   node scripts/local-smoke.mjs --json
 *   node scripts/local-smoke.mjs --api-url=http://localhost:3100 --web-url=http://localhost:4173
 */

const DEFAULTS = {
  apiUrl: 'http://localhost:3000',
  webUrl: 'http://localhost:5173',
  timeoutMs: 5000,
  json: false,
};

function parseArgs(argv) {
  const options = { ...DEFAULTS };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg.startsWith('--api-url=')) {
      options.apiUrl = arg.slice('--api-url='.length);
      continue;
    }

    if (arg.startsWith('--web-url=')) {
      options.webUrl = arg.slice('--web-url='.length);
      continue;
    }

    if (arg.startsWith('--timeout-ms=')) {
      const raw = arg.slice('--timeout-ms='.length);
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --timeout-ms value: ${raw}`);
      }
      options.timeoutMs = parsed;
      continue;
    }
  }

  return options;
}

async function fetchWithTimeout(url, timeoutMs) {
  try {
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          ok: false,
          status: null,
          statusText: null,
          error: `Request timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);
    });

    const fetchPromise = fetch(url).then((response) => ({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      error: null,
    }));

    const result = await Promise.race([fetchPromise, timeoutPromise]);
    return result;
  } catch (error) {
    return {
      ok: false,
      status: null,
      statusText: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatResult(name, result) {
  if (result.ok) {
    return `PASS ${name}: ${result.status}`;
  }

  if (result.error) {
    return `FAIL ${name}: ${result.error}`;
  }

  return `FAIL ${name}: ${result.status} ${result.statusText ?? ''}`.trim();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const checks = [
    {
      name: 'api-health',
      url: `${options.apiUrl.replace(/\/$/, '')}/health`,
    },
    {
      name: 'web-root',
      url: `${options.webUrl.replace(/\/$/, '')}/`,
    },
  ];

  const startedAt = Date.now();
  const results = [];

  for (const check of checks) {
    const result = await fetchWithTimeout(check.url, options.timeoutMs);
    results.push({
      ...check,
      ...result,
    });
  }

  const durationMs = Date.now() - startedAt;
  const success = results.every((result) => result.ok);

  const payload = {
    success,
    durationMs,
    checks: results,
    timestamp: new Date().toISOString(),
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    for (const result of results) {
      process.stdout.write(`${formatResult(result.name, result)}\n`);
    }
    process.stdout.write(`RESULT: ${success ? 'PASS' : 'FAIL'} (${durationMs}ms)\n`);
  }

  process.exitCode = success ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`Unhandled error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
