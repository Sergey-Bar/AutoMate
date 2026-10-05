/**
 * The anti-drift assertions, as detectors.
 *
 * Roadmap E4 named seven things a document may claim that the code does not do, and
 * §17's tenth point is the gate over them. Only one of the seven was implemented
 * when this file was written, and the six that were not were the six holding real
 * defects — which is the argument for the list being written down rather than
 * remembered:
 *
 *   1. a relative link that does not resolve;
 *   2. a `pnpm …` command that is not a script in the root `package.json`;
 *   3. a port number that is not the one the code actually binds;
 *   4. an environment variable or secret name that is not declared or read anywhere;
 *   5. a transport the code does not have — the roadmap's named example is a runbook
 *      describing a WebSocket, in a product whose realtime transport is SSE;
 *   6. a capability asserted as available whose register row is not `real`;
 *   7. an ADR referenced with no record.
 *
 * **An eighth was added later, and its own history is the argument for it.** `AGENTS.md`
 * carried a table of per-package coverage floors that was wrong in all eight rows, by 2
 * to 20 points, because a floor moves every time a package gains tests and a hand-typed
 * copy has no reason to move with it. Every other detector here reads a value the code
 * decides — a port, a command, a capability status; this one reads `coverage-baseline.json`,
 * which is the same shape of fix applied to the one number the agents' own instructions
 * most often reason from.
 *
 * **And a ninth, for the same reason one layer down.** How many steps `pnpm verify`
 * chains has moved 12 → 13 → 14 → 15 → 16 across this history, and three documents state
 * it — `site/operations.md` in words, `scripts/gate-tooling.json` in digits, and the v3.0
 * release plan at 15. All three were written by people reading the script. None of them
 * was derived from it, and the v3.0 plan was written against a tree where 16 was the
 * answer. The value is one `&&`-split away, so a copy of it in prose is a copy of
 * something that moves.
 *
 * **Each assertion is a detector, not a keyword.** The first attempt at point 10
 * grepped the doc-gate's source for words like `port` and `transport` and reported
 * them as implemented, because the words were there and the checks were not — a
 * detector that finds a word is a detector that reports itself. So an entry here is
 * either a function or it is `null`, and a `null` entry is reported by name as
 * unimplemented rather than quietly counted.
 *
 * **The truth is derived, never restated.** Ports come from `DEFAULT_PORT` in
 * `packages/config` and the `webPort` the E2E suite is configured with; environment
 * variables come from `packages/config` plus every `process.env` read in the
 * workspace; commands come from the root `package.json`. A checker holding its own
 * copy of the expected values would be a second place for the real value to be
 * wrong, and the failure would be a document corrected to match the checker.
 *
 * Narrow on purpose. Every pattern here matches a *claim*, not a topic: a document
 * is allowed to say a capability is deferred, and to name a port that has since
 * changed, and to record what a superseded plan wrongly said. A gate that reports
 * the honest sentence as a defect gets switched off rather than refined, and then it
 * catches nothing — including the six defects that were sitting in the tree while it
 * was being written.
 */

/**
 * @typedef {object} Document
 * @property {string} path repository-relative, `/`-separated
 * @property {string} text
 */

/**
 * @typedef {object} DriftEnvironment
 * @property {Document[]} documents
 * @property {Set<string>} rootScripts
 * @property {Array<{ id: string, capability: string, status: string }>} registerRows
 * @property {Set<string>} realPorts
 * @property {Set<string>} knownEnvVars
 * @property {Set<string>} adrNumbers
 * @property {Map<string, string>} coverageFloors
 * @property {number | null} verifySteps
 * @property {(relative: string) => boolean} fileExists
 */

/**
 * Documents whose claims are about a repository this one no longer contains.
 *
 * `unified-repository-migration.md` is the plan of record for a merge that has
 * already happened, so its citations name the repository this one was merged
 * *from*. It is exempt for the same reason `docs-paths.test.mjs` exempts it, and
 * the past-tense half of a plan is not a claim about this tree.
 */
export const HISTORICAL_DOCS = new Set(['docs/migration/unified-repository-migration.md']);

/**
 * Documents that describe a product or a decision this repository is not, rather
 * than a claim about it.
 *
 * Marked as historical **in their own text** as part of the change that added them
 * here, so a reader who opens one is told before they read a line. That is the
 * difference between an exemption and a gap: an exemption with a marker is a
 * decision somebody can find, and one without is a hole the next document falls
 * into.
 *
 *   - `docs/architecture/unified-platform.md` — the design record of the unification,
 *     written against the pre-merge layout. It still describes `db:push` and
 *     `@automate/contracts`; the current boundaries are the capability register's.
 *
 * **One used to be here that no longer is.** A draft PRD for the product's *former*
 * name was exempted as superseded. It has been **deleted**, on three grounds that the
 * exemption's own premise contradicted:
 *
 *   - it was never marked as historical. The exemption above claims a marker in the
 *     document's own text, and that was not true — the file said `Status: Draft`. A
 *     document that asserts a status its own header denies is worse than an
 *     unexempted one.
 *   - it was a draft for a **product name this repository no longer has**, so the
 *     thing it was exempted for no longer existed.
 *   - keeping it required 30 live references to that name to survive, and a name
 *     gate that permits a known-bad string is not a gate.
 *
 * Deleting it lost one thing worth recording: it was the only place the OpenAPI
 * intake idea was written down, which `RF-11` cites. That row now cites
 * `packages/shared-contracts/README.md` and the ledger itself, so the reasoning
 * survives the document.
 */
export const SUPERSEDED_DOCS = new Set(['docs/architecture/unified-platform.md']);

/**
 * `pnpm` verbs that are not root scripts and never were.
 *
 * Without this, `pnpm install` — which appears in almost every document in every
 * repository — is a finding, and a gate that reports the first line of the
 * README gets switched off. The distinction is not a spelling difference: these are
 * the package manager's own commands, not this repository's surface.
 */
const PNPM_BUILTINS = new Set([
  'add',
  'audit',
  'catalog',
  'dlx',
  'exec',
  'fetch',
  'import',
  'init',
  'install',
  'licenses',
  'link',
  'list',
  'login',
  'logout',
  'outdated',
  'pack',
  'patch',
  'publish',
  'rebuild',
  'remove',
  'root',
  'run',
  'store',
  'test',
  'unlink',
  'unpublish',
  'update',
  'version',
  'view',
  'why',
  'workspace',
]);

/**
 * The four documents a reader lands on before any of `docs/`.
 *
 * One filter with three alternatives rather than three filters. The first version
 * chained `.filter(front door).filter(docs/**)`, which is an intersection of two
 * disjoint sets, so the collector returned zero documents and every detector
 * reported a clean repository. It is the narrowest possible version of the failure
 * this file is about: a gate that has measured nothing and says so with a `pass`.
 */
const FRONT_DOORS = new Set(['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'CHANGELOG.md']);

/**
 * The generated status pages, which report rather than instruct.
 *
 * `site/pages/quality/ten.md` prints `pnpm review:pr` in a row that says
 * `review:pr` does not exist. That is the report doing its job, and a command
 * detector that flagged it would be reporting the gate's own output as a gate
 * failure — a self-referential loop where fixing the finding means making the
 * measurement lie. The same reasoning as the exempt documents above, applied to a
 * page that is derived rather than written, and the staleness test in
 * `docs-paths.test.mjs` is what holds these to the tree instead.
 */
const GENERATED_PAGES = 'site/pages/';

/**
 * The seven, in the roadmap's own order.
 *
 * @type {ReadonlyArray<{ id: string, rule: string, check: ((env: DriftEnvironment) => string[]) | null, gap: string }>}
 */
export const ASSERTIONS = [
  {
    id: 'links',
    rule: 'every relative link in a document resolves',
    check: checkLinks,
    gap: '',
  },
  {
    id: 'commands',
    rule: 'every `pnpm …` command is a script in the root package.json',
    check: checkCommands,
    gap: '',
  },
  {
    id: 'ports',
    rule: 'every port in prose is one the code actually binds',
    check: checkPorts,
    gap: '',
  },
  {
    id: 'env-vars',
    rule: 'every environment variable and secret name in prose is declared or read',
    check: checkEnvVars,
    gap: '',
  },
  {
    id: 'transports',
    rule: 'every transport named in prose is one the code has',
    check: checkTransports,
    gap: '',
  },
  {
    id: 'capability-claims',
    rule: 'no document asserts a capability whose register row is not `real`',
    check: checkCapabilityClaims,
    gap: '',
  },
  {
    id: 'adrs',
    rule: 'no ADR is referenced without a record',
    check: checkAdrs,
    gap: '',
  },
  {
    id: 'coverage-floors',
    rule: 'a coverage floor quoted in prose is the one `coverage-baseline.json` records',
    check: checkCoverageFloors,
    gap: '',
  },
  {
    id: 'verify-steps',
    rule: 'a step count quoted for `pnpm verify` is the one `package.json` chains',
    check: checkVerifySteps,
    gap: '',
  },
];

/** @param {DriftEnvironment} env @returns {string[]} */
export function driftFindings(env) {
  return ASSERTIONS.flatMap((assertion) => (assertion.check === null ? [] : assertion.check(env)));
}

/** The ids of assertions with no detector, which is a finding rather than a zero. */
export function unimplemented() {
  return ASSERTIONS.filter((assertion) => assertion.check === null).map(
    (assertion) => assertion.id,
  );
}

// ── 1. Links ────────────────────────────────────────────────────────────────

/**
 * A markdown link target: the `](` and what follows it.
 *
 * Anchored on the delimiter rather than on the whole `[text](target)` form, because
 * nothing here uses the text and the full form is the shape
 * `security/detect-unsafe-regex` flags: two adjacent negated character classes with
 * a literal between them is ambiguous to the analyser even though the classes are
 * disjoint from the delimiter and cannot actually backtrack.
 */
const LINK = /\]\(\s*([^)\s]+)\)/g;

/** Targets that are not paths into this repository. */
const EXTERNAL = /^(?:https?:|mailto:|tel:|#|\/)/;

/** @param {DriftEnvironment} env @returns {string[]} */
function checkLinks(env) {
  /** @type {string[]} */
  const findings = [];
  for (const document of env.documents) {
    const directory = document.path.split('/').slice(0, -1).join('/');
    for (const match of document.text.matchAll(LINK)) {
      const target = (match[1] ?? '').trim();
      if (EXTERNAL.test(target)) continue;
      const [withoutFragment] = target.split('#');
      if (withoutFragment === undefined || withoutFragment === '') continue;
      const resolved = normalise(
        withoutFragment.startsWith('/')
          ? withoutFragment.replace(/^\//, '')
          : [directory, withoutFragment].join('/'),
      );
      // A directory is a legitimate target — `packages/config` is how a document
      // points at a package — and `fileExists` is a prefix test, so both resolve.
      if (env.fileExists(resolved)) continue;
      findings.push(`${document.path}: link to \`${target}\`, which does not exist`);
    }
  }
  return findings;
}

/**
 * Drop `.` and `..` segments, and the leading `./`.
 *
 * Without it `[ADR-002](./unified-platform.md)` in `docs/architecture/db-migration.md`
 * resolved to `docs/architecture/./unified-platform.md` and was reported as a
 * broken link beside a file that exists — a false positive on the very document
 * that most needed the check to be right.
 *
 * @param {string} value
 * @returns {string}
 */
function normalise(value) {
  /** @type {string[]} */
  const out = [];
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
}

// ── 2. Commands ─────────────────────────────────────────────────────────────

/**
 * `pnpm <word>`, capturing the word.
 *
 * Narrow to a bare word that is not a flag, so `pnpm --filter x test` and
 * `pnpm install` are left alone: the first names a package script whose spelling is
 * the package's business, and the second is a built-in. A checker that reported
 * those would be reporting prose, and the first version of this file's own
 * `citedPaths`-style narrowing had exactly that problem — 30 findings, nearly all
 * false.
 *
 * `pnpm run <script>` yields the word `run`, which `PNPM_BUILTINS` already accepts,
 * so no optional group is needed in front of the capture — and an optional
 * `run\s+` in front of a required group is the other pattern
 * `security/detect-unsafe-regex` flags, for the same reason as the link pattern
 * above. Both fixes are the same lesson: the analyser flags ambiguity, and the
 * fix for ambiguity is to remove it rather than to suppress the warning.
 */
const PNPM_SCRIPT = /\bpnpm\s+([a-z][a-z0-9:-]*)/g;

/** @param {DriftEnvironment} env @returns {string[]} */
function checkCommands(env) {
  /** @type {string[]} */
  const findings = [];
  for (const document of env.documents) {
    for (const match of document.text.matchAll(PNPM_SCRIPT)) {
      const script = match[1] ?? '';
      if (env.rootScripts.has(script) || PNPM_BUILTINS.has(script)) continue;
      findings.push(
        `${document.path}: \`pnpm ${script}\` is not a script in the root package.json`,
      );
    }
  }
  return findings;
}

// ── 3. Ports ────────────────────────────────────────────────────────────────

/** A port in prose: a colon and four digits, not part of a longer number. */
const PORT = /(?<![\d.]):(\d{4})(?!\d)/g;

/** @param {DriftEnvironment} env @returns {string[]} */
function checkPorts(env) {
  return eachLine(env, (document, line) =>
    [...line.matchAll(PORT)]
      .map((match) => match[1] ?? '')
      .filter((port) => !env.realPorts.has(port))
      .map(
        (port) =>
          `${document.path}: \`${port}\` is not a port this repository binds. The real ones are ` +
          `${[...env.realPorts].sort().join(', ')}.`,
      ),
  );
}

// ── 4. Environment variables ────────────────────────────────────────────────

/**
 * A screaming-snake-case token in backticks, which is how a document names a
 * setting.
 *
 * **Narrowed to names that look like settings, after a broad first pass reported
 * 41 findings of which about six were real.** The broad pass flagged every
 * `` `UPPER_SNAKE_CASE` ``, `` `FLAG_DEFAULTS` `` and `` `POST` `` in the
 * repository's naming-convention tables as undeclared environment variables, which
 * is the crying-wolf outcome `docs-paths.test.mjs` already documented for the
 * citation check. A setting name carries a config word — a secret, a key, a
 * location, a number with a unit — and a convention or an HTTP verb does not.
 */
const ENV_TOKEN = /`([A-Z][A-Z0-9_]*)`/g;

/** The words that make a screaming-snake token a setting rather than a constant. */
const SETTING_WORD =
  /(?:^|_)(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|DIR|ROOT|PATH|HOST|PORT|URL|DSN|ENV|CONFIG|PREFIX|BUCKET|REGION|PROFILE|WHATWG|USER|USERNAME|EMAIL|MIN|MAX|SIZE|LIMIT|TIMEOUT|INTERVAL|RETENTION|DAYS|HOURS|SECONDS|MINUTES|MS|BYTES|LIFETIME|TTL|ENABLED|DISABLED|MODE|LEVEL|NAMESPACE|WORKSPACE|INSTALLED|ORIGIN|HEADER|LANGUAGE|LOG)(?:_|$)/;

/** @param {DriftEnvironment} env @returns {string[]} */
function checkEnvVars(env) {
  return eachLine(env, (document, line) => {
    if (isNegated(line)) return [];
    return [...line.matchAll(ENV_TOKEN)]
      .map((match) => match[1] ?? '')
      .filter((name) => isUndeclaredSetting(name, env))
      .map(
        (name) =>
          `${document.path}: \`${name}\` is not declared in packages/config and read nowhere in the workspace`,
      );
  });
}

/**
 * Whether a name looks like a setting, and is not one this workspace has.
 *
 * Three guards in one predicate because the first version inlined them in a
 * three-deep loop nest, which the complexity ratchet measured at 22 against a
 * ceiling of 15 — and the fix for that is to say the rule once, not to raise the
 * ceiling.
 *
 * @param {string} name
 * @param {DriftEnvironment} env
 */
function isUndeclaredSetting(name, env) {
  if (name.length < 8) return false;
  if (!SETTING_WORD.test(name)) return false;
  return !env.knownEnvVars.has(name);
}

/**
 * Every line of every document, with the code blocks and quotations removed.
 *
 * One place rather than four: the four line-oriented detectors each began as a
 * `for` over documents containing a `for` over lines, which is three levels of
 * nesting for what is a flat operation, and the cognitive-complexity ratchet
 * counted it as such. It also means the strip rule — fenced blocks, struck-through
 * text, quoted runs — is stated once instead of being re-derived by each detector.
 *
 * @param {DriftEnvironment} env
 * @param {(document: Document, line: string) => string[]} onLine findings for one line
 * @returns {string[]}
 */
function eachLine(env, onLine) {
  return env.documents.flatMap((document) =>
    lines(document.text).flatMap((line) => onLine(document, line)),
  );
}

/**
 * Whether a line is recording a falsehood rather than asserting one.
 *
 * Shared by the transport, environment and command detectors because the need is
 * the same in all three: a document has to be able to say "the runbook claimed the
 * reporter secret secures a WebSocket" and "the old name was `VAULT_PASSWORD`"
 * without the gate reporting the quotation as the claim. A gate that forbids that is
 * a gate that forces the omission of the record of the defect, which is a worse
 * outcome than the defect it was aimed at.
 *
 * Deliberately a per-line test rather than a per-document one. A document with one
 * honest correction in it and one real claim should still be reported for the real
 * claim, and a document-wide exemption would let a single "not" buy a pass.
 *
 * The cost of per-line is that a marker can be wrapped onto the previous line by
 * the formatter — `The predecessor design specified a` / `WebSocket transport` reads
 * as a claim when read line-wise and as a record when read as prose. The fix is to
 * rewrap the sentence, not to widen the marker list: a marker list broad enough to
 * survive wrapping would include words like "however".
 */
const NEGATION =
  /\b(?:not|never|no|none|nothing|neither|without|rather than|instead of|future|post-mvp|planned|proposed|predecessor|previous|former|used to|superseded|retired|withdrawn)\b/i;

/** @param {string} line */
function isNegated(line) {
  return NEGATION.test(line);
}

// ── 5. Transports ───────────────────────────────────────────────────────────

/**
 * Transports the code has, and the sentence shapes that make naming another one a
 * claim rather than a quotation.
 *
 * The negation is load-bearing. The roadmap's own §11 rules out a WebSocket
 * transport, so a document is *entitled* to write "Post-MVP: add a WebSocket
 * transport" — that is the honest form. A runbook asserting one *exists* is the
 * defect, and the difference between the two is the sentence around the word.
 */
const FORBIDDEN_TRANSPORTS = ['websocket', 'websockets', 'socket.io', 'grpc'];

/** @param {DriftEnvironment} env @returns {string[]} */
function checkTransports(env) {
  return eachLine(env, (document, line) => {
    if (isNegated(line)) return [];
    return FORBIDDEN_TRANSPORTS.filter((transport) =>
      new RegExp(`\\b${transport}\\b`, 'i').test(line),
    ).map(
      (transport) =>
        `${document.path}: describes a ${transport} transport this product does not have. The realtime ` +
        'transport is SSE over a durable outbox feed; the reporter ingest is HTTP POST.',
    );
  });
}

// ── 6. Capability claims ────────────────────────────────────────────────────

/**
 * A sentence asserting that something *works*.
 *
 * Deliberately an availability claim and not a topic. A document is allowed — and
 * required — to say "the mobile quality domain is deferred"; D15's rule is that it
 * may not say the thing is available. So the pattern is a copula with an
 * availability adjective, and a register row named in the same line decides whether
 * the claim is true.
 *
 * **No `g` flag.** A global regex carries `lastIndex` between `.test()` calls, so a
 * line-by-line loop over a document silently alternates between matching and
 * skipping — the detector reported a finding on the first matching line of a line
 * pair and none on the second, which is the least diagnosable shape a gate can have.
 */
const AVAILABILITY_CLAIM =
  /\b(?:is|are|has|have|supports?|provides?|ships?|works?)\b[^.\n]{0,40}?\b(?:implemented|supported|available|working|shipped|enabled|production-ready|fully supported)\b/i;

/** @param {DriftEnvironment} env @returns {string[]} */
function checkCapabilityClaims(env) {
  const deferred = env.registerRows.filter((row) => row.status !== 'real');
  return eachLine(env, (document, line) => {
    if (!AVAILABILITY_CLAIM.test(line) || isNegated(line)) return [];
    return deferred
      .filter((row) => mentions(line, row))
      .map(
        (row) =>
          `${document.path}: asserts something is \`real\` about \`${row.id}\`, which the ` +
          `register marks \`${row.status}\`. A document may name it and must say it is ` +
          `\`${row.status}\`.`,
      );
  });
}

/**
 * Whether a line is about one register row.
 *
 * The id is the exact match — `quality.api` is unambiguous. The capability prose is
 * matched on every word of four letters or more, which is a proxy for "is this
 * sentence about that thing" and is wrong sometimes; the alternative, requiring the
 * exact phrase, misses the common case where a document writes "the mobile domain"
 * for a row called "Mobile quality domain". Missing a claim is the safer error, so
 * the words are compared whole rather than by prefix.
 *
 * @param {string} line
 * @param {{ id: string, capability: string }} row
 */
function mentions(line, row) {
  if (line.includes(row.id)) return true;
  const words = row.capability
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4);
  if (words.length < 2) return false;
  return words.every((word) => line.toLowerCase().includes(word));
}

// ── 7. ADRs ─────────────────────────────────────────────────────────────────

/** @param {DriftEnvironment} env @returns {string[]} */
function checkAdrs(env) {
  /** @type {string[]} */
  const findings = [];
  for (const document of env.documents) {
    for (const match of document.text.matchAll(/ADR-(\d{3})/g)) {
      const number = match[1] ?? '';
      if (env.adrNumbers.has(number)) continue;
      findings.push(
        `${document.path}: references ADR-${number}, which has no record. \`docs/adr/\` is the register; ` +
          'an architecture decision nobody wrote down is a decision that can be made twice.',
      );
    }
  }
  return findings;
}

// ── 8. Coverage floors ───────────────────────────────────────────────────────

/**
 * A markdown table row naming a package in backticks beside a `a/b/c/d` tuple.
 *
 * Narrower than it looks, because the tuple is four integers separated by slashes and
 * the first cell is a backticked path that is a key in `coverage-baseline.json`. No
 * other table in this repository has both, so the pattern cannot fire on prose that
 * merely looks numeric — which is the crying-olf outcome every detector above records
 * having once produced.
 */
const COVERAGE_ROW = /^\|\s*`([a-z][\w./-]*)`\s*\|\s*(\d+\/\d+\/\d+\/\d+)\s*\|\s*$/;

/** @param {DriftEnvironment} env @returns {string[]} */
function checkCoverageFloors(env) {
  return eachLine(env, (document, line) => {
    const row = COVERAGE_ROW.exec(line);
    if (row === null) return [];
    const pkg = row[1] ?? '';
    const claimed = row[2] ?? '';
    const real = env.coverageFloors.get(pkg);
    if (real === undefined || real === claimed) return [];
    return [
      `${document.path}: quotes \`${pkg}\`'s coverage floor as ${claimed}, and ` +
        `\`coverage-baseline.json\` records ${real}. A floor printed in prose is a copy, ` +
        'and the ratchet moves the original every time a package gains tests.',
    ];
  });
}

// ── 9. Verify step count ────────────────────────────────────────────────────

/**
 * The step counts a document can spell, as words.
 *
 * Position in the array *is* the value, which is why the array starts at `zero` and why
 * the detector cannot silently accept `twentyone`. Prose spells this particular number
 * as a word — `site/operations.md` says "Sixteen steps" — so a detector matching only
 * digits would read a clean repository over the one document that states it.
 */
const STEP_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];

/**
 * A claim about how many steps a script chains.
 *
 * Paired with the `verify` mention the line has to carry, so a document's "3 runs of the
 * suite" and a migration's "contract step" are not both claims about `pnpm verify`.
 */
const STEP_CLAIM =
  /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+steps?\b/i;

/**
 * The words a **limit** uses rather than a **count**.
 *
 * "`verify` may grow from 16 to at most 20 steps" is a policy statement about
 * `scripts/gate-tooling.json`'s budget, not a claim about `package.json`, and reporting
 * it would be reporting the honest sentence as the defect. `budget`, `grow`, `at most`,
 * `past`, `limit` and `ceiling` are the shapes such a sentence takes in this repository.
 */
const STEP_BUDGET = /\b(?:budget|grow\w*|at most|past|limit|ceiling)\b/i;

/** @param {DriftEnvironment} env @returns {string[]} */
function checkVerifySteps(env) {
  const real = env.verifySteps;
  // Nothing to compare against. Reporting every step count in the repository as a
  // finding because one derived value is missing is the crying-wolf outcome the header
  // of this file warns about, so the absence is silence rather than a failure.
  if (real === null) return [];
  return eachLine(env, (document, line) => {
    if (!/\bverify\b/.test(line) || STEP_BUDGET.test(line)) return [];
    const claim = STEP_CLAIM.exec(line);
    if (claim === null) return [];
    const quoted = (claim[1] ?? '').toLowerCase();
    const stated = /^\d+$/.test(quoted) ? Number(quoted) : STEP_WORDS.indexOf(quoted);
    if (stated === real) return [];
    return [
      `${document.path}: says \`pnpm verify\` chains ${claim[1] ?? ''} steps, and ` +
        `\`package.json\` chains ${String(real)}. A count printed in prose is a copy, and the ` +
        '`verify` script moves every time a step is added or removed.',
    ];
  });
}

// ── Deriving the truth ──────────────────────────────────────────────────────

/**
 * Gathers the facts the detectors compare against, from the code rather than from
 * a list written beside it.
 *
 * @param {string} root
 * @param {(relative: string) => string} read a file's contents, `''` when absent
 * @param {() => string[]} files every tracked path, repository-relative
 * @param {Set<string>} rootScripts
 * @param {Array<{ id: string, capability: string, status: string }>} registerRows
 * @returns {DriftEnvironment}
 */
export function collectDriftEnvironment(root, read, files, rootScripts, registerRows) {
  return {
    documents: driftDocuments(read, files),
    rootScripts,
    registerRows,
    realPorts: derivePorts(read),
    knownEnvVars: deriveEnvVars(read, files),
    adrNumbers: deriveAdrNumbers(files),
    coverageFloors: deriveCoverageFloors(read),
    verifySteps: deriveVerifySteps(read),
    // A prefix test, so `[packages/config](packages/config)` — how a document
    // points at a package — resolves. A file list knows only files, and a document
    // pointing at a directory is not a broken link.
    fileExists: (relative) => {
      const clean = relative.replaceAll('\\', '/').replace(/\/$/, '');
      return files().some((file) => file === clean || file.startsWith(`${clean}/`));
    },
  };
}

/**
 * The documents a reader is told to trust: the four front doors, everything under
 * `docs/`, and the site.
 *
 * @param {(relative: string) => string} read
 * @param {() => string[]} files
 * @returns {Document[]}
 */
function driftDocuments(read, files) {
  return files()
    .filter((file) => file.endsWith('.md'))
    .filter((file) => !file.startsWith(GENERATED_PAGES))
    .filter((file) => FRONT_DOORS.has(file) || file.startsWith('docs/') || file.startsWith('site/'))
    .filter((file) => !HISTORICAL_DOCS.has(file))
    .filter((file) => !SUPERSEDED_DOCS.has(file))
    .sort()
    .map((file) => ({ path: file, text: read(file) }));
}

/**
 * Every package's recorded coverage floor, as `statements/branches/functions/lines`.
 *
 * Rounded rather than floored, because a document prints whole numbers and a floor
 * printed as `94` when the file says `94.6` reads as a defect that does not exist.
 * The rounding is here, in the one place that reads the file, so a document has to
 * match *this* and not a rule it cannot see.
 *
 * A package marked `not_configured` has no numbers to quote and is absent from the
 * map, which makes the detector skip it rather than report a tuple it never had.
 *
 * @param {(relative: string) => string} read
 * @returns {Map<string, string>}
 */
function deriveCoverageFloors(read) {
  /** @type {Map<string, string>} */
  const floors = new Map();
  const baseline = read('coverage-baseline.json');
  if (baseline === '') return floors;
  for (const [pkg, recorded] of Object.entries(JSON.parse(baseline))) {
    if (typeof recorded !== 'object' || recorded === null) continue;
    const tuple = ['statements', 'branches', 'functions', 'lines'].map((metric) => {
      const value = recorded[metric];
      return typeof value === 'number' ? String(Math.round(value)) : null;
    });
    if (tuple.every((part) => part !== null))
      floors.set(pkg, /** @type {string[]} */ (tuple).join('/'));
  }
  return floors;
}

/**
 * How many `&&`-joined steps the root `verify` script chains.
 *
 * Split rather than counted, so the count is the script's own structure: a step added
 * as `pnpm x && pnpm y` is one more step and a script someone edits by hand is the same
 * shape. `null` when `package.json` cannot be read or declares no `verify`, which is what
 * makes the detector inert rather than wrong on a repository that has neither.
 *
 * @param {(relative: string) => string} read
 * @returns {number | null}
 */
function deriveVerifySteps(read) {
  const manifest = read('package.json');
  if (manifest === '') return null;
  const chain = /** @type {{ scripts?: Record<string, unknown> }} */ (JSON.parse(manifest)).scripts
    ?.verify;
  if (typeof chain !== 'string') return null;
  const steps = chain
    .split('&&')
    .map((step) => step.trim())
    .filter((step) => step !== '');
  return steps.length;
}

/**
 * The ports this repository binds, read out of the places that decide them.
 *
 * Three sources because there are three: `packages/config` owns the API's default,
 * `playwright.config.ts` owns what the E2E suite proves, and the compose file owns
 * what a self-hosted install publishes on the host. A hardcoded list here would be a
 * fourth place for the value to be wrong, and the symptom would be a document
 * corrected to match a checker rather than to match the code.
 *
 * @param {(relative: string) => string} read
 * @returns {Set<string>}
 */
function derivePorts(read) {
  const ports = new Set();
  const config = read('packages/config/src/config.ts');
  const playwright = read('playwright.config.ts');
  // The web dev port moved here when the installation key's two disagreeing copies were
  // merged: `e2e/support/config.ts` became the one place that says where the browser
  // goes, and `WEB_BASE` carries the port. Reading only `playwright.config.ts` left the
  // real port out of the derived set — which the `ports` detector then reported against
  // the README and the getting-started page, in a document that was right. The detector
  // was correct and the derivation was stale, which is the shape of failure this
  // repository prefers to have.
  const e2eConfig = read('e2e/support/config.ts');
  const compose = read('docker-compose.unified.yml');
  for (const source of [config, playwright]) {
    for (const match of source.matchAll(/\b(?:DEFAULT_PORT|apiPort|webPort)\s*=\s*(\d{2,5})\b/g)) {
      ports.add(match[1] ?? '');
    }
  }
  for (const match of e2eConfig.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})/g)) {
    ports.add(match[1] ?? '');
  }
  // `127.0.0.1:55432:5432` — the host port a document may name, and the container
  // port a `DATABASE_URL` inside the compose network uses. Both are real.
  for (const match of compose.matchAll(/:(\d{2,5}):(\d{2,5})\b/g)) {
    ports.add(match[1] ?? '');
    ports.add(match[2] ?? '');
  }
  return new Set([...ports].filter((port) => port !== ''));
}

/**
 * Every environment variable name that is real: declared in the config schema, read
 * from `process.env` anywhere in the workspace, or set by the compose file.
 *
 * The union matters. Reading only `packages/config` — which is what the roadmap
 * asked for — reports every variable the product reads directly rather than through
 * the config, and a checker that cries wolf about those is switched off.
 *
 * @param {(relative: string) => string} read
 * @param {() => string[]} files
 * @returns {Set<string>}
 */
function deriveEnvVars(read, files) {
  const names = new Set();
  for (const name of configVocabulary(read)) names.add(name);
  for (const file of files()) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const source = read(file);
    // Two shapes, because the workspace uses two. Most settings are read as
    // `process.env['X']`; Sentry's are named in a `const` map and looked up by key
    // afterwards, which is the better shape and is why the first version of this
    // collector missed `SENTRY_DSN` and reported it as undeclared.
    for (const match of source.matchAll(
      /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g,
    )) {
      names.add(match[1] ?? match[2] ?? '');
    }
    for (const match of source.matchAll(/:\s*'([A-Z][A-Z0-9_]*)'/g)) {
      names.add(match[1] ?? '');
    }
    // And every name the workspace exports. A document citing
    // `MIGRATION_ADVISORY_LOCK_KEY` as evidence for a decision is naming something
    // that exists, which is the opposite of the claim this detector makes, and the
    // first version of it reported that citation as an undeclared setting.
    for (const match of source.matchAll(
      /export (?:declare )?(?:const|function|class|interface|type|enum|let)\s+([A-Z][A-Z0-9_]*)/g,
    )) {
      names.add(match[1] ?? '');
    }
  }
  for (const match of read('docker-compose.unified.yml').matchAll(/^\s+([A-Z][A-Z0-9_]+):/gm)) {
    names.add(match[1] ?? '');
  }
  return new Set([...names].filter((name) => name !== ''));
}

/**
 * Every upper-case name `packages/config` defines or exports.
 *
 * The config schema keys, the constants the schema is built from, and the variables
 * the placeholder check knows about. A document naming `SECRET_MIN_LENGTH` is
 * naming something that exists in the module that defines what a setting is, which
 * is exactly the claim being made — so the module is the source of truth rather
 * than the schema object alone.
 *
 * @param {(relative: string) => string} read
 * @returns {Set<string>}
 */
function configVocabulary(read) {
  const names = new Set();
  for (const file of ['packages/config/src/config.ts', 'packages/config/src/index.ts']) {
    const source = read(file);
    for (const match of source.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)) names.add(match[1] ?? '');
    for (const match of source.matchAll(
      /export const ([A-Z][A-Z0-9_]+)|^\s*([A-Z][A-Z0-9_]+):\s*\[/gm,
    )) {
      names.add(match[1] ?? match[2] ?? '');
    }
  }
  return names;
}

/**
 * The ADR numbers that have a record.
 *
 * From `docs/adr/` filenames, which is the only place a number is *claimed*. An
 * empty set is the honest answer for a repository with no register — and it makes
 * every `ADR-nnn` in prose a finding rather than a warning nobody reads.
 *
 * @param {() => string[]} files
 * @returns {Set<string>}
 */
function deriveAdrNumbers(files) {
  return new Set(
    files()
      .filter((file) => file.startsWith('docs/adr/') && file.endsWith('.md'))
      .map((file) => /(\d{3})/.exec(file.split('/').pop() ?? '')?.[1] ?? '')
      .filter((number) => number !== ''),
  );
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/**
 * The lines of a document, with fenced code blocks and quoted runs removed.
 *
 * Both removals are for the same reason, and it is the reason the unused-claim gate
 * in `docs-paths.test.mjs` removes them: a document has to be able to write down
 * what is wrong without the gate reporting the quotation as the claim.
 *
 * Two details that were defects in the first version:
 *
 *   - **Split first, strip second.** A quote stripper applied to the whole document
 *     pairs an apostrophe in one line with a quotation mark in a later one and
 *     deletes everything between, which *joins* the surrounding lines into a sentence
 *     that was never written — and then checks the joined sentence. The first
 *     version reported a WebSocket claim in an ADR whose line said the opposite,
 *     because a `"` in line 12 matched a `'` in line 40.
 *   - **No apostrophe as a quote character.** English prose is full of them, and a
 *     pattern that treats `'` as a delimiter removes more than it quotes.
 *
 * @param {string} text
 * @returns {string[]}
 */
function lines(text) {
  return text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '))
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/~~[^~]*~~/g, ' ')
        .replace(/“[^”]*”/g, ' ')
        .replace(/"[^"]*"/g, ' '),
    );
}
