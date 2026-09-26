import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The capability register is the repository's most valuable document, and it is
 * hand-maintained — so it drifted. Five rows cited `apps/api/src/modules/…`
 * paths that do not exist, and a reader had no way to know: the register looked
 * authoritative at every glance.
 *
 * `scripts/capability-register.mjs` checks the half that can be checked
 * mechanically — every cited path, every status against the documented
 * vocabulary, the baseline commit — and refuses to guess the other half, because
 * whether a capability is `real` needs someone who knows what the code is for.
 *
 * Each case runs against a *synthetic* register in a temporary directory, so
 * every failure mode is proved without touching the real document.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(repoRoot, 'scripts', 'capability-register.mjs');

const HEADER = [
  '# Capability Register',
  '',
  '**Baseline:** `not-a-commit`',
  '',
  '| ID | Capability | Status | Qualification | Evidence | Target phase |',
  '| --- | --- | --- | --- | --- | --- |',
].join('\n');

/** @type {Array<{name: string, register: string, expectFailure: RegExp}>} */
const CASES = [
  {
    name: 'rejects a citation that does not exist',
    register: [HEADER, '| a.b | A thing | real | qualified | `does/not/exist.ts` | 1 |'].join('\n'),
    expectFailure: /does not exist/,
  },
  {
    name: 'rejects a status outside the documented vocabulary',
    register: [
      HEADER,
      '| a.b | A thing | green | qualified | `scripts/capability-register.mjs` | 1 |',
    ].join('\n'),
    expectFailure: /not one of/,
  },
  {
    name: 'rejects a table that parses to no rows at all',
    register: HEADER,
    expectFailure: /no register rows were parsed/,
  },
  {
    name: 'ignores the header and separator rows',
    // The header's `ID` and the separator's dashes parse with exactly the same
    // shape as a data row. Treating either as a capability produced two phantom
    // failures the first time the script ran.
    register: HEADER,
    expectFailure: /no register rows were parsed/,
  },
];

/**
 * Runs the script against a fixture, so a test can prove each failure mode
 * without mutating the real document.
 *
 * @param {string} registerPath
 * @returns {{stdout: string, stderr: string}}
 */
function check(registerPath) {
  const result = spawnSync(process.execPath, [script, '--register', registerPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

describe('the capability-register check', () => {
  it('accepts the register that is actually in the repository', () => {
    const result = spawnSync(process.execPath, [script], { cwd: repoRoot, encoding: 'utf8' });
    expect(result.stdout, result.stderr).toContain('Capability register verified');
  });

  it('fails, with a reason, for every kind of drift', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'automate-register-'));
    try {
      const file = path.join(directory, 'register.md');
      for (const testCase of CASES) {
        writeFileSync(file, testCase.register, 'utf8');
        const { stdout, stderr } = check(file);
        expect(`${testCase.name}: ${stdout}${stderr}`).toMatch(testCase.expectFailure);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports a real commit as the baseline, and refuses one that is not', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'automate-register-'));
    try {
      const file = path.join(directory, 'register.md');
      const head = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }).stdout.trim();
      writeFileSync(
        file,
        [
          '# Capability Register',
          '',
          `**Baseline:** \`${head}\``,
          '',
          '| ID | Capability | Status | Qualification | Evidence | Target phase |',
          '| --- | --- | --- | --- | --- | --- |',
          '| a.b | A thing | real | qualified | `scripts/capability-register.mjs` | 1 |',
        ].join('\n'),
        'utf8',
      );
      expect(check(file).stdout).toContain('Capability register verified');

      // …and a hash this repository has never heard of is a failure, because a
      // baseline that cannot be resolved is a baseline nobody can trust.
      writeFileSync(file, readFileSync(file, 'utf8').replace(head, '0'.repeat(40)), 'utf8');
      expect(check(file).stdout + check(file).stderr).toMatch(/is not a commit/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('can refresh the baseline, and says so', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'automate-register-'));
    try {
      const file = path.join(directory, 'register.md');
      const head = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }).stdout.trim();
      writeFileSync(file, '# Capability Register\n\n**Baseline:** `HEAD`\n', 'utf8');
      const result = spawnSync(
        process.execPath,
        [script, '--register', file, '--update-baseline'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
        },
      );
      expect(result.stdout).toContain('baseline updated');
      expect(readFileSync(file, 'utf8')).toContain(head);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
