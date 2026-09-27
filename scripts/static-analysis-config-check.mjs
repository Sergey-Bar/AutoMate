/**
 * Structural validation for the static-analysis configs.
 *
 * `.semgrep.yml` and `.gitleaks.toml` were both committed and both inert:
 *
 *  - two semgrep rules were unparseable, so nothing matched;
 *  - `.gitleaks.toml` allowlisted `[A-Za-z0-9+/]{40,}` in every `*.test.ts`,
 *    which is a blanket exemption for the exact values the scanner exists to
 *    find.
 *
 * Neither tool is installed in every environment, so this script cannot replace
 * them. It checks what is checkable without them: that each config is
 * structurally sound, and that no allowlist entry is broad enough to disable the
 * scanner it belongs to. `security:verify` runs the real scanners when present
 * and always runs this.
 *
 * Plain JavaScript with no dependencies — every script here is `.mjs`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** @type {string[]} */
const failures = [];

/** @param {string} file @param {string} message */
function fail(file, message) {
  failures.push(`${file}: ${message}`);
}

const semgrepFile = '.semgrep.yml';
const semgrepSource = readFileSync(path.join(root, semgrepFile), 'utf8');

/**
 * Split the rule list on top-level `- id:` markers.
 *
 * A real YAML parser would be better, but this repository has no YAML
 * dependency and the invariants below concern a rule's keys, which always sit at
 * a known indentation.
 */
/** @param {string} source @returns {Array<{id: string, body: string}>} */
function semgrepRules(source) {
  const blocks = [];
  const lines = source.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    if (/^ {2}- id:/.test(line)) {
      if (current) blocks.push(current);
      current = { id: line.replace(/^ {2}- id:\s*/, '').trim(), lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) blocks.push(current);
  return blocks.map((block) => ({ id: block.id, body: block.lines.join('\n') }));
}

const rules = semgrepRules(semgrepSource);
if (rules.length === 0) fail(semgrepFile, 'no rules found; an empty ruleset matches nothing');

const seenIds = new Set();
for (const rule of rules) {
  if (rule.id === '') fail(semgrepFile, 'a rule has an empty id');
  if (seenIds.has(rule.id)) fail(semgrepFile, `duplicate rule id "${rule.id}"`);
  seenIds.add(rule.id);

  if (!/\n\s+message:/.test(rule.body)) fail(semgrepFile, `rule "${rule.id}" has no message`);
  if (!/\n\s+severity:\s*(ERROR|WARNING|INFO)/.test(rule.body))
    fail(semgrepFile, `rule "${rule.id}" has no severity of ERROR, WARNING or INFO`);
  if (!/\n\s+languages:/.test(rule.body))
    fail(semgrepFile, `rule "${rule.id}" declares no languages`);

  // The defect that made two rules inert: a rule may declare `pattern` or
  // `pattern-regex`, never both, because semgrep rejects the combination.
  const topLevelPattern = /^\s+pattern:\s/m.test(rule.body);
  const topLevelPatternRegex = /^\s+pattern-regex:\s/m.test(rule.body);
  if (topLevelPattern && topLevelPatternRegex)
    fail(
      semgrepFile,
      `rule "${rule.id}" declares both pattern and pattern-regex at the rule level; ` +
        'semgrep rejects that combination, so the rule never matches anything',
    );
  if (!/patterns:|pattern:|pattern-either:|pattern-regex:|pattern-inside:/.test(rule.body))
    fail(semgrepFile, `rule "${rule.id}" has no pattern operator`);

  // `where $X contains 'y'` was the other inert spelling. `contains` is not a
  // semgrep operator; the set operators are `<<` and `>>`.
  if (/\bwhere\b[\s\S]*?\bcontains\b/.test(rule.body))
    fail(
      semgrepFile,
      `rule "${rule.id}" uses a \`where … contains …\` clause, which semgrep does ` +
        'not support, so the clause never matches',
    );
}

const gitleaksFile = '.gitleaks.toml';
const gitleaksSource = readFileSync(path.join(root, gitleaksFile), 'utf8');

/** Every `'''…'''` literal from the allowlist section onwards. */
/** @param {string} source @returns {string[]} */
function allowlistLiterals(source) {
  const start = source.indexOf('[allowlist');
  if (start === -1) return [];
  return [...source.slice(start).matchAll(/'''([^']*)'''/g)].map((match) => match[1]);
}

/**
 * A bare character class with a large quantifier matches a large fraction of
 * ordinary content, which is an allowlist entry in disguise. The original
 * `[A-Za-z0-9+/]{40,}={0,2}` is the canonical example: it matches every hash,
 * token and long base64 string, in every test file.
 */
/** @param {string} literal */
function isOverBroadAllowlist(literal) {
  if (literal.length < 12) return false;
  return /^\[.+\]\{\d+,\d*\}.*$/.test(literal);
}

for (const literal of allowlistLiterals(gitleaksSource)) {
  if (isOverBroadAllowlist(literal))
    fail(
      gitleaksFile,
      `allowlist entry ${literal} matches a broad class of values, which disables ` +
        'detection rather than exempting a known-safe fixture',
    );
}

if (/^\s*regex\s*=\s*'''\[A-Za-z0-9/gm.test(gitleaksSource))
  fail(
    gitleaksFile,
    'a rule uses a bare high-entropy character class, which matches every hash, ' +
      'token and long string rather than one specific fixture',
  );

// An allowlist that ignores whole source trees disables the scanner where a
// leaked fixture is most likely to be committed.
for (const literal of allowlistLiterals(gitleaksSource)) {
  if (/(?:\*\*?|\.\*\/)/.test(literal) && /\.(?:test|spec)\./.test(literal))
    fail(
      gitleaksFile,
      `allowlist entry ${literal} ignores every test or spec file, which is where a ` +
        'leaked fixture is most likely to live',
    );
}

if (!/useDefault\s*=\s*true/.test(gitleaksSource))
  fail(gitleaksFile, 'the default ruleset is not enabled, so provider token rules are absent');

/**
 * Every significant line of a TOML file: a table header, an array-of-tables
 * header, or a key assignment, each with its fully-qualified path.
 *
 * @param {string} source
 * @returns {Array<{ kind: 'table' | 'array-of-tables' | 'key', path: string }>}
 */
function tomlStatements(source) {
  /** @type {Array<{ kind: 'table' | 'array-of-tables' | 'key', path: string }>} */
  const statements = [];
  /** @type {string[]} */
  let tablePath = [];
  let inArray = false;

  /** @param {string} part */
  const unquote = (part) => part.trim().replace(/^["']|["']$/g, '');

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    const header = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (header !== null) {
      tablePath = (header[1] ?? '').split('.').map(unquote);
      // An array-of-tables re-opens its own namespace on every element, so it
      // never collides with an earlier value of the same path.
      statements.push({
        kind: line.startsWith('[[') ? 'array-of-tables' : 'table',
        path: tablePath.join('.'),
      });
      inArray = false;
      continue;
    }

    // Inside a multi-line array the entries are values, not keys.
    if (inArray) {
      if (line === ']') inArray = false;
      continue;
    }
    if (line.startsWith('[') && !line.endsWith(']')) inArray = true;

    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = unquote(line.slice(0, separator));
    if (key === '') continue;
    statements.push({ kind: 'key', path: [...tablePath, key].join('.') });
  }
  return statements;
}

/**
 * A TOML key may not be both a value and a table.
 *
 * `.gitleaks.toml` had `paths = [...]` and then `[allowlist.paths]` with bare keys
 * beneath it. TOML rejects that combination outright, so **gitleaks could never
 * load the file**: the gitleaks half of `pnpm security:static` failed on its own
 * configuration before scanning a line, on every host that had the binary
 * installed. Two things hid it. `scripts/secret-scan.mjs` is dependency-free and
 * kept passing, so a reader saw a working secret scan. And this script only
 * checked the *shape* of the rules below the header — it never asked gitleaks to
 * load anything, and could not, because gitleaks is not installed everywhere.
 *
 * So the invariant is checked here, where it runs everywhere.
 *
 * @param {string} source
 * @returns {string[]}
 */
function tomlValueTableCollisions(source) {
  /** @type {Map<string, 'key' | 'table'>} */
  const kinds = new Map();

  for (const statement of tomlStatements(source)) {
    const previous = kinds.get(statement.path);
    if (previous === undefined) {
      kinds.set(statement.path, statement.kind === 'key' ? 'key' : 'table');
      continue;
    }
    // The same key twice under one table is gitleaks' own duplicate-key error, not
    // this one. A *table* after a *value* is the defect above.
    if (previous === 'key' && statement.kind === 'table')
      return [`[${statement.path}] was already assigned a value above, so TOML cannot read it`];
  }

  return [];
}

for (const problem of tomlValueTableCollisions(gitleaksSource)) {
  fail(
    gitleaksFile,
    `${problem}. gitleaks would refuse to load its own configuration, so the ` +
      'gitleaks half of this gate would fail before scanning anything.',
  );
}

/**
 * The semgrep scope must cover every workspace package.
 *
 * The scope was `apps/api/src packages tools scripts e2e` for as long as the
 * ruleset existed, so `apps/web`, `apps/runner` and `apps/worker` were never
 * examined — the three applications most reachable from a browser or a
 * subprocess. Nothing failed when that was true, because a scope that omits a
 * directory reports the same clean result as one that includes it.
 *
 * So the scope is read out of `scripts/static-analysis.mjs` and compared against
 * the real workspace layout. A new package that is not in the scope is a finding,
 * which makes "we widened the scope" a property of the file rather than a claim
 * in a commit message.
 */
const staticAnalysisFile = 'scripts/static-analysis.mjs';
const staticAnalysisSource = readFileSync(path.join(root, staticAnalysisFile), 'utf8');
const semgrepInvocation = staticAnalysisSource.slice(staticAnalysisSource.indexOf("run('semgrep'"));
if (semgrepInvocation === '') {
  fail(staticAnalysisFile, 'no semgrep invocation found; the scope cannot be checked');
} else {
  /** Directories the invocation names, ignoring flags and their arguments. */
  const ignored = new Set(['[', ']', 'scan', '--config', '.semgrep.yml', '--error', '--exclude']);
  const scanned = new Set(
    semgrepInvocation
      .split('\n')
      .map((line) =>
        line
          .trim()
          .replace(/,$/, '')
          .replace(/^'(.*)'$/, '$1')
          .replace(/^"(.*)"$/, '$1'),
      )
      .filter((token) => token !== '' && !token.startsWith('--') && !ignored.has(token)),
  );

  /** Every directory `pnpm-workspace.yaml` says is a package root. */
  const workspacePackages = [];
  for (const group of ['apps', 'packages', 'tools']) {
    const groupDir = path.join(root, group);
    let entries;
    try {
      entries = readdirSync(groupDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!existsSync(path.join(groupDir, entry.name, 'package.json'))) continue;
      if (!existsSync(path.join(groupDir, entry.name, 'src'))) continue;
      workspacePackages.push(`${group}/${entry.name}/src`);
    }
  }

  for (const target of workspacePackages) {
    // A scanned ancestor covers its descendants, because semgrep recurses. Naming
    // `packages` once is therefore enough for every package under it; the finding
    // is about a whole subtree being absent, not about the spelling of a path.
    const covered = [...scanned].some(
      (scannedPath) =>
        scannedPath === target ||
        scannedPath === path.posix.dirname(target) ||
        target.startsWith(`${scannedPath}/`),
    );
    if (covered) continue;
    fail(
      staticAnalysisFile,
      `the semgrep scope omits ${target}, so that package is not examined by the ` +
        'security gate. A scope that omits a directory reports the same clean result as ' +
        'one that includes it, so this cannot be left to a reviewer to notice.',
    );
  }
}

if (failures.length > 0) {
  console.error('Static-analysis config check failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  `Static-analysis config check passed: ${rules.length} semgrep rule(s) are structurally ` +
    'sound and the gitleaks allowlist exempts nothing broad.',
);
