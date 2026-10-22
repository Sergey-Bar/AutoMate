import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateRegister, runCommands } from './capability-evidence.mjs';

/**
 * `pnpm capability:evidence` decides whether a register row is still backed by
 * something that can fail. Every case below builds a tiny repository in a temporary
 * directory, so each way a row can lose its evidence is proved without touching the
 * real register - and the last block runs the real tree, which is the gate.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = path.join(repoRoot, 'scripts', 'capability-evidence.mjs');

const HEADER =
  '| ID | Capability | Status | Qualification | Evidence | Command | Target phase |\n' +
  '| --- | --- | --- | --- | --- | --- | --- |';

const GOOD_COMMAND = '`pnpm --filter @fx/a exec vitest run src/thing.test.ts`';

/**
 * @param {...string} body
 * @returns {string}
 */
function registerOf(...body) {
  return [`# Capability Register`, '', HEADER, ...body, ''].join('\n');
}

/**
 * @param {{ id?: string, status?: string, qualification?: string, evidence?: string, command?: string, extra?: string }} [row]
 */
function rowOf(row = {}) {
  const {
    id = 'a.thing',
    status = 'real',
    qualification = 'It works.',
    evidence = '`pkgs/a/src/thing.ts`; `pkgs/a/src/thing.test.ts`',
    command = GOOD_COMMAND,
    extra = '',
  } = row;
  return `| ${id} | A thing | ${status} | ${qualification} | ${evidence} | ${command} | 1 |${extra}`;
}

/**
 * A repository with one workspace package holding one source file and its test.
 *
 * @param {{ vitestConfig?: string }} [options]
 */
function fixture(options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'capability-evidence-'));
  /** @param {string} file @param {string} text */
  const put = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  put(
    'package.json',
    JSON.stringify({ name: 'fx', scripts: { gate: 'node gate.mjs', 'docs:check': 'node x.mjs' } }),
  );
  put('pnpm-workspace.yaml', "packages:\n  - 'pkgs/*'\n");
  put(
    'pkgs/a/package.json',
    JSON.stringify({ name: '@fx/a', scripts: { test: 'vitest run', build: 'tsc' } }),
  );
  put(
    'pkgs/a/vitest.config.ts',
    options.vitestConfig ?? "export default { test: { exclude: ['node_modules', 'dist'] } };\n",
  );
  put('pkgs/a/src/thing.ts', 'export const thing = 1;\n');
  put('pkgs/a/src/thing.test.ts', "it('works', () => {});\n");
  return { root, put, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * @param {string} root
 * @param {string} register
 * @param {string} id
 */
function verdictOf(root, register, id) {
  const row = evaluateRegister({ root, registerText: register }).rows.find((r) => r.id === id);
  assert.ok(row, `row ${id} was not parsed`);
  return row;
}

test('an intact row is verified', () => {
  const { root, cleanup } = fixture();
  try {
    const row = verdictOf(root, registerOf(rowOf()), 'a.thing');
    assert.deepEqual(row.reasons, []);
    assert.equal(row.verdict, 'verified');
  } finally {
    cleanup();
  }
});

test('deleting the evidence test flips the row to unverified', () => {
  const { root, cleanup } = fixture();
  try {
    const register = registerOf(rowOf());
    assert.equal(verdictOf(root, register, 'a.thing').verdict, 'verified');

    rmSync(path.join(root, 'pkgs/a/src/thing.test.ts'));

    const row = verdictOf(root, register, 'a.thing');
    assert.equal(row.verdict, 'unverified');
    assert.match(row.reasons.join('\n'), /pkgs\/a\/src\/thing\.test\.ts.*does not exist/);
  } finally {
    cleanup();
  }
});

test('deleting the source file the claim rests on flips the row too', () => {
  const { root, cleanup } = fixture();
  try {
    rmSync(path.join(root, 'pkgs/a/src/thing.ts'));
    const row = verdictOf(root, registerOf(rowOf()), 'a.thing');
    assert.equal(row.verdict, 'unverified');
    assert.match(row.reasons.join('\n'), /pkgs\/a\/src\/thing\.ts.*does not exist/);
  } finally {
    cleanup();
  }
});

test('a row that names no command is unverified', () => {
  const { root, cleanup } = fixture();
  try {
    const row = verdictOf(root, registerOf(rowOf({ command: '' })), 'a.thing');
    assert.equal(row.verdict, 'unverified');
    assert.match(row.reasons.join('\n'), /names no command/);
  } finally {
    cleanup();
  }
});

test('a command that is not a root script is unverified', () => {
  const { root, cleanup } = fixture();
  try {
    const row = verdictOf(root, registerOf(rowOf({ command: '`pnpm no-such-script`' })), 'a.thing');
    assert.equal(row.verdict, 'unverified');
    assert.match(row.reasons.join('\n'), /no-such-script.*not a root script/);
  } finally {
    cleanup();
  }
});

test('a filter naming no workspace package, or a script that package lacks, is unverified', () => {
  const { root, cleanup } = fixture();
  try {
    const noPackage = verdictOf(
      root,
      registerOf(rowOf({ command: '`pnpm --filter @fx/ghost test`' })),
      'a.thing',
    );
    assert.equal(noPackage.verdict, 'unverified');
    assert.match(noPackage.reasons.join('\n'), /@fx\/ghost.*no workspace package/);

    const noScript = verdictOf(
      root,
      registerOf(rowOf({ command: '`pnpm --filter @fx/a lint`' })),
      'a.thing',
    );
    assert.equal(noScript.verdict, 'unverified');
    assert.match(noScript.reasons.join('\n'), /@fx\/a.*has no .lint. script/);
  } finally {
    cleanup();
  }
});

test('a command that targets a test file which is gone is unverified', () => {
  const { root, cleanup } = fixture();
  try {
    const command = '`pnpm --filter @fx/a exec vitest run src/gone.test.ts`';
    const row = verdictOf(root, registerOf(rowOf({ command })), 'a.thing');
    assert.equal(row.verdict, 'unverified');
    assert.match(row.reasons.join('\n'), /pkgs\/a\/src\/gone\.test\.ts.*does not exist/);
  } finally {
    cleanup();
  }
});

test('an evidence test that no test config collects is unverified', () => {
  const { root, cleanup } = fixture({
    vitestConfig: "export default { test: { include: ['elsewhere/**/*.test.ts'] } };\n",
  });
  try {
    const row = verdictOf(root, registerOf(rowOf()), 'a.thing');
    assert.equal(row.verdict, 'unverified');
    assert.match(row.reasons.join('\n'), /thing\.test\.ts.*not collected/);
  } finally {
    cleanup();
  }
});

test('an evidence test excluded by the package config is unverified', () => {
  const { root, cleanup } = fixture({
    vitestConfig: "export default { test: { exclude: ['src/**'] } };\n",
  });
  try {
    const row = verdictOf(root, registerOf(rowOf()), 'a.thing');
    assert.equal(row.verdict, 'unverified');
    assert.match(row.reasons.join('\n'), /thing\.test\.ts.*not collected/);
  } finally {
    cleanup();
  }
});

test('a node:test file is collected when a root script globs it', () => {
  const { root, put, cleanup } = fixture();
  try {
    put(
      'package.json',
      JSON.stringify({ scripts: { gate: 'node --test scripts/lib/*.test.mjs' } }),
    );
    put('scripts/lib/x.test.mjs', '');
    put('scripts/lib/x.mjs', '');
    const row = verdictOf(
      root,
      registerOf(
        rowOf({
          evidence: '`scripts/lib/x.mjs`; `scripts/lib/x.test.mjs`',
          command: '`pnpm gate`',
        }),
      ),
      'a.thing',
    );
    assert.deepEqual(row.reasons, []);

    put('scripts/other/y.test.mjs', '');
    const stray = verdictOf(
      root,
      registerOf(rowOf({ evidence: '`scripts/other/y.test.mjs`', command: '`pnpm gate`' })),
      'a.thing',
    );
    assert.equal(stray.verdict, 'unverified');
    assert.match(stray.reasons.join('\n'), /y\.test\.mjs.*not collected/);
  } finally {
    cleanup();
  }
});

test('a real row that cites no test file is unverified, a deferred one need not', () => {
  const { root, cleanup } = fixture();
  try {
    const evidence = '`pkgs/a/src/thing.ts`';
    const real = verdictOf(root, registerOf(rowOf({ evidence })), 'a.thing');
    assert.equal(real.verdict, 'unverified');
    assert.match(real.reasons.join('\n'), /asserts `real` but cites no test file/);

    const deferred = verdictOf(
      root,
      registerOf(rowOf({ evidence, status: 'deferred' })),
      'a.thing',
    );
    assert.equal(deferred.verdict, 'verified');
  } finally {
    cleanup();
  }
});

test('a real row may rest on a root gate script instead of a test file', () => {
  const { root, cleanup } = fixture();
  try {
    const row = verdictOf(
      root,
      registerOf(rowOf({ evidence: '`package.json`', command: '`pnpm docs:check`' })),
      'a.thing',
    );
    assert.deepEqual(row.reasons, []);
  } finally {
    cleanup();
  }
});

test('a row with more cells than the header is unverified, not silently shifted', () => {
  const { root, cleanup } = fixture();
  try {
    const row = verdictOf(root, registerOf(rowOf({ extra: ' `pnpm docs:check` |' })), 'a.thing');
    assert.equal(row.verdict, 'unverified');
    assert.match(row.reasons.join('\n'), /8 cells.*header has 7/);
  } finally {
    cleanup();
  }
});

test('a path cited in the qualification that does not exist is unverified', () => {
  const { root, cleanup } = fixture();
  try {
    const row = verdictOf(
      root,
      registerOf(rowOf({ qualification: 'Parsed by `pkgs/a/src/vanished.ts`.' })),
      'a.thing',
    );
    assert.equal(row.verdict, 'unverified');
    assert.match(row.reasons.join('\n'), /qualification cites .pkgs\/a\/src\/vanished\.ts/);
  } finally {
    cleanup();
  }
});

test('a register with no Command column leaves every row unverified', () => {
  const { root, cleanup } = fixture();
  try {
    const register = [
      '| ID | Capability | Status | Qualification | Evidence | Target phase |',
      '| --- | --- | --- | --- | --- | --- |',
      '| a.thing | A thing | real | q | `pkgs/a/src/thing.ts`; `pkgs/a/src/thing.test.ts` | 1 |',
    ].join('\n');
    const row = verdictOf(root, register, 'a.thing');
    assert.equal(row.verdict, 'unverified');
    assert.match(row.reasons.join('\n'), /no Command column/);
  } finally {
    cleanup();
  }
});

test('--run mode: a failing command flips the row, a passing one keeps it, and each runs once', () => {
  const { root, cleanup } = fixture();
  try {
    const register = registerOf(
      rowOf({ id: 'a.one' }),
      rowOf({ id: 'a.two' }),
      rowOf({ id: 'a.three', command: '`pnpm docs:check`', evidence: '`package.json`' }),
    );
    const report = evaluateRegister({ root, registerText: register });
    assert.ok(report.rows.every((row) => row.verdict === 'verified'));

    /** @type {string[]} */
    const ran = [];
    const ranReport = runCommands(report, {
      root,
      exec: (command) => {
        ran.push(command);
        return { status: command === 'pnpm docs:check' ? 1 : 0, output: 'boom' };
      },
    });
    assert.deepEqual(ran.sort(), [
      'pnpm --filter @fx/a exec vitest run src/thing.test.ts',
      'pnpm docs:check',
    ]);
    const byId = Object.fromEntries(ranReport.rows.map((row) => [row.id, row]));
    assert.equal(byId['a.one']?.verdict, 'verified');
    assert.equal(byId['a.two']?.verdict, 'verified');
    assert.equal(byId['a.three']?.verdict, 'unverified');
    assert.match(byId['a.three']?.reasons.join('\n') ?? '', /exited 1/);
  } finally {
    cleanup();
  }
});

test('--run mode never executes the commands of a row that already failed statically', () => {
  const { root, cleanup } = fixture();
  try {
    rmSync(path.join(root, 'pkgs/a/src/thing.test.ts'));
    const report = evaluateRegister({ root, registerText: registerOf(rowOf()) });
    /** @type {string[]} */
    const ran = [];
    runCommands(report, {
      root,
      exec: (command) => {
        ran.push(command);
        return { status: 0, output: '' };
      },
    });
    assert.deepEqual(ran, []);
  } finally {
    cleanup();
  }
});

test('the CLI exits 1 on an unverified row and 0 on an intact register', () => {
  const { root, put, cleanup } = fixture();
  try {
    put('register.md', registerOf(rowOf()));
    const args = [cli, '--root', root, '--register', path.join(root, 'register.md')];
    const clean = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    assert.match(clean.stdout, /1 verified, 0 unverified/);

    rmSync(path.join(root, 'pkgs/a/src/thing.test.ts'));
    const broken = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(broken.status, 1);
    assert.match(broken.stdout + broken.stderr, /unverified a\.thing/);
  } finally {
    cleanup();
  }
});

test('the CLI refuses a register with no rows rather than passing on nothing', () => {
  const { root, put, cleanup } = fixture();
  try {
    put('register.md', '# Capability Register\n');
    const result = spawnSync(
      process.execPath,
      [cli, '--root', root, '--register', path.join(root, 'register.md')],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /no register rows/);
  } finally {
    cleanup();
  }
});

// The real tree. This is the gate: a row of the shipped register that loses its
// command, its evidence file, or the collection of its test fails here.
test('every row of the shipped capability register is verified statically', () => {
  const registerText = readFileSync(
    path.join(repoRoot, 'docs', 'migration', 'capability-register.md'),
    'utf8',
  );
  const { rows } = evaluateRegister({ root: repoRoot, registerText });
  assert.ok(rows.length >= 40, `only ${String(rows.length)} rows were parsed`);
  const broken = rows
    .filter((row) => row.verdict !== 'verified')
    .map((row) => `${row.id}: ${row.reasons.join(' | ')}`);
  assert.deepEqual(broken, []);
});
