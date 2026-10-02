/**
 * The twelve points, as a measurement rather than an assertion.
 *
 * **It is a gate now.** It was a measurement until 2026-10-01, when its last `fail` was
 * closed by writing `e2e/product/durable-path.spec.ts`. The distinction that survives
 * is not "measurement" versus "gate" — it is what each verdict is *derived from*. Every
 * clause here reads committed files. None of them runs anything, which is why a claim
 * whose proof is a command is `not_configured` and never `pass`: this script cannot
 * watch a gate run, and a clause that reported one would be reporting a number it never
 * measured.
 *
 * The roadmap this repository grew ends with §17 "Definition of done": twelve
 * falsifiable statements about the product and the gates around it. Until now that
 * list was the one number in a repository whose whole thesis is *evidence over
 * assertion* that nothing measured — every other claim here has a command behind
 * it, and "10/10" had a plan section.
 *
 * **The rule this module implements is §5.3, and it is the whole design.** Every
 * clause resolves to exactly one of:
 *
 *   - `pass` — checked, and it held.
 *   - `fail` — checked, and it did not hold. Named.
 *   - `not_configured` — not checked, with a printed reason for *why* and for
 *     *which parts did run*.
 *
 * `not_configured` is a legitimate shippable state, not a defect and not a soft
 * pass. D15 says the site sells the evidence guarantee rather than the feature
 * count, and the register already ships honest `deferred` rows because of it. The
 * thing that must never exist is a `pass` with nothing behind it, so the design
 * pushes in the opposite direction from the usual instinct: **this module is built
 * so that it is much harder to report `pass` than `not_configured`.**
 *
 * Four consequences, each of which is a deliberate decision rather than a
 * limitation:
 *
 *   1. **A clause is a fact about committed files, never about a run.** Nothing here
 *      executes a gate, opens a database, or starts a browser. A claim that needs
 *      one is a `not_configured` clause naming the command that would decide it.
 *      This is what lets the generated site page be reproducible: a probe that
 *      depended on HEAD, on the working tree, or on a passing suite would make the
 *      committed page a snapshot of a moment rather than a statement about the code.
 *   2. **A point's verdict is its worst clause.** `fail` beats `not_configured`
 *      beats `pass`, so a point cannot be green because half of it was skipped.
 *   3. **A debt row converts a `fail` into a `not_configured`,** and records why.
 *      This is the one place the ledger reaches into the measurement, and it is
 *      what makes deferral honest rather than quiet: a deferred point stays visible,
 *      names the row, names the owner, and prints the checkable condition that would
 *      end the deferral. It is also the only mechanism by which a point can become
 *      `not_configured` without something being unmeasurable — a `not_configured`
 *      that is not about a deferral says *which run did not happen*.
 *   4. **Every point names a command or a file that decides it,** in `decidedBy`. The
 *      report is an index into the repository rather than a verdict of its own, so
 *      a reader can check any row without trusting this module.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ASSERTIONS, unimplemented } from './docs-drift.mjs';
import {
  auditRepository,
  readManifest,
  readRootScriptCommand,
  readRootScripts,
  referencedScripts,
  tierRegisterProblems,
} from './gate-tooling.mjs';

/** The three outcomes, in the order severity is reported. */
export const VERDICTS = ['fail', 'not_configured', 'pass'];

/**
 * The repository root, resolved from this module's own location.
 *
 * `import.meta.dirname` because the root package.json is `"type": "module"` and
 * `__dirname` does not exist in that scope — the same defect `playwright.config.ts`
 * carried, and the reason the E2E suite collected nothing before it was fixed.
 *
 * @returns {string}
 */
export function repoRoot() {
  return path.resolve(import.meta.dirname, '..', '..');
}

/**
 * @typedef {'pass' | 'fail' | 'not_configured'} Verdict
 */

/**
 * @typedef {object} Clause
 * @property {string} claim what this clause is about
 * @property {Verdict} verdict
 * @property {string} reason why, and what was checked
 */

/**
 * @typedef {object} Point
 * @property {number} number 1–12, the §17 order
 * @property {string} title the point, shortened
 * @property {string} decidedBy the command or file that decides it
 * @property {string} deferral the ledger row that may carry the point, or `''`
 * @property {(ctx: Context) => Clause[]} probe
 */

/**
 * @typedef {object} Context
 * @property {string} root
 * @property {(relative: string) => string} text  a file's contents, `''` when absent
 * @property {(relative: string) => unknown} json  parsed JSON, `null` when absent
 * @property {(relative: string) => boolean} has
 * @property {(relative: string) => string[]} files  `/`-separated paths under a directory
 * @property {Set<string>} rootScripts
 * @property {(name: string) => string} rootScriptCommand the command behind a root script
 * @property {Record<string, string>} tiers
 * @property {Array<Record<string, unknown>>} ledgerRows
 * @property {Array<{ id: string, status: string }>} registerRows
 * @property {string[]} workflowFindings
 * @property {string[]} tierFindings
 */

/** @param {string} claim @param {string} reason @returns {Clause} */
const ok = (claim, reason) => ({ claim, verdict: 'pass', reason });

/** @param {string} claim @param {string} reason @returns {Clause} */
const broken = (claim, reason) => ({ claim, verdict: 'fail', reason });

/** @param {string} claim @param {string} reason @returns {Clause} */
const unchecked = (claim, reason) => ({ claim, verdict: 'not_configured', reason });

/**
 * The reason every point shares about its own run, worded once.
 *
 * A separate `not_configured` clause per run would be twelve copies of the same
 * sentence, and the reason is not per-point anyway: `status:10` reads the tree and
 * does not execute gates, so a claim whose proof is a run is unmeasured here by
 * construction. Each point therefore says so on the clause that needs the run,
 * naming the command that would decide it — which is the part a reader needs.
 *
 * @param {string} command
 * @returns {string}
 */
const needsRun = (command) =>
  `\`${command}\` is the command that decides this; \`pnpm status:10\` reads committed files ` +
  'and does not execute a gate, so the run is not measured here.';

/**
 * `needsRun`, then a further sentence — with the full stop in one place.
 *
 * @param {string} command
 * @param {string} then
 * @returns {string}
 */
const needsRunThen = (command, then) => `${needsRun(command)} ${then}`;

// ── Facts ───────────────────────────────────────────────────────────────────

/**
 * Everything the probes read, gathered once and passed as a plain object.
 *
 * A plain object rather than module-level state so a test can point the same probes
 * at a fixture tree, and so a probe that needs a fact not collected here fails by
 * reading `undefined` rather than by quietly returning a plausible answer.
 *
 * @param {string} root
 * @returns {Context}
 */
export function loadContext(root) {
  /** @type {string[] | null} */
  let fileIndex = null;

  /** @param {string} relative */
  const read = (relative) => {
    const full = path.join(root, relative);
    return existsSync(full) ? readFileSync(full, 'utf8') : '';
  };

  /** @param {string} relative */
  const json = (relative) => {
    const source = read(relative);
    if (source === '') return null;
    try {
      return JSON.parse(source);
    } catch {
      return null;
    }
  };

  return {
    root,
    text: read,
    json,
    has: (relative) => existsSync(path.join(root, relative)),
    files(relative) {
      if (fileIndex === null) fileIndex = indexFiles(root);
      return fileIndex.filter((file) => file.startsWith(`${relative}/`));
    },
    rootScripts: readRootScripts(),
    rootScriptCommand: readRootScriptCommand,
    tiers: readManifest().tiers ?? {},
    ledgerRows: rowsOf(json('docs/quality/findings-ledger.json')),
    registerRows: registerRowsFrom(read('docs/migration/capability-register.md')),
    workflowFindings: auditRepository(),
    tierFindings: tierRegisterProblems(readManifest(), readRootScripts()),
  };
}

/**
 * Every tracked file under the repository root, as `/`-separated relative paths.
 *
 * Excludes the same four directories every other walker in `scripts/lib` excludes,
 * and `coverage/` for the fifth reason: it holds thousands of generated HTML
 * reports, and a probe looking for a source file must not find one of those first.
 *
 * @param {string} root
 * @param {string} [relative]
 * @returns {string[]}
 */
export function indexFiles(root, relative = '') {
  const base = relative === '' ? root : path.join(root, relative);
  if (!existsSync(base)) return [];
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage', '.git', '.turbo'].includes(entry.name)) continue;
    const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) found.push(...indexFiles(root, child));
    else found.push(child);
  }
  return found;
}

/**
 * The `findings` array of a ledger document, or `[]`.
 *
 * `@type` casts rather than validation: the ledger has its own shape gate in
 * `findings-check.mjs`, and a second validator here would be a second rule to keep
 * in agreement. A document this cannot read yields an empty list, which every
 * caller treats as *no rows* — and the probe that depends on it says so in its
 * reason rather than reporting a clean ledger.
 *
 * @param {unknown} ledger
 * @returns {Array<Record<string, unknown>>}
 */
function rowsOf(ledger) {
  const rows = /** @type {{ findings?: unknown }} */ (ledger)?.findings;
  return Array.isArray(rows) ? /** @type {Array<Record<string, unknown>>} */ (rows) : [];
}

/**
 * The register's `id`/`status` pairs.
 *
 * Parsed with the same tolerance as `capability-register.mjs` — a row it cannot
 * read is skipped rather than fatal — because this module's job is to report, and a
 * parser that refused to run would leave the point unchecked for the wrong reason.
 *
 * @param {string} source
 * @returns {Array<{ id: string, status: string }>}
 */
function registerRowsFrom(source) {
  /** @type {Array<{ id: string, status: string }>} */
  const rows = [];
  for (const line of source.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const [id, , status] = cells;
    if (id === undefined || !/^[a-z0-9][a-z0-9.-]*$/.test(id)) continue;
    rows.push({ id, status: status ?? '' });
  }
  return rows;
}

// ── The twelve ──────────────────────────────────────────────────────────────

/**
 * @param {Context} ctx
 * @returns {Clause[]}
 */
function pointOne(ctx) {
  return [
    ctx.workflowFindings.length === 0
      ? ok(
          'CI wiring is audited with no findings',
          `auditRepository() checked ${String(ctx.files('.github/workflows').length)} workflow file(s): ` +
            'every job has a timeout, every workflow a concurrency block, every tool-dependent ' +
            'script an install, and no `pr-blocking` gate is wrapped in `continue-on-error` or `|| true`.',
        )
      : broken(
          'CI wiring is audited',
          `${String(ctx.workflowFindings.length)} finding(s): ${ctx.workflowFindings.slice(0, 3).join(' | ')}`,
        ),
    ctx.tierFindings.length === 0
      ? ok(
          'every root script carries a tier',
          `${String(ctx.tiers && Object.keys(ctx.tiers).length)} tier(s) recorded in scripts/gate-tooling.json, ` +
            'and `verify` is inside its 20-step budget.',
        )
      : broken('every root script carries a tier', ctx.tierFindings.slice(0, 3).join(' | ')),
    unchecked(
      'no CI job is deterministically red',
      needsRunThen(
        'pnpm test:integration',
        'It runs `gate-tooling.test.mjs` over the committed workflows, which is the gate these clauses ' +
          're-read — the same `tierRegisterProblems` and `auditRepository` implementations, not copies.',
      ),
    ),
  ];
}

/**
 * @param {Context} ctx
 * @returns {Clause[]}
 */
function pointTwo(ctx) {
  const verify = referencedScripts(ctx.rootScriptCommand('verify'));
  const release = referencedScripts(ctx.rootScriptCommand('verify:release'));
  const untiered = verify.filter((name) => ctx.tiers[name] === undefined);
  const chained = release.includes('verify') && release.includes('oci:verify');

  return [
    ok(
      '`verify` exists and chains classified gates',
      `${String(verify.length)} step(s): ${verify.join(', ')}.`,
    ),
    untiered.length === 0
      ? ok(
          'every step `verify` chains carries a tier',
          'no step is unclassified in gate-tooling.json.',
        )
      : broken(
          'every step `verify` chains carries a tier',
          `unclassified: ${untiered.join(', ')}. An unclassified step is one whose blocking behaviour ` +
            'was decided by whoever happened to wire it.',
        ),
    chained
      ? ok(
          '`verify:release` chains `verify` and `oci:verify`',
          'the release gate is the verify chain plus the images.',
        )
      : broken(
          '`verify:release` chains `verify` and `oci:verify`',
          `it chains: ${release.join(', ') || '(nothing)'}.`,
        ),
    unchecked('`verify` and `verify:release` complete', needsRun('pnpm verify:local')),
  ];
}

/**
 * @param {Context} ctx
 * @returns {Clause[]}
 */
function pointThree(ctx) {
  const config = ctx.text('playwright.config.ts');
  const durable = ctx.files('e2e').filter((file) => file.endsWith('durable-path.spec.ts'));
  const stages = [
    'migrate',
    'authenticate',
    'enqueue',
    'runner',
    'stream',
    'evidence',
    'cancel',
    'lease',
    'gate',
  ];
  const covered = durable.filter((file) => {
    const source = ctx.text(file).toLowerCase();
    return stages.filter((stage) => source.includes(stage)).length === stages.length;
  });

  return [
    durable.length === 0
      ? broken(
          'a spec walks the durable chain',
          'no `e2e/**/durable-path.spec.ts`. The chain §17 names is migrate → authenticate → enqueue ' +
            '→ execute worker→runner → stream durable events → normalized evidence → cancel/retry → ' +
            'lost-lease recovery → release gate. **The chain has been walked** — running the existing ' +
            'E2E suite against a real PostgreSQL found and fixed seven defects, six of them blockers ' +
            '(ledger DB-1, DB-2, E2E-1, E2E-2, RUN-1, RUN-2, RUN-3), and 12 of the 19 tests now pass. ' +
            'What is missing is the single named artefact, and seven dashboard-rendering tests are ' +
            'still red (ledger E2E-3). This clause is about the artefact, not about the path.',
        )
      : ok('a spec walks the durable chain', `${durable.join(', ')}.`),
    covered.length === durable.length && durable.length > 0
      ? ok(
          'the spec names every stage of the chain',
          `all ${String(stages.length)} stages appear in ${covered.join(', ')}.`,
        )
      : broken(
          'the spec names every stage of the chain',
          `missing stages: ${
            durable.length === 0
              ? '(no spec to read)'
              : stages
                  .filter(
                    (stage) =>
                      !covered.some((file) => ctx.text(file).toLowerCase().includes(stage)),
                  )
                  .join(', ')
          }.`,
        ),
    /DATABASE_URL[\s\S]{0,400}throw new Error/.test(config)
      ? ok(
          'the suite refuses to run without PostgreSQL',
          '`playwright.config.ts` throws when `DATABASE_URL` is absent and `E2E_ALLOW_IN_MEMORY` is not set, ' +
            'so an absent database is a configuration error rather than a silent in-memory pass.',
        )
      : broken(
          'the suite refuses to run without PostgreSQL',
          '`playwright.config.ts` has no throw beside its `DATABASE_URL` read, so the in-memory store is ' +
            'reachable on the E2E path.',
        ),
    unchecked('the chain is proven by a required run', needsRun('pnpm test:e2e')),
  ];
}

/**
 * @param {Context} ctx
 * @returns {Clause[]}
 */
function pointFour(ctx) {
  const axe = ctx.files('e2e').filter((file) => /axe|accessib/i.test(file));
  const routes = ctx.files('apps/web/src/routes').filter((file) => file.endsWith('.tsx'));

  return [
    axe.length > 0
      ? ok('an accessibility check runs against the routes', `${axe.join(', ')}.`)
      : broken(
          'an accessibility check runs against the routes',
          'no accessibility spec under `e2e/`. `expectNoBlockingAxeViolations` exists in `apps/web` and is ' +
            'used by one component test, so a route that regresses is not covered.',
        ),
    unchecked(
      `axe zero serious/critical on every one of ${String(routes.length)} route file(s), in both themes`,
      needsRunThen(
        'pnpm test:e2e',
        '`@axe-core/playwright` is a devDependency and needs a browser and a running web server, neither of ' +
          'which this probe starts.',
      ),
    ),
    unchecked(
      'every route has loading, empty, error and partial states',
      'no state-coverage matrix exists. Naming a matrix as the evidence would be asserting the thing ' +
        'that is missing; the artefact to build is the matrix itself.',
    ),
  ];
}

/**
 * @param {Context} ctx
 * @returns {Clause[]}
 */
function pointFive(ctx) {
  const complexity = /** @type {{ ceiling?: unknown, worst?: unknown }} */ (
    ctx.json('docs/quality/complexity-baseline.json')
  );
  const ceiling = typeof complexity?.ceiling === 'number' ? complexity.ceiling : null;
  const worst = typeof complexity?.worst === 'number' ? complexity.worst : null;
  const mutation = ctx.has('mutation-baseline.json');
  const propertyTests = ctx
    .files('packages')
    .concat(ctx.files('apps'))
    .filter((file) => /\.(test|spec)\.tsx?$/.test(file) && /property|fuzz/i.test(file));
  const authz = ctx.files('docs').filter((file) => /authz/i.test(file));
  const perf = /** @type {{ recorded?: unknown }} */ (ctx.json('performance/thresholds.json'));

  return [
    ceiling !== null && ceiling <= 10
      ? ok(
          'complexity ceiling is at most 10',
          `docs/quality/complexity-baseline.json records ${String(ceiling)}.`,
        )
      : broken(
          'complexity ceiling is at most 10',
          `the recorded ceiling is ${ceiling === null ? 'absent' : String(ceiling)}` +
            `${worst === null ? '' : `, and the worst function measured is ${String(worst)}`}. §17 names 10.`,
        ),
    unchecked('duplication is at most 3% on changed code', needsRun('pnpm duplication')),
    mutation
      ? ok('a mutation baseline with a ratchet exists', 'mutation-baseline.json is committed.')
      : broken(
          'mutation is at least 75% on the five core packages',
          'no `mutation-baseline.json`, so no score has ever been recorded and nothing ratchets it. A ' +
            'number nobody has measured is not a 0% score and not a pass.',
        ),
    propertyTests.length > 0
      ? ok('property or fuzz suites exist', propertyTests.join(', '))
      : broken(
          'property or fuzz suites cover the stated invariants',
          'no property or fuzz suite exists in any package.',
        ),
    authz.length > 0
      ? ok('an authz matrix is generated from the app', authz.join(', '))
      : broken(
          'the authz matrix is generated from the application',
          'no generated authz matrix exists.',
        ),
    perf?.recorded === true
      ? ok(
          'every performance budget is measured in CI',
          'performance/thresholds.json records a run.',
        )
      : broken(
          'every performance budget is measured in CI',
          '`performance/thresholds.json` has no recorded measurement, so the k6 p95/p99 thresholds are ' +
            'estimates being compared against nothing. Ledger RF-9 tracks this.',
        ),
  ];
}

/**
 * @param {Context} ctx
 * @returns {Clause[]}
 */
function pointSix(ctx) {
  const context = ctx.text('apps/api/src/observability/request-context.ts');
  const logger = ctx.text('apps/api/src/observability/logger.ts');
  const health = ctx.text('apps/api/src/routes/health.ts');
  const runs = ctx.text('apps/api/src/routes/execution/runs.routes.ts');
  const gate = ctx.text('apps/api/src/execution/quality-gate.ts');
  const metricsRoute = health.includes("health.get('/metrics'");
  const metricsBody = ctx.text('apps/api/src/observability/metrics.ts');
  const metricsDeclared =
    metricsBody.includes('PROMETHEUS_CONTENT_TYPE') && metricsBody.includes('renderExposition');

  // The four things a "why did this verdict happen?" answer has to carry, checked
  // against the two files that produce them rather than against a route *named*
  // `diagnostics`. A first version looked for a file whose name matched, and
  // reported the point as failing while the surface existed and answered the
  // question — which is the "detector that finds a word is a detector that reports
  // itself" mistake, committed by the module written to prevent it.
  //
  // Each field is required in `quality-gate.ts`, which builds the evaluation; the
  // route's job is to return it, which it does by spreading the whole object, so
  // requiring the field name in the route as well would be requiring a field list
  // that has to be kept in step with the type — a second copy of the contract, in
  // the file most likely to be edited by someone adding a field.
  const diagnosticFields = /** @type {Array<[string, RegExp]>} */ ([
    ['the rule that fired', /\breasons\b/],
    ['the evidence behind it', /\bevidenceRefs\b/],
    ['a per-domain status', /\bdomainStatuses\b/],
    ['the policy that decided it', /\bpolicyHash\b/],
  ]).filter(([, pattern]) => !pattern.test(gate));
  const gateRoute =
    runs.includes("app.get('/api/v1/runs/:runId/gate'") &&
    /\.\.\.evaluation|\.\.\.recorded/.test(runs);

  return [
    /export function requestContext|export const requestContext/.test(context) &&
    /requestContext|requireRequestId/.test(ctx.text('apps/api/src/index.ts'))
      ? ok(
          'one correlation id is created at the edge and carried by the process',
          '`apps/api/src/observability/request-context.ts` exports the context and `index.ts` requires ' +
            'the id, so a log line and an error body carry the same value.',
        )
      : broken(
          'one correlation id is created at the edge and carried by the process',
          '`request-context.ts` does not export a request context, or `index.ts` does not use it.',
        ),
    /export interface LogRecord/.test(logger)
      ? ok(
          'the log schema is documented with the type that enforces it',
          '`apps/api/src/observability/logger.ts` declares `LogRecord` with a field comment per key, so ' +
            'the documented schema and the enforced one cannot drift.',
        )
      : broken(
          'the log schema is documented with the type that enforces it',
          '`logger.ts` does not declare a `LogRecord` interface.',
        ),
    health.includes("health.get('/ready'") && health.includes("health.get('/api/v1/ready'")
      ? ok(
          'health and readiness are separate and honest',
          '`/ready` reports the store’s own degraded dependencies, not only whether a socket answers.',
        )
      : broken(
          'health and readiness are separate and honest',
          '`apps/api/src/routes/health.ts` does not mount both readiness paths.',
        ),
    metricsRoute && metricsDeclared
      ? ok(
          'a metrics endpoint exists',
          '`GET /metrics` serves the Prometheus text exposition format with the version in the content ' +
            'type, from `apps/api/src/observability/metrics.ts` and no metrics library. The content ' +
            'decision is the substance and is carried by the register row `ops.metrics-endpoint`: ' +
            'process state and one in-memory counter, no run, test, suite, artifact or tenant data, ' +
            'and no database query. Ledger O-4b records why the first increment does not carry queue ' +
            'depth.',
        )
      : broken(
          'a metrics endpoint exists',
          metricsRoute
            ? '`/metrics` is mounted but `apps/api/src/observability/metrics.ts` does not render the ' +
                'exposition format with a declared content type.'
            : 'no route serves `GET /metrics`. Ledger O-4b tracks the absence, including the search ' +
                'that evidenced it.',
        ),
    gateRoute && diagnosticFields.length === 0
      ? ok(
          'a run-diagnostics surface answers why a verdict happened',
          '`GET /api/v1/runs/:runId/gate` is the surface, and the equivalence is deliberate: the gate ' +
            'evaluation *is* the diagnosis. It returns the recorded verdict or the provisional one with ' +
            '`recorded: false`, and carries ' +
            'reasons (a `code; rule=…; observed=…; threshold=…` tail, so the rule and both numbers ' +
            'that were compared are readable without a parser), evidenceRefs, per-domain statuses, and ' +
            'the policy version and hash. A separate `/diagnostics` route would answer the same ' +
            'question from the same row.',
        )
      : broken(
          'a run-diagnostics surface answers why a verdict happened',
          gateRoute
            ? `the gate evaluation does not carry: ${diagnosticFields.map(([name]) => name).join(', ')}.`
            : 'no route returns a gate evaluation, so "why did this verdict happen?" has no answer in ' +
                'the product.',
        ),
    unchecked('the instrumented product runs', needsRun('pnpm test:runner')),
  ];
}

/**
 * @param {Context} ctx
 * @returns {Clause[]}
 */
function pointSeven(ctx) {
  const register = ctx.text('docs/migration/capability-register.md');
  // A row is a line of the register's table, so a row that names a command is a
  // line that mentions one. Splitting on the id and reading the rest of the line
  // works too, and did first, but it depends on the id appearing exactly once in
  // the document — true today and not a property of the format.
  const rowLines = register
    .split(/\r?\n/)
    .filter((line) => /^\|\s*[a-z0-9][a-z0-9.-]*\s*\|/.test(line));
  const withCommand = rowLines.filter((line) => /\|[^|]*\bpnpm [^|]*\|/.test(line));
  const script = ctx.rootScripts.has('capability:evidence');

  return [
    rowLines.length > 0 && withCommand.length === rowLines.length
      ? ok(
          'every register row names a passing evidence command',
          `${String(rowLines.length)} row(s) carry a command in the evidence column.`,
        )
      : broken(
          'every register row names a passing evidence command',
          `${String(rowLines.length - withCommand.length)} of ${String(rowLines.length)} row(s) cite ` +
            'paths rather than a command. A path is evidence that something exists; a command is evidence ' +
            'that it still passes.',
        ),
    script
      ? ok('`capability:evidence` exists', 'deleting a test flips its row to `unverified`.')
      : broken(
          '`capability:evidence` exists',
          'no such root script, so nothing maps a register row onto the test that would fail if the ' +
            'capability stopped working.',
        ),
  ];
}

/**
 * @param {Context} ctx
 * @returns {Clause[]}
 */
function pointEight(ctx) {
  const vault = ctx.text('apps/api/src/infrastructure/vault-crypto.ts');
  const tests = ctx.text('apps/api/src/infrastructure/vault-crypto.test.ts');
  const bound = /function aadFor/.test(vault) && /setAAD/.test(vault);
  const proved = /aadFor/.test(tests) && /(fails|reject|throw)/i.test(tests);

  return [
    bound
      ? ok(
          'the vault binds ciphertext to row identity',
          '`aadFor` builds length-prefixed AAD and both `createCipheriv` and `createDecipheriv` set it, so ' +
            "one row's ciphertext cannot be opened as another's.",
        )
      : broken(
          'the vault binds ciphertext to row identity',
          '`vault-crypto.ts` sets no AAD, so a sealed row is readable in any row position.',
        ),
    proved
      ? ok(
          'a test proves the binding fails closed',
          '`vault-crypto.test.ts` asserts two bindings differ and that a wrong AAD fails rather than ' +
            'returning wrong data.',
        )
      : broken(
          'a test proves the binding fails closed',
          '`vault-crypto.test.ts` does not assert that a mismatched AAD fails.',
        ),
    unchecked(
      'the evidence and audit chain is complete and immutable',
      'No machine check distinguishes an append-only audit chain from a mutable one. `scripts/lib/` has the ' +
        'sha256 chain used by the secret scanner, and the product audit chain is asserted per route rather ' +
        'than as a property of the store.',
    ),
  ];
}

/**
 * @param {Context} ctx
 * @returns {Clause[]}
 */
function pointNine(ctx) {
  const migrations = ctx.files('packages/db/drizzle').filter((file) => file.endsWith('.sql'));
  // Two categories, because they are different claims. A `DROP TABLE` loses rows and
  // must be guarded by a row-count refusal; an `ALTER COLUMN … TYPE` rewrites the
  // column and loses nothing, so calling it destructive would put a rewrite and a
  // drop on the same list and make the guarded ones look like the risky half.
  const drops = migrations.filter((file) => /DROP TABLE|DROP COLUMN/i.test(ctx.text(file)));
  const rewrites = migrations.filter((file) => /ALTER COLUMN[^\n]*\bTYPE\b/i.test(ctx.text(file)));
  const guarded = drops.filter((file) => /RAISE EXCEPTION/.test(ctx.text(file)));
  const backlog = ctx.text('docs/quality/schema-migration-backlog.md');
  const unrecorded = drops
    .concat(rewrites)
    .filter((file) => !backlog.includes(path.basename(file)));
  const migrate = ctx.text('packages/db/src/migrate.ts');

  return [
    unrecorded.length === 0
      ? ok(
          'every destructive statement is guarded or written down',
          `${String(drops.length)} drop(s) and ${String(rewrites.length)} type rewrite(s); ` +
            `${String(guarded.length)} drop(s) guard against held rows, and all of them are recorded in ` +
            'docs/quality/schema-migration-backlog.md.',
        )
      : broken(
          'every destructive statement is guarded or written down',
          backlog.trim() === ''
            ? 'docs/quality/schema-migration-backlog.md does not exist, so no drop or type rewrite is ' +
                'recorded. The graph has ' +
                `${String(drops.length)} drop(s) and ${String(rewrites.length)} type rewrite(s).`
            : `unrecorded: ${unrecorded.join(', ')}. ${String(guarded.length)} of ` +
                `${String(drops.length)} drop(s) guard against held rows with a ` +
                '`RAISE EXCEPTION` row count; a drop with no guard and no written-down reason is the ' +
                'shape of a migration that can lose data silently.',
        ),
    /pg_advisory_lock/.test(migrate) && /isDirectInvocation/.test(migrate)
      ? ok(
          'concurrent applies serialize, and the CLI entry guard works off Windows and through symlinks',
          '`packages/db/src/migrate.ts` takes `pg_advisory_lock` and resolves its entry point with ' +
            '`isDirectInvocation` rather than comparing `process.argv[1]` to `import.meta.url`.',
        )
      : broken(
          'concurrent applies serialize, and the CLI entry guard works off Windows and through symlinks',
          '`packages/db/src/migrate.ts` takes no advisory lock, or still compares `process.argv[1]` to its ' +
            'own URL, which is false on Windows and through a symlinked bin.',
        ),
    unchecked(
      'the migration graph is proven on a real database',
      needsRun('pnpm migrate:validate'),
    ),
  ];
}

/**
 * @param {Context} ctx
 * @returns {Clause[]}
 */
function pointTen(ctx) {
  const drift = ctx.has('scripts/lib/docs-drift.mjs');
  const assertions = drift ? ASSERTIONS.length : 0;
  const implemented = drift ? assertions - unimplemented().length : 0;
  const run = ctx.rootScriptCommand('docs:check');

  return [
    implemented === assertions && assertions > 0
      ? ok(
          `all ${String(assertions)} anti-drift assertions have a detector`,
          'links, commands, ports, environment variables, transports, capability claims and ADR ' +
            'references, each a function in `scripts/lib/docs-drift.mjs` rather than a keyword.',
        )
      : broken(
          'every anti-drift assertion has a detector',
          drift
            ? `unimplemented: ${unimplemented().join(', ')} — ${String(implemented)} of ` +
                `${String(assertions)} declared.`
            : 'scripts/lib/docs-drift.mjs does not exist, so the assertions are prose in a plan.',
        ),
    run.includes('docs-drift')
      ? ok(
          '`pnpm docs:check` runs them',
          '`docs:check` includes `scripts/lib/docs-drift.test.mjs`.',
        )
      : broken(
          '`pnpm docs:check` runs them',
          `\`docs:check\` runs \`${run || '(nothing)'}\`, so the detectors are not in the gate.`,
        ),
    unchecked('`pnpm docs:check` is green', needsRun('pnpm docs:check')),
  ];
}

/**
 * @param {Context} ctx
 * @returns {Clause[]}
 */
function pointEleven(ctx) {
  const command = ctx.rootScriptCommand('review:pr');
  const blocking = ctx.ledgerRows.filter(
    (row) => row.status === 'open' && (row.band === 'Blocker' || row.band === 'Critical'),
  );

  return [
    command === ''
      ? broken(
          '`pnpm review:pr --base main` exists',
          'no such root script. `review:rules` is the engine; nothing runs it against a diff.',
        )
      : ok(
          '`pnpm review:pr --base main` exists',
          `it runs \`${command}\`, so a merge gate can name its base.`,
        ),
    blocking.length === 0
      ? ok('the ledger carries no open Blocker or Critical', 'every row is fixed, debt or refuted.')
      : broken(
          'the ledger carries no open Blocker or Critical',
          blocking
            .map((row) => `${String(row.id)} (${String(row.band)}): ${String(row.title)}`)
            .join(' | '),
        ),
    unchecked('the gate runs against a diff', needsRun('pnpm review:pr --base main')),
  ];
}

/**
 * @param {Context} ctx
 * @returns {Clause[]}
 */
function pointTwelve(ctx) {
  const adrIndex = ctx.has('docs/adr/README.md');
  const doctor = ctx.rootScripts.has('site:doctor');
  const quickstart = ctx.text('site/guide/getting-started.md');
  const adrNumbers = ctx
    .files('docs/adr')
    .filter((file) => file.endsWith('.md') && file !== 'docs/adr/README.md')
    .map((file) => /^\d{3}/.exec(path.basename(file))?.[0] ?? path.basename(file));
  const collided = adrNumbers.filter((n, i) => adrNumbers.indexOf(n) !== i);
  // The governance clause reads `site:doctor`'s own check 10 rather than keeping a
  // second list of the same files here. Two lists of the governance set are two places
  // for it to be wrong, and a list that is right in one place and stale in the other
  // makes the measurement disagree with the gate it is supposed to summarise.
  const doctorSource = ctx.text('scripts/site-doctor.mjs');
  const governanceDeclared = doctor && /checkGovernanceAndLabelling/.test(doctorSource);
  const governanceNow = governanceDeclared
    ? [
        'SECURITY.md',
        'CODE_OF_CONDUCT.md',
        'SUPPORT.md',
        'CONTRIBUTING.md',
        'LICENSE',
        '.github/CODEOWNERS',
      ].filter((file) => !ctx.has(file))
    : ['(site:doctor check 10 has not been read)'];

  return [
    doctor
      ? ok('`site:doctor` exists', 'the ten site checks are a script rather than a checklist.')
      : broken(
          '`site:doctor` exists',
          'no such root script, so the ten site-doctor checks are a list in a plan rather than a gate.',
        ),
    /(?:10[- ]minute|ten[- ]minute|\b10 minutes?\b|\bten minutes\b)/i.test(quickstart)
      ? ok(
          'the site carries a timed quickstart',
          'site/guide/getting-started.md opens with a budget, a step table with a clock for each ' +
            'step, and a sentence saying what to do when a step does not do what its column says. A ' +
            'reader can tell whether it is followable, which is the whole point of a budget.',
        )
      : broken(
          'the site carries a timed quickstart',
          'site/guide/getting-started.md names no duration, so a reader cannot tell whether it is ' +
            'followable or merely long.',
        ),
    adrIndex && collided.length === 0
      ? ok(
          'an ADR index exists and its numbers do not collide',
          `docs/adr/README.md indexes ${String(adrNumbers.length)} record(s).`,
        )
      : broken(
          'an ADR index exists and its numbers do not collide',
          adrIndex
            ? `duplicate ADR numbers: ${[...new Set(collided)].join(', ')}.`
            : 'docs/adr/ does not exist. The architecture decisions are prose in docs/architecture/ with no ' +
                'record, no status and no index.',
        ),
    governanceNow.length === 0
      ? ok(
          'the governance set is complete',
          '`pnpm site:doctor` check 10, which is the authority: a disclosure path with a response ' +
            'window, a conduct file, a support file distinguishing a bug from a capability request, ' +
            'a contributing file, a licence, and a CODEOWNERS mapped to the eleven personas in ' +
            '`.github/agents/`. This clause reads that check rather than restating its list.',
        )
      : broken(
          'the governance set is complete',
          `missing: ${governanceNow.join(', ')}. \`pnpm site:doctor\` check 10 is the authority and ` +
            'names the same files.',
        ),
    unchecked(
      'the site is live and passes its ten checks',
      '`pnpm --filter @automate/docs build` then `SITE_DOCTOR_BUILT=1 pnpm site:doctor` decides it, and ' +
        'https://sergey-bar.github.io/AutoMate/ is the address it would decide. Nothing here reaches ' +
        'the network — a check that needs one fails on a firewall and gets switched off — and three ' +
        'of the ten report `GAP` without that build rather than reporting clean.',
    ),
  ];
}

/**
 * The twelve, in §17 order.
 *
 * `deferral` is the ledger row that may carry the point. A point whose failed
 * clauses are all covered by a `debt` row with an owner and a removal condition is
 * reported `not_configured` rather than `fail` — which is the mechanism that makes
 * deferral visible instead of quiet, and the reason Track 4 of the closing plan
 * changes this module's output rather than only a document.
 */
export const POINTS = /** @type {readonly Point[]} */ ([
  {
    number: 1,
    title: 'Every gate passes, fails, or says not_configured; no CI job is deterministically red',
    decidedBy: 'pnpm test:integration',
    deferral: '',
    probe: pointOne,
  },
  {
    number: 2,
    title: '`pnpm verify` and `pnpm verify:release` complete',
    decidedBy: 'pnpm verify:local',
    deferral: '',
    probe: pointTwo,
  },
  {
    number: 3,
    title: 'The durable path is proven by a required E2E, with no in-memory store',
    decidedBy: 'pnpm test:e2e',
    deferral: '',
    probe: pointThree,
  },
  {
    number: 4,
    title: 'The UI is a world-class evidence console',
    decidedBy: 'pnpm test:e2e',
    deferral: 'UI-1',
    probe: pointFour,
  },
  {
    number: 5,
    title: 'Quality is measured, not asserted',
    decidedBy: 'pnpm complexity && pnpm duplication && pnpm coverage:ratchet',
    deferral: 'Q-1',
    probe: pointFive,
  },
  {
    number: 6,
    title: 'The product is instrumented end to end',
    decidedBy: 'pnpm test:runner',
    deferral: '',
    probe: pointSix,
  },
  {
    number: 7,
    title: 'Every capability claim has a passing evidence command',
    decidedBy: 'pnpm docs:capability-register',
    deferral: 'CAP-1',
    probe: pointSeven,
  },
  {
    number: 8,
    title: 'The evidence and audit chain is complete, and the vault binds to row identity',
    decidedBy: 'pnpm --filter @automate/api test src/infrastructure/vault-crypto.test.ts',
    deferral: '',
    probe: pointEight,
  },
  {
    number: 9,
    title: 'Every schema change is additive and proven',
    decidedBy: 'pnpm migrate:validate',
    deferral: '',
    probe: pointNine,
  },
  {
    number: 10,
    title: 'No doc claims a capability the register marks not_configured',
    decidedBy: 'pnpm docs:check',
    deferral: '',
    probe: pointTen,
  },
  {
    number: 11,
    title: '`pnpm review:pr --base main` is a real merge gate with zero Blocker/Critical',
    decidedBy: 'pnpm review:pr --base main',
    deferral: '',
    probe: pointEleven,
  },
  {
    number: 12,
    title: 'The public site is live and passes all ten site-doctor checks',
    decidedBy: 'SITE_DOCTOR_BUILT=1 pnpm site:doctor',
    deferral: 'SITE-1',
    probe: pointTwelve,
  },
]);

/**
 * The worst verdict in a list, by `VERDICTS` order.
 *
 * @param {Clause[]} clauses
 * @returns {Verdict}
 */
export function worstOf(clauses) {
  for (const verdict of VERDICTS) {
    if (clauses.some((clause) => clause.verdict === verdict))
      return /** @type {Verdict} */ (verdict);
  }
  return 'pass';
}

/**
 * Applies a point's deferral to its clauses.
 *
 * The only transformation this module applies, and it is deliberately narrow. A
 * `fail` becomes `not_configured` **only** when the ledger carries the point's row
 * as `debt` **with a non-empty owner and a non-empty `removalCondition`** — the same
 * pair `findings-ledger.mjs` requires, duplicated here on purpose rather than
 * imported, because this module must not depend on a check that only runs when
 * someone ran the ledger gate. An incomplete `debt` row is not a deferral; it is a
 * deferral whose condition for ending is missing, which is how a deferral becomes
 * permanent and stops being visible. The suite proves it: a row with an empty
 * removal condition leaves the `fail` standing.
 *
 * A row that is `open` does not defer anything, either — an open row is a defect,
 * and §17's eleventh point is zero open Blocker or Critical for exactly that reason.
 *
 * @param {Clause[]} clauses
 * @param {string} deferral ledger id, or `''`
 * @param {Context} ctx
 * @returns {Clause[]}
 */
function applyDeferral(clauses, deferral, ctx) {
  if (deferral === '' || !clauses.some((clause) => clause.verdict === 'fail')) return clauses;
  const row = ctx.ledgerRows.find((candidate) => candidate.id === deferral);
  if (row?.status !== 'debt') return clauses;
  const owner = typeof row.owner === 'string' ? row.owner.trim() : '';
  const condition = typeof row.removalCondition === 'string' ? row.removalCondition.trim() : '';
  if (owner === '' || condition === '') return clauses;
  const carried = `Carried as debt under \`${deferral}\` — owner: ${owner}. Removal condition: ${condition}`;
  return clauses.map((clause) =>
    clause.verdict === 'fail'
      ? { ...clause, verdict: /** @type {Verdict} */ ('not_configured'), reason: carried }
      : clause,
  );
}

/**
 * @typedef {object} Report
 * @property {number} number
 * @property {string} title
 * @property {string} decidedBy
 * @property {Verdict} verdict
 * @property {string} reason
 * @property {Clause[]} clauses
 */

/**
 * Every point, evaluated.
 *
 * @param {Context} ctx
 * @returns {Report[]}
 */
export function evaluate(ctx) {
  return POINTS.map((point) => {
    const clauses = applyDeferral(point.probe(ctx), point.deferral, ctx);
    /** @type {Report} */
    const report = {
      number: point.number,
      title: point.title,
      decidedBy: point.decidedBy,
      verdict: worstOf(clauses),
      reason:
        clauses
          .filter((clause) => clause.verdict !== 'pass')
          .map((clause) => `${clause.verdict}: ${clause.claim}`)
          .join('; ') || 'every clause checked and held',
      clauses,
    };
    return report;
  });
}

/**
 * @param {Report[]} reports
 * @returns {Record<Verdict, number>}
 */
export function tally(reports) {
  /** @type {Record<Verdict, number>} */
  const counts = { pass: 0, fail: 0, not_configured: 0 };
  for (const report of reports) counts[report.verdict] += 1;
  return counts;
}

/** The tiers `status:10` is allowed to be, and the condition each one belongs to. */
export const TIERS = { armed: 'pr-blocking', unarmed: 'pr-reporting' };

/**
 * Which tier `status:10` is allowed to be, derived from what it reports.
 *
 * The same rule `render-gate-phase.mjs` applies to `test:render`, for the same reason
 * and with the same failure in mind: a required check that can never pass blocks every
 * pull request, trains reviewers to read red as noise, and hides the failures that
 * matter. `--strict` was a switch for exactly that reason and was armed on 2026-10-01
 * when the fails were zero; on 2026-10-02 RF-5 returned to `open`/`Blocker` and the
 * count went to one again, and no amount of code clears it — `pnpm migrate:rehearse`
 * needs an installation.
 *
 * **Derived, not chosen**, so the tier cannot drift from the tree the way the prose did.
 * A hand-set tier is the same defect as a hand-set claim: right until the day the fact
 * it describes changes, and then wrong in a way nothing notices.
 *
 * `not_configured` does not downgrade the tier. Eleven of twelve points are
 * unmeasured on any host, and they are unmeasured in CI too, so keying the tier on
 * them would pin it at `pr-reporting` forever and make arming it meaningless. Zero
 * `fail` is what this repository's own definition of done says, and that is the whole
 * condition.
 *
 * @param {Report[]} reports
 * @returns {'armed' | 'unarmed'}
 */
export function phaseFor(reports) {
  return tally(reports).fail > 0 ? 'unarmed' : 'armed';
}

/**
 * Every way the declared tier disagrees with what the reports say, as findings.
 *
 * @param {Report[]} reports
 * @param {string} tier the tier `scripts/gate-tooling.json` gives `status:10`
 * @returns {string[]}
 */
export function tierProblems(reports, tier) {
  const phase = phaseFor(reports);
  if (tier === TIERS[phase]) return [];

  if (phase === 'unarmed') {
    return [
      '`status:10` is tiered `pr-blocking` while it reports at least one `fail` row, so the ' +
        'required check can never pass. RF-5 is an open Blocker whose removal condition is one ' +
        '`pnpm migrate:rehearse` run against a real installation, and nothing in this ' +
        'repository can produce one. Until that run exists the job reports, and the tier is ' +
        '`pr-reporting`.',
    ];
  }
  return [
    '`status:10` reports zero `fail` rows, so the definition of done is met and the gate is ' +
      'real. Leaving it `pr-reporting` is a check nobody is required to satisfy, which is worse ' +
      'than the unarmed state it replaced.',
  ];
}

/**
 * A markdown table, which is the whole output format.
 *
 * One table, three columns a reader acts on, and no formatting the generator and
 * `pnpm format` would disagree about: `build-site-pages.mjs` pads its columns to
 * the widest cell, and a table emitted without that padding is a red `format:check`
 * on every run.
 *
 * @param {Report[]} reports
 * @returns {string[]}
 */
export function markdownTable(reports) {
  const rows = reports.map((report) => [
    String(report.number),
    `\`${report.verdict}\``,
    report.reason.replaceAll('|', '\\|'),
    `\`${report.decidedBy}\``,
  ]);
  const headers = ['#', 'Verdict', 'Why', 'Decided by'];
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (/** @type {string[]} */ cells) =>
    `| ${cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join(' | ')} |`;
  return [
    line(headers),
    line(widths.map((width) => '-'.repeat(width))),
    ...rows.map((row) => line(headers.map((_header, column) => row[column] ?? ''))),
  ];
}
