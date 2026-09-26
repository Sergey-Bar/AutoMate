/**
 * Performance gate.
 *
 * The previous version ended its *success* branch in `process.exit(1)`, so the
 * gate failed even when k6 worked — and failed for exactly the wrong reason,
 * which is indistinguishable from a real regression. It also claimed
 * "no synthetic pass is claimed" while exiting non-zero, so neither a pass nor
 * a fail-on-regression was ever possible.
 *
 * The gate now has three honest outcomes and no fourth:
 *   pass            — k6 ran a committed scenario and every threshold held;
 *   fail            — k6 ran and a threshold was breached;
 *   not_configured  — k6 is absent, or no scenario/threshold is committed.
 *
 * `not_configured` exits non-zero. It is a real blocker on the release gate
 * (a performance claim cannot be made without a measurement), and reporting it
 * as a pass would be the same defect as before, one level up.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A committed scenario plus its thresholds. Absent until the P-wave lands. */
const SCENARIO = path.join(root, 'performance', 'smoke.js');
const THRESHOLDS = path.join(root, 'performance', 'thresholds.json');
const BASE_URL = process.env['PERF_BASE_URL'] ?? 'http://127.0.0.1:3000';

/** @returns {string | null} */
function k6Version() {
  try {
    return execFileSync('k6', ['version'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    })
      .trim()
      .split(/\r?\n/)[0];
  } catch {
    return null;
  }
}

const missing = [SCENARIO, THRESHOLDS]
  .filter((file) => !existsSync(file))
  .map((file) => path.relative(root, file));
if (missing.length > 0) {
  console.error('Performance gate: not_configured — no committed scenario to run.');
  for (const file of missing) console.error(`  missing: ${file}`);
  console.error('  A performance number is only meaningful if it comes from a committed scenario.');
  process.exit(1);
}

/**
 * The scenario's own `thresholds` block is the authority, because k6 is what
 * evaluates it and exits 99 on a breach. `thresholds.json` records the same
 * numbers for review. If they ever disagree, the scenario is what ran, so the
 * disagreement is reported rather than silently resolved.
 *
 * This check runs before the k6 probe, so it also runs on a host with no k6 —
 * a threshold that drifted apart from its record is worth reporting even when
 * nothing can execute it.
 */
const scenario = readFileSync(SCENARIO, 'utf8');
const recorded = JSON.parse(readFileSync(THRESHOLDS, 'utf8'));
const expected = [
  `p(95)<${recorded.release.http_req_duration['p(95)']}`,
  `p(99)<${recorded.release.http_req_duration['p(99)']}`,
  `rate<${recorded.release.http_req_failed.rate}`,
];
const missingThresholds = expected.filter((threshold) => !scenario.includes(threshold));
if (missingThresholds.length > 0) {
  console.error(
    'Performance gate failed: performance/smoke.js does not carry the thresholds recorded ' +
      'in performance/thresholds.json.',
  );
  for (const threshold of missingThresholds) console.error(`  not in the scenario: ${threshold}`);
  console.error('  k6 evaluates the scenario, so the scenario is what must hold the real numbers.');
  process.exit(1);
}
console.info(
  `Thresholds agree between performance/smoke.js and performance/thresholds.json: ${expected.join(', ')}`,
);

const version = k6Version();
if (version === null) {
  console.error('Performance gate: not_configured — k6 is not installed.');
  console.error('  The threshold agreement check above did run and passed.');
  console.error('  Install k6, or remove the performance claim from the release gate.');
  process.exit(1);
}
console.info(`k6 available: ${version}`);

const run = spawnSync(
  'k6',
  ['run', '--summary-export', path.join(root, 'var', 'performance-summary.json'), SCENARIO],
  { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, BASE_URL } },
);

// Threshold comparison is the scenario's own job, via k6 `thresholds`; k6 exits
// 99 when a threshold is breached. Anything else non-zero is a run failure.
if (run.status === 0) {
  console.log('Performance gate passed: every committed threshold held.');
  process.exit(0);
}
if (run.status === 99) {
  console.error('Performance gate failed: a committed threshold was breached.');
  process.exit(1);
}
console.error(`Performance gate failed: k6 exited ${String(run.status)}.`);
process.exit(1);
