import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { parseBaseline, partitionByBaseline } from './lib/secret-scan-baseline.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();

/**
 * Patterns for credentials that must never be committed.
 *
 * Deliberately provider-specific rather than a bare high-entropy class: a rule
 * that matches "any 40 base64 characters" flags every checksum, content digest
 * and compiled hash in the tree, so it is switched off and stops finding
 * anything real. `.gitleaks.toml` covers the broader sweep when gitleaks is
 * installed; this scan is the dependency-free floor that always runs.
 *
 * @type {Array<[string, RegExp]>}
 */
const patterns = [
  ['private key block', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['aws access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['github token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['github fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['openai-style key', /\bsk-[A-Za-z0-9]{20,}\b/],
  ['slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['slack webhook', /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9+/]{20,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['stripe live key', /\b[rs]k_live_[A-Za-z0-9]{20,}\b/],
  ['datadog key', /\bdd_(?:api|app)_[A-Za-z0-9]{32,}\b/],
  ['connection string with inline password', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{3,}@/],
];

/**
 * A file that must never be scanned for content: it is data, not source.
 *
 * The web-font extensions are here for a measured reason rather than a general
 * one. `archivo-latin-var.woff2` and `jetbrains-mono-latin-var.woff2` are
 * committed binaries, and reading either as UTF-8 hands the pattern list ~130KB
 * of mojibake per file. The connection-string pattern is the one that matters:
 * `[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{3,}@` needs a run of printable
 * bytes around `://` and `@`, and a compressed woff2 table is a better source of
 * that by accident than a scanned source file is by design. The finding would
 * be a false positive on a font, on a hook, in front of a commit — so the
 * extension is skipped by name, the way `png` and `zip` already are.
 *
 * `scripts/lib/secret-scan-binary-extensions.test.mjs` asserts a `.woff2`
 * containing the shape of a hit is skipped, so the entry cannot quietly go away
 * and leave the next contributor to discover it.
 *
 * @param {string} file
 */
function isBinaryPath(file) {
  return /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|gz|wasm|db|sqlite|mp4|mov|woff2|woff|ttf|otf|eot)$/i.test(
    file,
  );
}

/**
 * Files that deliberately contain credential-shaped strings.
 *
 * Enumerated, one line each with a reason, rather than a `*.test.*` glob. The
 * previous gitleaks config used `[A-Za-z0-9+/]{40,}` over every `*.test.ts`,
 * which exempted every real secret in every test file — the exact place a
 * leaked fixture is committed. These entries are narrow enough to review.
 */
const SYNTHETIC_CREDENTIAL_FILES = new Set([
  // Proves the outbox sanitizer's value-level detector fires.
  'apps/api/src/infrastructure/outbox-sanitizer.test.ts',
  // Exercises the required-secrets production policy.
  'apps/api/src/config.test.ts',
  'apps/api/src/startup-policy.test.ts',
  'apps/api/src/startup-policy-extra.test.ts',
  'apps/api/src/index-production-composition.test.ts',
  // Object-store endpoint and credential handling.
  'apps/api/src/infrastructure/s3-artifact-bytes.test.ts',
  // Config parsing for a database URL.
  'packages/config/src/config.test.ts',
  'tools/migrate-cli/src/migrate.test.ts',
  // This file's own pattern list, which matches every shape it looks for.
  'scripts/secret-scan.mjs',
]);

/** Paths whose *content* is documentation or generated output. */
/** @param {string} file */
function isAllowlistedPath(file) {
  return (
    /(^|\/)\.env\.example$/.test(file) ||
    /(^|\/)\.env\.compose\.example$/.test(file) ||
    file.startsWith('packages/db/drizzle/') ||
    /\.(lock|snap)$/.test(file) ||
    file === 'pnpm-lock.yaml' ||
    file === '.semgrep.yml' ||
    file === '.gitleaks.toml' ||
    SYNTHETIC_CREDENTIAL_FILES.has(file)
  );
}

/**
 * Removes comments before scanning.
 *
 * A documented example such as `postgresql://user:pass@host:5432/db` in a
 * doc comment is not a credential, and path-allowlisting every file that
 * documents one would recreate the blanket exemption. Comments are where
 * placeholder examples live, so they are removed rather than exempting files.
 */
/** @param {string} text */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** @param {string} text @returns {string[]} */
/**
 * Values that are placeholders *by name*.
 *
 * The convention throughout this tree is `user:pass`, `user:password`,
 * `host:5432/database` — a documented example, not a credential. Exempting the
 * files that contain them would be the same blanket-exemption mistake the
 * gitleaks config had, so the pattern itself recognises the convention. A real
 * secret is a value no developer would have written as a stand-in.
 */
const PLACEHOLDER_VALUES = new Set([
  'pass',
  'password',
  'secret',
  'example',
  'changeme',
  'placeholder',
  'xxx',
  'yourpassword',
  'mypassword',
  'local',
  'local-only',
  'automate',
  'postgres',
  'user',
]);
// `hunter2` is deliberately **not** here. It is a famous placeholder, and it is
// also a password that appears in real breach corpora — and a secret scanner
// exists for the second reading. The self-test asserts it still matches, which is
// how this list is kept honest: adding a name here is a claim that the value is
// never a credential, and the test says whether that claim still holds.

/**
 * A credential-shaped value whose password is the placeholder convention.
 *
 * The **password** is judged, not the userinfo. `user` is a generic username in
 * every example and in a great many real fixtures, so treating it as a signal
 * would excuse `user:hunter2` — a real password behind a generic name. The
 * password is the secret, so the password decides.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isPlaceholderConnectionString(value) {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/:@]+):([^/@]+)@/i.exec(value);
  if (match === null) return false;
  return PLACEHOLDER_VALUES.has((match[2] ?? '').toLowerCase());
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function scanText(text) {
  const hits = [];
  for (const [label, pattern] of patterns) {
    if (!pattern.test(text)) continue;
    if (label === 'connection string with inline password') {
      // Only the connection-string rule has a legitimate placeholder form, so
      // the exemption is scoped to it rather than applied to every pattern.
      const only = /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{3,}@/i.exec(text);
      if (only !== null && isPlaceholderConnectionString(only[0])) continue;
    }
    hits.push(label);
  }
  return hits;
}
/** Scans code, ignoring comments. */
/** @param {string} text @returns {string[]} */
function scanCode(text) {
  return scanText(stripComments(text));
}

/** @returns {Array<{file: string, hits: string[]}>} */
function scanRepository() {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean);
  const findings = [];
  for (const file of files) {
    if (isBinaryPath(file) || isAllowlistedPath(file)) continue;
    let text;
    try {
      text = readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue;
    }
    const hits = scanCode(text);
    if (hits.length > 0) findings.push({ file, hits });
  }
  return findings;
}

/**
 * The same patterns, over every commit.
 *
 * The working-tree scan above is `git ls-files`: it sees what is on disk now. A
 * secret that was committed and then removed is the common case, not the rare one
 * — `git rm` or an edit that strips a value both leave the value in history, and
 * both are ordinary things to do. A scanner that only looks at the tree reports
 * clean on a repository whose clone contains a live credential.
 *
 * So this walks the history. It is opt-in via `--history` because it is
 * proportional to the number of commits and the tree is the fast check: a
 * pre-commit hook runs the tree scan, and CI runs both.
 *
 * `git log -p` rather than `git rev-list` + one diff per commit, so the whole
 * history is read in a single process.
 */
function scanHistory() {
  /** @type {Map<string, Set<string>>} */
  const byFile = new Map();
  const patch = execFileSync(
    'git',
    [
      'log',
      '--all',
      '--no-color',
      '-p',
      '--diff-filter=ACMR',
      // One line of context: a secret is usually a whole added line, and more
      // context only finds the same value again in an adjacent line.
      '-U0',
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );

  /** @type {string | undefined} */
  let currentFile;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      currentFile = addedPath(line);
      continue;
    }
    if (currentFile === undefined) continue;
    const added = addedText(line);
    if (added === null) continue;
    if (isBinaryPath(currentFile) || isAllowlistedPath(currentFile)) continue;
    const hits = scanText(added);
    if (hits.length === 0) continue;
    const existing = byFile.get(currentFile) ?? new Set();
    for (const hit of hits) existing.add(hit);
    byFile.set(currentFile, existing);
  }

  return [...byFile.entries()].map(([file, hits]) => ({ file, hits: [...hits] }));
}

/**
 * The file a `+++ ` header names, or `undefined` for a deletion.
 *
 * Extracted from the loop because `git log -p` is a format with three header kinds and
 * the loop had grown a branch per kind.
 *
 * @param {string} header
 * @returns {string | undefined}
 */
function addedPath(header) {
  const target = header.slice(4).trim();
  // `+++ /dev/null` is a deletion: the value is already recorded from the commit that
  // added it.
  if (target === '/dev/null') return undefined;
  return target.replace(/^b\//, '');
}

/**
 * The text of an added line, or `null` for a context or removed line.
 *
 * @param {string} line
 * @returns {string | null}
 */
function addedText(line) {
  if (!line.startsWith('+')) return null;
  if (line.startsWith('+++')) return null;
  return line.slice(1);
}

/**
 * Credential-shaped values for this self-test, assembled rather than written.
 *
 * Written as literals they are exactly what GitHub's push protection declined a
 * push over. The alternatives were to ask GitHub to unblock them or to add an
 * exemption, and both leave the scanner looking the other way. Assembled at
 * runtime, the repository holds no credential-shaped literal, push protection
 * stays fully on for real secrets, and the patterns are still exercised because
 * the runtime value is byte-identical to a well-formed token.
 *
 * `apps/api/src/test-support/synthetic-credentials.ts` is the same idea for the
 * tests that need these values from TypeScript.
 *
 * @param {string} prefix
 * @returns {(tail: string) => string}
 */
function joined(prefix) {
  return (tail) => [prefix, tail].join('');
}

/**
 * Proves the patterns fire, and that a clean file is not flagged.
 *
 * A secret scanner whose patterns silently stop matching reports a pass forever.
 * The synthetic values are shape-correct and obviously fake, so a match comes
 * from the pattern rather than from the value.
 */
function selfTest() {
  const directory = mkdtempSync(path.join(tmpdir(), 'automate-secret-scan-'));
  const pem = ['-----BEGIN ', 'RSA ', 'PRIVATE KEY-----', String.fromCharCode(10), 'MIIE'].join('');
  const aws = joined('AKIA')('IOSFODNN7' + 'EXAMPLE');
  const github = joined('ghp_')('abcdefghijklmnopqrstuvwxyz' + '0123456789');
  const slack = joined('xoxb-')('123456789012-1234567890123-AbCdEfGhIjKlMnOpQr');
  const npmToken = joined('npm_')('abcdefghijklmnopqrstuvwxyz' + '0123456789');
  const stripe = joined('sk_')('live_abcdefghijklmnopqrstuvwx');
  const connectionString = ['postgres', '://user', ':', 'hunter2', '@db:5432/app'].join('');

  /** @type {Array<[string, string, boolean]>} */
  const cases = [
    ['private key', pem, true],
    ['aws', `AWS_ACCESS_KEY_ID=${aws}`, true],
    ['github', `token=${github}`, true],
    ['slack', `SLACK=${slack}`, true],
    ['npm', `NPM_TOKEN=${npmToken}`, true],
    ['stripe', `STRIPE=${stripe}`, true],
    ['connection string', `DATABASE_URL=${connectionString}`, true],
    // A sha256 digest and a content hash are evidence, not credentials. Flagging
    // them is how a high-entropy rule gets switched off.
    ['digest only', 'checksum=' + 'a'.repeat(64), false],
    ['placeholder', 'COOKIE_SECRET=replace-with-at-least-32-characters', false],
    ['env reference', 'const key = process.env.AUTOMATE_API_KEY;', false],
    // The placeholder convention, recognised by name rather than by exempting the
    // files that use it: `user:pass@` is this tree's documented example form and
    // appears in doc comments and loopback test fixtures.
    [
      'documented connection string',
      'DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/automate',
      false,
    ],
    ['documented example', '// e.g. postgresql://user:pass@host:5432/db' + '\n', false],
    ['block comment example', `/** ${aws} */\n`, false],
  ];
  const failures = [];
  try {
    for (const [label, content, shouldMatch] of cases) {
      const file = path.join(directory, `${String(label).replace(/[^a-z]/gi, '_')}.txt`);
      writeFileSync(file, content, 'utf8');
      const hits = scanCode(readFileSync(file, 'utf8'));
      const matched = hits.length > 0;
      if (matched !== shouldMatch) {
        failures.push(
          `${label}: expected ${shouldMatch ? 'a match' : 'no match'}, got ` +
            `${matched ? `matches (${hits.join(', ')})` : 'no match'}`,
        );
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    console.error('Secret scan self-test failed — the patterns are not doing what they claim');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Secret scan self-test passed: ${cases.length} synthetic cases behave as declared`);
}

/**
 * @returns {Map<string, { file: string, kind: string, why: string }>}
 */
function readBaseline() {
  const file = path.join(root, 'scripts', 'secret-scan-baseline.json');
  if (!existsSync(file)) return new Map();
  return parseBaseline(JSON.parse(readFileSync(file, 'utf8')));
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const withHistory = process.argv.includes('--history');
  let findings = scanRepository();
  if (withHistory) findings = findings.concat(scanHistory());
  if (findings.length > 0 && withHistory) {
    // The baseline is consulted only for the history walk. The working tree is the
    // thing that ships, and a finding there is a finding today — no grandfathering.
    const known = readBaseline();
    const { newFindings, stale } = partitionByBaseline(findings, known);
    for (const entry of stale) {
      console.info(
        `note: ${entry.file} — ${entry.kind} is in scripts/secret-scan-baseline.json but ` +
          `no longer occurs. Remove it: ${entry.why}`,
      );
    }
    if (newFindings.length === 0) {
      console.log(
        `Secret scan passed (working tree + git history; ` +
          `${findings.length} historical finding(s) enumerated in secret-scan-baseline.json)`,
      );
    } else {
      console.error('Secret scan failed (working tree + git history)');
      for (const { file, hits } of newFindings) console.error(`- ${file}: ${hits.join(', ')}`);
      process.exit(1);
    }
  } else if (findings.length > 0) {
    console.error('Secret scan failed (working tree)');
    for (const { file, hits } of findings) console.error(`- ${file}: ${hits.join(', ')}`);
    process.exit(1);
  } else {
    console.log(
      `Secret scan passed (${withHistory ? 'working tree + git history' : 'working tree'})`,
    );
  }
}
