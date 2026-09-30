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
 * Each call is a `spawnSync` of a whole Node process. The count matters: this file
 * is the only thing in the contract suite that shells out, so its runtime is
 * entirely process-spawn cost, and every extra spawn is a step closer to the
 * per-test timeout below. Call it once per assertion and reuse the result.
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

/**
 * How long a test that only spawns Node may take.
 *
 * This is the flake the plan called "a full suite reporting 1 failed / 1495 passed
 * once in nine runs, unidentifiable", and it is identified: this file took 1.14 s
 * run on its own and 15.13 s under `pnpm test`, where 30-odd packages run in
 * parallel — and the slowest case here, `reports a real commit as the baseline`,
 * crossed 5 000 ms at 6 668 ms and failed with `Test timed out in 5000ms`. The
 * assertions had all passed; the *harness* ran out of budget, which is a fact
 * about the machine's load and not about the code.
 *
 * So the budget is stated rather than left implicit, and the duplicated spawn in
 * that case is gone: it used to call `check(file)` twice for one assertion, which
 * doubled the cost of the slowest test in the file for no added evidence.
 */
const SPAWNING_TIMEOUT_MS = 60_000;

describe('the capability-register check', () => {
  it(
    'accepts the register that is actually in the repository',
    () => {
      const result = spawnSync(process.execPath, [script], { cwd: repoRoot, encoding: 'utf8' });
      // The verdict follows the baseline, and on CI the baseline cannot be checked: CI
      // clones depth 1, so the registered baseline commit — which predates `HEAD` — is
      // not in the object database. `git cat-file` cannot tell that from a forged hash,
      // so the run reports *not checked* with the reason, and this assertion has to
      // accept either.
      //
      // Requiring "verified" here would be a test that passes only on a full clone and
      // fails on every runner, which is the shape of defect this repository has been
      // fixing all session: a check that works on the machine that wrote it.
      const shallow =
        spawnSync('git', ['rev-parse', '--is-shallow-repository'], {
          cwd: repoRoot,
          encoding: 'utf8',
        }).stdout.trim() === 'true';
      if (shallow) {
        expect(result.stdout, result.stderr).toContain('NOT fully verified');
        expect(result.stdout, result.stderr).toContain('clone is shallow');
      } else {
        expect(result.stdout, result.stderr).toContain('Capability register verified');
      }
    },
    SPAWNING_TIMEOUT_MS,
  );

  it(
    'fails, with a reason, for every kind of drift',
    () => {
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
    },
    SPAWNING_TIMEOUT_MS,
  );

  it(
    'reports a real commit as the baseline, and refuses one that is not',
    () => {
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

        // …and a hash this repository has never heard of is refused, because a baseline
        // that cannot be resolved is a baseline nobody can trust.
        //
        // **Two answers, both refusals, and the clone decides which.** `git cat-file`
        // cannot tell a forged hash from a real commit that a shallow clone never
        // fetched, so `capability-register.mjs` now reports the second as *not checked*
        // with the reason printed — which is the honest answer on CI, where the clone is
        // depth 1 and every baseline but `HEAD` is unfetched. This test asserts both
        // shapes, so the falsifiability proof survives either: a check that only failed
        // on a full clone would be a check that reported nothing on every runner.
        writeFileSync(file, readFileSync(file, 'utf8').replace(head, '0'.repeat(40)), 'utf8');
        const forged = check(file);
        const output = forged.stdout + forged.stderr;
        const shallow =
          spawnSync('git', ['rev-parse', '--is-shallow-repository'], {
            cwd: repoRoot,
            encoding: 'utf8',
          }).stdout.trim() === 'true';
        if (shallow) {
          expect(output).toMatch(/clone is shallow/);
          expect(output).toMatch(/not checked/);
        } else {
          expect(output).toMatch(/is not a commit/);
        }
        // Either way the run must not claim the register is verified.
        expect(output).not.toContain('Capability register verified');
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    SPAWNING_TIMEOUT_MS,
  );

  it(
    'can refresh the baseline, and says so',
    () => {
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
    },
    SPAWNING_TIMEOUT_MS,
  );
});
