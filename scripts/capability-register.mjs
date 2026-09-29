import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Verifies the capability register against the tree.
 *
 * The register is the repository's most valuable document and it is
 * hand-maintained, which is why it drifts: nothing checked whether the files it
 * cites still exist, so a row could keep claiming evidence for a path that had
 * been renamed, moved or deleted, and the register would still look authoritative
 * at every reader.
 *
 * What this can and cannot decide:
 *
 *  - It **can** check the mechanical facts: that every cited path still exists,
 *    that every status is in the documented vocabulary, that the baseline commit
 *    is real, and that no row is left with an empty status.
 *  - It **cannot** judge whether a capability is `real`, `mock`, `missing`,
 *    `deferred` or `obsolete`. That needs someone who knows what the code is
 *    supposed to do. A script that guessed would be worse than no script, because
 *    a register that looks generated invites trust it has not earned.
 *
 * So this does not *regenerate* the statuses; it makes the falsifiable half
 * impossible to get wrong, and it will tell you when the register and the tree
 * have parted company.
 *
 * `--update-baseline` rewrites only the `**Baseline:**` line to the current HEAD.
 * `--register <path>` checks a fixture instead, so a test can prove each failure
 * mode without mutating the real document.
 */

/** @param {string} command @param {string[]} args */
function sh(command, args) {
  return spawnSync(command, args, { cwd: root, encoding: 'utf8' });
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultRegisterPath = path.join(root, 'docs', 'migration', 'capability-register.md');

/** @param {string} flag @returns {string | undefined} */
function flagValue(flag) {
  const at = process.argv.indexOf(flag);
  return at === -1 ? undefined : process.argv[at + 1];
}

// `--register <path>` checks a fixture instead, so the test suite can prove each
// failure mode without mutating the real document.
const registerPath = flagValue('--register') ?? defaultRegisterPath;
const registerPathRelative = path.relative(root, registerPath) || registerPath;

const STATUSES = new Set(['real', 'mock', 'missing', 'deferred', 'obsolete']);

if (!existsSync(registerPath)) {
  console.error(`Capability register not found at ${registerPathRelative}`);
  process.exit(1);
}

const source = readFileSync(registerPath, 'utf8');

if (process.argv.includes('--update-baseline')) {
  const head = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(head)) {
    console.error('could not resolve HEAD');
    process.exit(1);
  }
  // Matches the line's *shape*, not its current content, so a baseline that is
  // malformed — or holds a hash from a branch that no longer exists — can be
  // repaired rather than only replaced. Requiring 40 hex here meant the one
  // situation where you most want to re-run it was the one it refused.
  const updated = source.replace(/^\*\*Baseline:\*\* .*$/m, `**Baseline:** \`${head}\``);
  if (updated === source) {
    console.error('no `**Baseline:**` line found, so nothing was updated');
    process.exit(1);
  }
  writeFileSync(registerPath, updated);
  console.log(`Capability register baseline updated to ${head.slice(0, 12)}`);
  process.exit(0);
}

/**
 * The register's table rows: | id | capability | status | qualification | evidence | phase |
 *
 * The header row (`| ID | Capability | ... |`) and the separator row
 * (`| --- | --- | ... |`) have the same shape and parse identically, so both are
 * matched here and rejected below — a row whose "id" is not a dotted lowercase
 * token is a header, not a capability.
 */
/** One `|`-delimited cell. */
const cellPattern = /\|([^|]*)/g;

/**
 * The register's rows: `id | capability | status | qualification | evidence | phase`.
 *
 * Collected a cell at a time rather than by one pattern with a nested quantifier
 * over a group — the shape `security/detect-unsafe-regex` exists to catch, and
 * which the table rows genuinely have. Six `|`-separated cells cannot nest a
 * quantifier, so the pass is linear by construction.
 *
 * The header row and the separator row have the same shape and parse
 * identically, so both are collected here and rejected below: a row whose first
 * cell is not a dotted lowercase token is a header, not a capability.
 *
 * @param {string} line
 * @returns {string[] | undefined}
 */
function parseRow(line) {
  if (!line.trimStart().startsWith('|')) return undefined;
  const cells = [...line.matchAll(cellPattern)].map((entry) => (entry[1] ?? '').trim());
  return cells.length >= 6 ? cells : undefined;
}

/**
 * A capability id is a dotted lowercase token: segments of alphanumerics
 * separated by a single dot.
 *
 * Written as a segment pattern with a manual loop rather than
 * `/^[a-z0-9]+([.-][a-z0-9]+)*$/`, which nests a quantifier inside a group and
 * is the shape `security/detect-unsafe-regex` exists to catch. Splitting on the
 * separator and checking each part cannot backtrack at all.
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

/** Backticked path-looking tokens, which is how the register cites evidence. */
const pathPattern = /`([^`]+)`/g;

const failures = [];
const rows = [];

for (const line of source.split(/\r?\n/)) {
  const cells = parseRow(line);
  if (cells === undefined) continue;
  const [id, capability, rawStatus, , evidence] = cells;
  if (id === undefined || !isCapabilityId(id)) continue;
  const status = (rawStatus ?? '').trim();
  const row = { id, capability: (capability ?? '').trim(), status, evidence: evidence ?? '' };
  rows.push(row);

  if (!STATUSES.has(status)) {
    failures.push(`${id}: status "${status}" is not one of ${[...STATUSES].join(', ')}`);
  }

  const cited = [...row.evidence.matchAll(pathPattern)].map((entry) => entry[1] ?? '');
  for (const citation of cited) {
    // A citation is either a path in this repository, or an external reference
    // that a person can follow. Only the former can be checked.
    if (/^(https?:|docs\/migration\/[^/]+\.json|AutoMate\/)/.test(citation)) continue;
    if (citation.includes('*')) continue;
    if (!existsSync(path.join(root, citation))) {
      failures.push(`${id}: cites "${citation}", which does not exist`);
    }
  }
}

// Every agent domain must have a row, ledger C-2.
//
// `AgentDomainSchema` declares `browser`, `api`, `load`, `security` and `mobile`.
// The register had rows for three of them: `load` and `mobile` were absent, so a
// reader could not tell whether the capability was missing, deferred, or simply
// forgotten. A register that enumerates capabilities and silently omits two of the
// five is not a complete account of itself.
//
// The mapping from domain to register id is `quality.<domain>`, which is the
// convention every existing row already follows.
const agentDomainSource = readFileSync(
  path.join(root, 'packages', 'shared-contracts', 'src', 'schemas', 'agents.ts'),
  'utf8',
);
const domainEnum = /AgentDomainSchema\s*=\s*z\.enum\(\s*\[([^\]]*)\]\s*\)/.exec(agentDomainSource);
// A register that describes no quality domain at all is a fixture, not an omission.
// The contract suite runs this script against single-row registers to prove each
// failure mode, and requiring five `quality.*` rows of one would make every one of
// those cases fail for a reason that has nothing to do with what it is testing. So
// the check runs when the register claims to describe quality domains, and is inert
// when it does not — which is also the only way it can be correct about a document
// scoped to something other than agent quality.
const hasQualityRows = rows.some((row) => row.id.startsWith('quality.'));
if (domainEnum === null) {
  if (hasQualityRows) {
    failures.push(
      'could not read AgentDomainSchema from packages/shared-contracts/src/schemas/agents.ts; ' +
        'the domain check cannot run',
    );
  }
} else if (hasQualityRows) {
  const domains = [...domainEnum[1].matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
  const known = new Set(rows.map((row) => row.id));
  for (const domain of domains) {
    const id = `quality.${domain}`;
    if (known.has(id)) continue;
    failures.push(
      `${id} has no register row. Every domain in AgentDomainSchema must be accounted for — ` +
        'a reader who cannot find the row cannot tell whether the capability is missing, ' +
        'deferred, or was simply forgotten.',
    );
  }
}

// The baseline must be a commit this repository has.
const baseline = /^\*\*Baseline:\*\* `([0-9a-f]{40})`$/m.exec(source);
if (baseline === null) {
  failures.push('no `**Baseline:**` line with a full commit hash');
} else {
  const commit = baseline[1];
  const known = sh('git', ['cat-file', '-e', `${commit}^{commit}`]).status === 0;
  if (!known) failures.push(`baseline ${commit} is not a commit in this repository`);
}

if (rows.length === 0) {
  failures.push('no register rows were parsed — the table shape changed, or the file is empty');
}

if (failures.length > 0) {
  console.error('Capability register does not match the tree');
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(
    `\n${rows.length} row(s) checked. Fix the citations, or re-check the status by hand: ` +
      'a script cannot tell you whether a capability is real.',
  );
  process.exit(1);
}

const byStatus = new Map();
for (const row of rows) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
console.log(
  `Capability register verified: ${rows.length} row(s), ` +
    [...byStatus.entries()].map(([status, count]) => `${count} ${status}`).join(', ') +
    '. Every cited path exists and the baseline is a real commit.',
);
