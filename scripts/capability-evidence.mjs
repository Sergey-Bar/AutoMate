import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateRegister, runCommands } from './lib/capability-evidence.mjs';

/**
 * `pnpm capability:evidence` - derives each capability register row's evidence verdict.
 *
 *   (default)  static: every row names a command that resolves, every path it cites
 *              exists, every test it cites is collected by a runner. Needs no tool, no
 *              database and no network, so it is cheap enough for every pull request.
 *   --run      also executes each row's command (once per distinct command). Slow;
 *              meant for a person or the nightly lane, not for a pull request.
 *   --json     machine-readable report.
 *   --root <dir> / --register <path>   check a fixture instead of this repository.
 *
 * Exits 1 when any row is `unverified`, or when no row could be read - a check that
 * measured nothing is not a pass.
 */

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} flag @returns {string | undefined} */
function flagValue(flag) {
  const at = process.argv.indexOf(flag);
  return at === -1 ? undefined : process.argv[at + 1];
}

const root = path.resolve(flagValue('--root') ?? defaultRoot);
const registerPath =
  flagValue('--register') ?? path.join(root, 'docs', 'migration', 'capability-register.md');
const execute = process.argv.includes('--run');

let report = evaluateRegister({ root, registerText: readFileSync(registerPath, 'utf8') });
if (report.rows.length === 0) {
  console.error('capability:evidence: no register rows were parsed - the table shape changed');
  process.exit(1);
}
if (execute) report = runCommands(report, { root });

const unverified = report.rows.filter((row) => row.verdict !== 'verified');

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ mode: execute ? 'run' : 'static', ...report }, null, 2));
} else {
  for (const row of unverified) {
    console.error(`unverified ${row.id} (asserts \`${row.status}\`)`);
    for (const reason of row.reasons) console.error(`  - ${reason}`);
  }
  const verified = report.rows.length - unverified.length;
  console.log(
    `capability:evidence (${execute ? 'commands executed' : 'static'}): ` +
      `${String(report.rows.length)} row(s), ${String(verified)} verified, ${String(unverified.length)} unverified.` +
      (execute ? '' : ' Commands were resolved, not run; `--run` executes them.'),
  );
}
process.exit(unverified.length === 0 ? 0 : 1);
