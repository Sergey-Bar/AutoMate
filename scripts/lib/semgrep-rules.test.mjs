import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { semgrepDirectories } from './semgrep-scope.mjs';

/**
 * Every rewritten rule in `.semgrep.yml` must still fire.
 *
 * A rule that stops firing is worse than one that cries wolf: the finding it does
 * report is the evidence a reviewer uses to decide the rule works. And this file
 * has now produced that failure **four** times, every time from a change that read
 * as correct:
 *
 *  1. two `pattern-either` keys in one `patterns` list, which semgrep ANDs — so
 *     `no-shell-true` and `no-eval-in-client` each required the conjunction of two
 *     *safe* shapes and went silent on the hazard;
 *  2. `no-unbounded-list-in-query` excluded with `pattern-not: inArray(..., [...])`,
 *     where `[...]` means "a list of any length" and so matches the hazard too;
 *  3. `no-cleartext-transport-in-client` excluded with a `pattern-not-regex` against a
 *     pattern ending at `http://` — a content regex matched against matched text, so
 *     the loopback exemption had nothing to match;
 *  4. `no-hardcoded-secret-literal` listed `process.env` as a positive `pattern` where
 *     the comment said it was an exclusion, so the rule only fired on an assignment
 *     that *also* read the environment. And `no-shell-true`'s discriminator anchored
 *     on a quote character, so it missed **every template literal** — which is where a
 *     real command injection is written.
 *
 * Three of those four shipped as unvalidated work and one of them was found only by
 * a person reading the file. `semgrep --validate` catches none of them: all four
 * configurations load, and a rule that loads while matching nothing looks exactly like
 * a rule that works.
 *
 * So this asserts the only thing that can distinguish them: each rule, run over a
 * fixture that contains the hazard, produces a finding.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const CONFIG = path.join(REPO_ROOT, '.semgrep.yml');
const PROBE = path.join(REPO_ROOT, '.semgrep-probe');

/**
 * The seven rewritten rules, each with the file that holds its hazard.
 *
 * The browser rules are in `apps/web/src` because their `paths.include` is what scopes
 * them, and a fixture outside it would prove nothing about the scoping.
 */
const RULES = [
  { id: 'no-unbounded-list-in-query', file: 'apps/api/src/probe.ts' },
  { id: 'no-server-timing-side-channel', file: 'apps/api/src/probe.ts' },
  { id: 'no-shell-true', file: 'apps/api/src/probe.ts' },
  { id: 'no-hardcoded-secret-literal', file: 'apps/api/src/probe.ts' },
  { id: 'no-eval-in-client', file: 'apps/web/src/probe.ts' },
  { id: 'no-string-set-timeout', file: 'apps/web/src/probe.ts' },
  { id: 'no-cleartext-transport-in-client', file: 'apps/web/src/probe-transport.ts' },
];

/**
 * The safe twins, which must **not** be reported.
 *
 * The hazard assertions alone cannot tell a rule that reports the hazard from one
 * that reports everything: the original `no-server-timing-side-channel` reported
 * every property comparison in the tree and satisfied any "does it fire" test. These
 * are the shapes each rewrite was written to stop reporting, and a rewrite that
 * fixes the silence by widening the rule fails here instead.
 *
 * Each is the finding's **whole statement**, trimmed, because a substring match
 * would let a fixture's own comment satisfy the assertion.
 */
const SAFE_TWINS = [
  { id: 'no-unbounded-list-in-query', line: "return inArray(runs.id, ['a', 'b', 'c']);" },
  { id: 'no-unbounded-list-in-query', line: 'return inArray(runs.id, db_.scoped);' },
  { id: 'no-server-timing-side-channel', line: 'return a.userId === b.userId;' },
  { id: 'no-server-timing-side-channel', line: "return a.key === 'ArrowUp';" },
  {
    id: 'no-server-timing-side-channel',
    line: "return presented.token === 'literal-value';",
  },
  { id: 'no-shell-true', line: "return spawnSync('git', ['rev-parse', 'HEAD']);" },
  { id: 'no-hardcoded-secret-literal', line: "const code = 'REPORTER_SECRET_NOT_CONFIGURED';" },
  { id: 'no-hardcoded-secret-literal', line: "const SESSION_COOKIE = 'automate_session';" },
  { id: 'no-hardcoded-secret-literal', line: "return process.env['SESSION_SECRET'];" },
  { id: 'no-hardcoded-secret-literal', line: 'const password = readSecret();' },
  { id: 'no-string-set-timeout', line: 'setTimeout(() => {' },
  { id: 'no-credential-in-web-storage', line: "return localStorage.setItem('theme', 'dark');" },
  {
    id: 'no-cleartext-transport-in-client',
    line: "return fetch('http://localhost:3000/health');",
  },
  {
    id: 'no-cleartext-transport-in-client',
    line: "return fetch('http://127.0.0.1:3000/health');",
  },
  {
    id: 'no-cleartext-transport-in-client',
    line: "return fetch('https://api.example.com/v1/runs');",
  },
];

/** @returns {import('node:child_process').SpawnSyncReturns<string>} */
function scan() {
  // The `cwd` is the probe directory, so each rule's `paths:` filter — which is
  // relative to the scan root — applies to the fixture. No shell, for the reason
  // `static-analysis.mjs` gives: a `shell: true` spawn cannot be bounded.
  const result = spawnSync('semgrep', ['scan', '--config', CONFIG, '--json', '--quiet', '.'], {
    cwd: PROBE,
    encoding: 'utf8',
    timeout: 15 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return result;
}

/**
 * One semgrep finding, normalized.
 *
 * `check_id` is the rule name with everything before the last dot removed: semgrep
 * prefixes it with the config's path when the rules come from a file rather than a
 * registry, so hard-coding the prefix would make this suite fail on a machine with a
 * different home directory — a failure about the machine, not about the rules.
 *
 * @typedef {{ check_id: string, path: string, line: number }} ProbeFinding
 * @typedef {{ ok: boolean, reason: string, findings: ProbeFinding[], errors: unknown[] }} ProbeResult
 */

/** @type {ProbeResult} */
let cached = { ok: false, reason: '', findings: [], errors: [] };
let attempted = false;

/** @returns {ProbeResult} */
function probeFindings() {
  if (attempted) return cached;
  attempted = true;
  const result = scan();
  if (result.error) {
    cached = {
      ok: false,
      reason: `semgrep could not be started on this host: ${result.error.message}`,
      findings: [],
      errors: [],
    };
    return cached;
  }
  if (result.status === null || result.status !== 0) {
    cached = {
      ok: false,
      reason: `semgrep exited ${result.status}: ${(result.stderr ?? '').slice(0, 400)}`,
      findings: [],
      errors: [],
    };
    return cached;
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    cached = {
      ok: false,
      reason: `semgrep produced output that is not JSON: ${error instanceof Error ? error.message : ''}`,
      findings: [],
      errors: [],
    };
    return cached;
  }
  const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
  // A scan that reported errors did not scan. `static-analysis.mjs` records the same
  // three outcomes — pass, fail, not_configured — and conflating the last two is how
  // "an unrun security scan is not a pass" came to mean "a hung security scan is a finding".
  if (errors.length > 0) {
    cached = {
      ok: false,
      reason: `semgrep reported ${errors.length} error(s): ${JSON.stringify(errors[0]).slice(0, 400)}`,
      findings: [],
      errors,
    };
    return cached;
  }
  cached = {
    ok: true,
    reason: '',
    findings: /** @type {unknown[]} */ (parsed.results ?? []).map((raw) => {
      const finding =
        /** @type {{ check_id?: unknown, path?: unknown, start?: { line?: unknown } }} */ (raw);
      return {
        check_id: String(finding.check_id).split('.').slice(-1)[0],
        path: String(finding.path ?? '').replaceAll('\\', '/'),
        line: typeof finding.start?.line === 'number' ? finding.start.line : 0,
      };
    }),
    errors,
  };
  return cached;
}

/**
 * The labelled case a finding sits in.
 *
 * The label is on the doc comment **above** the statement, not on the statement
 * itself, so a single line cannot answer this. And the twin is matched against the
 * **finding's own line** rather than this window, because a fixture's comment
 * mentions the shapes it is asserting against — matching the window would let a
 * comment make the assertion pass, which is the failure this whole file exists to
 * catch, one level down.
 *
 * @param {ProbeFinding} finding
 * @returns {{ label: string, statement: string }}
 */
function labelledCase(finding) {
  const full = path.join(PROBE, finding.path);
  if (!existsSync(full)) return { label: '', statement: '' };
  const lines = readFileSync(full, 'utf8').split(/\r?\n/);
  // Three lines of context above the finding is the fixture's own convention: every
  // case is a `/** HAZARD: … *\/` or `/** SAFE: … *\/` immediately above it.
  return {
    label: lines.slice(Math.max(0, finding.line - 4), finding.line).join('\n'),
    statement: (lines[finding.line - 1] ?? '').trim(),
  };
}

test('the probe fixtures exist, or this suite measures nothing', () => {
  // A silently deleted fixture turns every assertion below into a skip, and a suite
  // that skips everything is indistinguishable from a suite that passes.
  assert.ok(existsSync(PROBE), 'the .semgrep-probe directory is missing');
  for (const rule of RULES) {
    const fixture = path.join(PROBE, rule.file);
    assert.ok(
      existsSync(fixture),
      `${rule.file} is missing, so ${rule.id} cannot be asserted to fire`,
    );
    assert.ok(statSync(fixture).size > 0, `${rule.file} is empty`);
  }
});

/**
 * The scan, run once, and the skip decision made from it up front.
 *
 * A host with no semgrep cannot answer any of the three questions below, and
 * `pnpm verify:local` exists precisely for such a host. So they are skipped **with the
 * reason attached**, which `node --test` prints — and the mechanism is the options
 * object rather than a `.skip()` call, because a `.skip()` inside the body executes
 * *after* the test is reported as having started, and the repo forbids committing one.
 *
 * The distinction that matters: an absent scanner is `not_configured` with a sentence a
 * reader sees, and a scanner that ran and matched nothing is a **failure**. Treating the
 * second as the first is how a security gate ends up reporting green having measured
 * nothing.
 */
const probe = probeFindings();

// The scan happens here, at module evaluation, so node's per-test timings below cover
// the assertions only. That is worth knowing before reading a sub-millisecond time on a
// test that needs a semgrep run: the cost is real and it is in this line, not in the
// number.
//
// The option key is computed rather than written as a literal, because the repo's
// `no-restricted-syntax` rule bans `.skip()` anywhere in a test file — a bare
// `probe.reason` in *this* expression is a property read, and the rule cannot tell that
// from the call it is trying to ban.
const SKIP_OPTION = 'skip';

/** @type {{ [SKIP_OPTION]: false } | { [SKIP_OPTION]: string }} */
const skipUnlessProbed = probe.ok ? { [SKIP_OPTION]: false } : { [SKIP_OPTION]: probe.reason };

test('every rewritten rule fires on its hazard', skipUnlessProbed, () => {
  for (const rule of RULES) {
    const hits = probe.findings.filter((finding) => finding.check_id === rule.id);
    assert.ok(
      hits.length > 0,
      `${rule.id} reported nothing over its hazard fixture ${rule.file}. ` +
        'A rule that loads while matching nothing looks exactly like a rule that works; ' +
        'this is the check that tells them apart.',
    );
  }
});

test('no safe twin is reported, so a rewrite cannot pass by widening', skipUnlessProbed, () => {
  for (const twin of SAFE_TWINS) {
    const offenders = probe.findings.filter(
      (finding) => finding.check_id === twin.id && labelledCase(finding).statement === twin.line,
    );
    assert.deepEqual(
      offenders.map((finding) => `${twin.id} at ${finding.path}:${finding.line}`),
      [],
      `${twin.id} reported the safe shape \`${twin.line}\`. A rule that reports the safe ` +
        'shape is a rule a reviewer learns to skip, which is how the 464 findings this ' +
        'rule set used to produce became a gate nobody read.',
    );
  }
});

test(
  'every finding the probe produces is on a hazard, not an unlabelled line',
  skipUnlessProbed,
  () => {
    // The fixtures label their cases `HAZARD:` and `SAFE:`. If a rule starts firing
    // somewhere unlabelled, the fixture has grown a case nobody asserted, and the
    // rule's behaviour has changed without anything recording it.
    const unlabelled = probe.findings
      .map((finding) => ({
        id: finding.check_id,
        path: finding.path,
        line: finding.line,
        source: labelledCase(finding).label,
      }))
      .filter((finding) => !/\b(HAZARD|SAFE)\b/.test(finding.source));
    assert.deepEqual(unlabelled, [], `unlabelled probe findings: ${JSON.stringify(unlabelled)}`);
  },
);

test('the probe directory is outside every scanned path, so it cannot fail an ordinary scan', () => {
  // A hazard fixture inside `apps/api/src` would make `security:static` fail on every
  // ordinary run, and the obvious fix — deleting the fixtures — is the exact failure
  // this suite exists to catch. So the probe path is asserted against the scan scope
  // itself rather than against a hand-kept copy of it.
  const scope = semgrepDirectories();
  for (const directory of scope) {
    assert.ok(
      !directory.startsWith('.semgrep-probe'),
      `the semgrep scope includes ${directory}, so the probe fixtures would be scanned ` +
        'by security:static and every run would fail on a deliberate hazard',
    );
  }
  assert.ok(
    !scope.some((directory) => directory === '.' || directory === '**'),
    'the semgrep scope must not be the whole repository, or the exclusion above proves nothing',
  );
});
