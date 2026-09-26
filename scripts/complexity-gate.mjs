import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The `sonarjs/cognitive-complexity` ratchet.
 *
 * The rule is **off** in `eslint.config.js` today, deliberately: 31 existing
 * functions exceed the ceiling, the worst at 75 and 71 in the two largest files,
 * and a permanently red lint gate gets switched off — taking the two rules that
 * do pass with it. This script is the ratchet: it fails when the count of
 * offenders **grows**, records the current offenders for review, and the ceiling
 * becomes a hard ESLint error as part of the Q0.14 split.
 *
 * Run with `--write` to re-record the baseline after an intentional refactor.
 */
const root = 'C:/VS-Code-Projects/Github/Automate';
const target = path.join(root, 'docs', 'quality', 'complexity-baseline.json');
const eslintBin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
const write = process.argv.includes('--write');

/**
 * The ceiling, overridable on the command line so the first run needs no file.
 *
 * @param {string[]} argv
 * @returns {number}
 */
function ceilingFrom(argv) {
  const flag = argv.indexOf('--ceiling');
  if (flag !== -1 && argv[flag + 1] !== undefined) return Number(argv[flag + 1]);
  return 15;
}

if (!write && !existsSync(target)) {
  console.error(
    `Complexity baseline missing: ${path.relative(root, target)}. ` +
      'Run `pnpm complexity:baseline` to record it.',
  );
  process.exit(1);
}
const baseline = existsSync(target)
  ? JSON.parse(readFileSync(target, 'utf8'))
  : { ceiling: ceilingFrom(process.argv), count: 0, offenders: [] };
const ceiling = baseline.ceiling;

const run = spawnSync(
  process.execPath,
  [
    eslintBin,
    'apps',
    'packages',
    'tools',
    'tests',
    'scripts',
    '--rule',
    JSON.stringify({ 'sonarjs/cognitive-complexity': ['error', ceiling] }),
    '-f',
    'json',
  ],
  { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
);

// ESLint exits 1 when it reports errors, which is the expected case here: the
// whole point is to count them.
if (run.stdout === undefined || run.stdout.trim() === '') {
  console.error('Complexity ratchet: eslint produced no report');
  console.error(run.stderr ?? '');
  process.exit(1);
}

const results = JSON.parse(run.stdout);
/** @type {Array<{file: string, line: number, complexity: number | null}>} */
const offenders = [];
for (const result of results) {
  const relative = path.relative(root, result.filePath).replaceAll('\\', '/');
  for (const message of result.messages) {
    if (!(message.ruleId ?? '').startsWith('sonarjs/cognitive-complexity')) continue;
    const match = /from (\d+) to the \d+ allowed/.exec(message.message);
    offenders.push({
      file: relative,
      line: message.line,
      complexity: match ? Number(match[1]) : null,
    });
  }
}
offenders.sort((left, right) => (right.complexity ?? 0) - (left.complexity ?? 0));

if (write) {
  const updated = {
    ...baseline,
    measuredAt: new Date().toISOString().slice(0, 10),
    count: offenders.length,
    worst: offenders[0]?.complexity ?? 0,
    offenders,
  };
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(updated, null, 2)}\n`);
  console.log(
    `Complexity baseline re-recorded: ${offenders.length} offender(s), worst ${updated.worst}.`,
  );
  process.exit(0);
}

// Counted **per file**, not per file+line.
//
// Keying by line made every edit *above* a long function look like new
// complexity: a function that had not changed at all was reported as "new"
// because something earlier in the file grew. The ratchet therefore reported
// growth on nearly any change to those files — wrong rather than noisy, which
// is the worse failure for a gate nobody can trust.
const offendersByFile = new Map();
for (const row of offenders) {
  offendersByFile.set(row.file, (offendersByFile.get(row.file) ?? 0) + 1);
}
const recordedFiles = new Map();
for (const row of baseline.offenders) {
  recordedFiles.set(row.file, (recordedFiles.get(row.file) ?? 0) + 1);
}

if (offendersByFile.size > recordedFiles.size) {
  console.error('Complexity ratchet failed');
  console.error(
    `  ${offendersByFile.size} file(s) now contain a function over a cognitive ` +
      `complexity of ${ceiling}; the recorded baseline is ${recordedFiles.size}.`,
  );
  for (const [file, count] of [...offendersByFile.entries()].filter(
    ([name, total]) => total > (recordedFiles.get(name) ?? 0),
  )) {
    console.error(`  grew: ${file}: ${recordedFiles.get(file) ?? 0} -> ${count}`);
  }
  console.error('  Refactor, or run `pnpm complexity:baseline` if the increase is intentional.');
  process.exit(1);
}

console.log(
  `Complexity ratchet passed: ${offenders.length} function(s) over ${ceiling}, ` +
    `baseline ${baseline.count}, worst ${offenders[0]?.complexity ?? 0}.`,
);
