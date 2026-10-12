/**
 * capability:evidence — run every register row's command and report the verdict.
 *
 * ## Why this exists
 *
 * `CAP-1` records that every register row cites evidence *paths* and none cites a
 * *command*, and that a path can exist while the thing it is evidence for does
 * not work. A path answers "did the file change"; a command answers "does the
 * capability still hold", which is the only question a register is for. The
 * `capability-evidence` skill states the rule this implements: a row may assert
 * `real` only when it names a command whose failure would make it false.
 *
 * ## What it does not do, stated so nobody reads a green run as more than it is
 *
 * It does not flip a row to `unverified` when its command fails. That half of
 * `CAP-1` needs a vocabulary change and a gate of its own — `unverified` is not in
 * `STATUSES` in `scripts/capability-register.mjs`, and adding a status without
 * the mechanism to populate it is the shape of defect this repository keeps
 * recording. So a failing command is reported as a **failure here**, loudly, with
 * the exit code and the row, rather than silently re-classified.
 *
 * A row with no command is reported with that fact rather than counted as a
 * pass: the honest number is "how many `real` rows are decided by something that
 * can fail", and the rest is the debt this script measures rather than closes.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registerPath = path.join(root, 'docs', 'migration', 'capability-register.md');

/**
 * The cell splitter, reused from `scripts/capability-register.mjs` rather than
 * restated — a second parser of the same table is the second-authority defect in
 * miniature, and this repository has recorded that pattern enough times.
 *
 * @param {string} line
 * @returns {string[] | undefined}
 */
function cells(line) {
  if (!line.trimStart().startsWith('|')) return undefined;
  const found = [...line.matchAll(/\|([^|]*)/g)].map((entry) => (entry[1] ?? '').trim());
  return found.length >= 6 ? found : undefined;
}

/**
 * A dotted lowercase capability id, so the header and the vocabulary rows are
 * skipped by the same rule `capability-register.mjs` applies.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isCapabilityId(value) {
  if (value === '') return false;
  return value
    .split('.')
    .every((segment) => segment !== '' && /^[a-z0-9][a-z0-9-]*$/.test(segment));
}

const source = readFileSync(registerPath, 'utf8');
/** @type {{ id: string, status: string, command: string }[]} */
const rows = [];
for (const line of source.split(/\r?\n/)) {
  const cellsOfRow = cells(line);
  if (cellsOfRow === undefined) continue;
  const [id, , rawStatus, , , rawCommand] = cellsOfRow;
  if (id === undefined || !isCapabilityId(id)) continue;
  rows.push({
    id,
    status: (rawStatus ?? '').trim(),
    command: (rawCommand ?? '').trim().replace(/^`|`$/gu, ''),
  });
}

/** @type {{ id: string, status: string, command: string, code: number | null, note: string }[]} */
const results = [];
for (const row of rows) {
  if (row.command === '') {
    results.push({
      ...row,
      code: null,
      note: row.status === 'real' ? 'undecided — no command' : 'no command needed',
    });
    continue;
  }
  const run = spawnSync(row.command, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    timeout: 600_000,
  });
  results.push({
    ...row,
    code: run.status,
    note: run.error ? `could not run: ${run.error.message}` : '',
  });
}

const passed = results.filter((row) => row.code === 0);
const failed = results.filter((row) => row.code !== null && row.code !== 0);
const undecided = results.filter((row) => row.code === null && row.status === 'real');

for (const row of results) {
  const verdict = row.code === 0 ? 'pass' : row.code === null ? '----' : 'FAIL';
  const suffix = row.note === '' ? '' : ` — ${row.note}`;
  console.log(`${verdict}  ${row.id.padEnd(26)} ${row.status.padEnd(10)}${suffix}`);
}
console.log('');
console.log(
  `rows: ${results.length} · commands run: ${passed.length + failed.length} · ` +
    `passed: ${passed.length} · failed: ${failed.length} · ` +
    `real rows with no command: ${undecided.length}`,
);

// A command that fails is a finding, and a finding that only prints is a finding
// nobody acts on. The exit code is the only part of this script a CI job reads.
for (const row of failed) {
  console.error(`${row.id}: its evidence command exited ${row.code}`);
}
if (undecided.length > 0) {
  console.error(
    `${undecided.length} row(s) assert \`real\` with no command that could fail: ` +
      undecided.map((row) => row.id).join(', '),
  );
}
process.exitCode = failed.length > 0 || undecided.length > 0 ? 1 : 0;
