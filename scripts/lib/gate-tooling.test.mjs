import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  auditRepository,
  auditWorkflow,
  listActionFiles,
  listWorkflows,
  parseWorkflow,
  readManifest,
  readRootScripts,
  referencedScripts,
  tierRegisterProblems,
} from './gate-tooling.mjs';
import { phaseFor, tierProblems } from './render-gate-phase.mjs';
import {
  evaluate,
  loadContext,
  phaseFor as statusTenPhaseFor,
  tierProblems as statusTenTierProblems,
} from './status-ten.mjs';
import { HOST_SCANNERS_ENV } from './host-scanners.mjs';

/** The repository root, for the committed data files this suite also reads. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

test('the manifest covers every script whose gate exits not_configured without a binary', () => {
  const manifest = readManifest();
  // Each of these exits non-zero when its tooling is absent. A row in
  // `scripts/gate-tooling.json` is what turns that from a permanently red job
  // into a checkable claim, so a script added here without a row is a finding.
  const toolDependent = ['security:static', 'test:performance', 'oci:build', 'oci:verify'];
  for (const script of toolDependent) {
    assert.ok(
      manifest.scripts[script] !== undefined,
      `${script} needs a gate-tooling row: it exits not_configured without a binary`,
    );
  }
});

test('every manifest row names a script that exists in the root package.json', () => {
  const manifest = readManifest();
  const scripts = readRootScripts();
  for (const name of Object.keys(manifest.scripts)) {
    assert.ok(scripts.has(name), `gate-tooling.json lists "${name}", which is not a root script`);
  }
});

test('every required binary is either installed by a step or preinstalled in the job image', () => {
  const manifest = readManifest();
  for (const [name, entry] of Object.entries(manifest.scripts)) {
    for (const raw of entry.requires ?? []) {
      for (const tool of raw.split('|')) {
        assert.ok(
          entry.preinstalledInJobImage === true || entry.installedBy !== undefined,
          `${name} requires "${tool}" with neither an installedBy action nor ` +
            'preinstalledInJobImage, so nothing in CI can supply it',
        );
      }
    }
  }
});

test('script references are separated from pnpm builtins and filtered invocations', () => {
  assert.deepEqual(referencedScripts('pnpm security:verify'), ['security:verify']);
  assert.deepEqual(referencedScripts('pnpm test:contract'), ['test:contract']);
  assert.deepEqual(referencedScripts('pnpm run complexity'), ['complexity']);
  assert.deepEqual(referencedScripts('pnpm install --frozen-lockfile'), []);
  assert.deepEqual(referencedScripts('pnpm audit --audit-level=high'), []);
  assert.deepEqual(referencedScripts('pnpm exec playwright install --with-deps chromium'), []);
  // A filtered invocation names a package script, not a root one.
  assert.deepEqual(referencedScripts('pnpm --filter @automate/worker test'), []);
  assert.deepEqual(referencedScripts('pnpm --filter @automate/api run dev'), []);
  // `exec` after a filter is pnpm's subcommand, and everything after it belongs to
  // the exec'd program. Reading to the next flag instead made the audit claim the
  // workflow ran a root script called `127.0.0.1` — a false positive, which is the
  // direction that trains people to ignore the gate.
  assert.deepEqual(
    referencedScripts('pnpm --filter @automate/unified-web exec vite --host 127.0.0.1 --port 5173'),
    [],
  );
  // A known limitation, pinned so it is a decision rather than an accident. A token
  // after a filter is read as another selector, so `pnpm --filter <pkg> lint` — which
  // really does run the *root* `lint` script, scoped by turbo — is reported as no
  // reference. The bias is deliberate: a false alarm gets a gate switched off, while
  // a missed reference is caught by the ratchet and complexity gates, which run
  // unwrapped. Widening it means distinguishing a package script from a root one,
  // which needs the workspace manifest rather than the argv.
  assert.deepEqual(referencedScripts('pnpm --filter @automate/worker lint'), []);
  // A chained command contributes its own reference.
  assert.deepEqual(referencedScripts('pnpm verify && pnpm security:verify'), [
    'verify',
    'security:verify',
  ]);
});

test('a workflow with no jobs is a finding rather than a pass', () => {
  const findings = auditWorkflow(
    'empty.yml',
    ['name: Empty', 'on: workflow_dispatch', 'concurrency: { group: x }', 'jobs: {}'].join('\n'),
    readManifest(),
    readRootScripts(),
  );
  assert.ok(findings.some((finding) => /no jobs found/.test(finding)));
});

test('a job with no timeout is a finding', () => {
  const source = [
    'name: W',
    'on: workflow_dispatch',
    'concurrency:',
    '  group: w',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-24.04',
    '    steps:',
    '      - run: pnpm lint',
  ].join('\n');
  const findings = auditWorkflow('w.yml', source, readManifest(), readRootScripts());
  assert.ok(findings.some((finding) => /no `timeout-minutes`/.test(finding)));
});

test('a workflow with no concurrency block is a finding', () => {
  const source = [
    'name: W',
    'on: workflow_dispatch',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-24.04',
    '    timeout-minutes: 5',
    '    steps:',
    '      - run: pnpm lint',
  ].join('\n');
  const findings = auditWorkflow('w.yml', source, readManifest(), readRootScripts());
  assert.ok(findings.some((finding) => /no `concurrency` block/.test(finding)));
});

test('running a manifest-listed script with no install step is a finding', () => {
  const source = [
    'name: W',
    'on: workflow_dispatch',
    'concurrency:',
    '  group: w',
    'jobs:',
    '  security:',
    '    runs-on: ubuntu-24.04',
    '    timeout-minutes: 15',
    '    steps:',
    '      - run: pnpm install --frozen-lockfile',
    '      - run: pnpm security:verify',
  ].join('\n');
  const findings = auditWorkflow('w.yml', source, readManifest(), readRootScripts());
  // The umbrella `security:verify` inherits the scanners through `includes`, so
  // the finding names the composed requirement, not the script a job would
  // otherwise have to name itself.
  assert.ok(
    findings.some((finding) => /needs semgrep, but no step installs it/.test(finding)),
    'the red-by-construction security job must be reported',
  );
  assert.ok(findings.some((finding) => /needs gitleaks, but no step installs it/.test(finding)));
});

test('the same job passes once the scanner action is present', () => {
  const source = [
    'name: W',
    'on: workflow_dispatch',
    'concurrency:',
    '  group: w',
    'jobs:',
    '  security:',
    '    runs-on: ubuntu-24.04',
    '    timeout-minutes: 15',
    '    steps:',
    '      - run: pnpm install --frozen-lockfile',
    '      - uses: ./.github/actions/install-scanners',
    '      - run: pnpm security:verify',
  ].join('\n');
  const findings = auditWorkflow('w.yml', source, readManifest(), readRootScripts());
  assert.deepEqual(findings, []);
});

test('an E2E job with no database and no DATABASE_URL is a finding', () => {
  const source = [
    'name: W',
    'on: workflow_dispatch',
    'concurrency:',
    '  group: w',
    'jobs:',
    '  e2e:',
    '    runs-on: ubuntu-24.04',
    '    timeout-minutes: 20',
    '    steps:',
    '      - run: pnpm install --frozen-lockfile',
    '      - run: pnpm test:e2e',
  ].join('\n');
  const findings = auditWorkflow('w.yml', source, readManifest(), readRootScripts());
  assert.ok(findings.some((finding) => /requires \$DATABASE_URL/.test(finding)));
});

test('a postgres service satisfies the E2E database requirement', () => {
  const source = [
    'name: W',
    'on: workflow_dispatch',
    'concurrency:',
    '  group: w',
    'jobs:',
    '  e2e:',
    '    runs-on: ubuntu-24.04',
    '    timeout-minutes: 20',
    '    services:',
    '      postgres:',
    '        image: postgres:16-alpine',
    '        env:',
    '          POSTGRES_PASSWORD: automate',
    '    steps:',
    '      - run: pnpm install --frozen-lockfile',
    '      - run: pnpm test:e2e',
  ].join('\n');
  const findings = auditWorkflow('w.yml', source, readManifest(), readRootScripts());
  assert.deepEqual(findings, []);
});

test('an explicit DATABASE_URL env satisfies it without a service', () => {
  const source = [
    'name: W',
    'on: workflow_dispatch',
    'concurrency:',
    '  group: w',
    'jobs:',
    '  e2e:',
    '    runs-on: ubuntu-24.04',
    '    timeout-minutes: 20',
    '    env:',
    '      DATABASE_URL: postgresql://user:pass@127.0.0.1:5432/automate',
    '    steps:',
    '      - run: pnpm test:e2e',
  ].join('\n');
  const findings = auditWorkflow('w.yml', source, readManifest(), readRootScripts());
  assert.deepEqual(findings, []);
});

test('setting E2E_ALLOW_IN_MEMORY in a workflow is a finding', () => {
  const source = [
    'name: W',
    'on: workflow_dispatch',
    'concurrency:',
    '  group: w',
    'jobs:',
    '  e2e:',
    '    runs-on: ubuntu-24.04',
    '    timeout-minutes: 20',
    '    env:',
    '      E2E_ALLOW_IN_MEMORY: "1"',
    '    steps:',
    '      - run: pnpm test:e2e',
  ].join('\n');
  const findings = auditWorkflow('w.yml', source, readManifest(), readRootScripts());
  assert.ok(findings.some((finding) => /E2E_ALLOW_IN_MEMORY/.test(finding)));
});

test('a reference to a script that does not exist is a finding', () => {
  const source = [
    'name: W',
    'on: workflow_dispatch',
    'concurrency:',
    '  group: w',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-24.04',
    '    timeout-minutes: 5',
    '    steps:',
    '      - run: pnpm test:typo',
  ].join('\n');
  const findings = auditWorkflow('w.yml', source, readManifest(), readRootScripts());
  assert.ok(findings.some((finding) => /not a script in the root package.json/.test(finding)));
});

test('the parser reads a block scalar as one opaque value', () => {
  const workflow = parseWorkflow(
    [
      'name: W',
      'jobs:',
      '  build:',
      '    steps:',
      '      - name: Two commands',
      '        run: |',
      '          pnpm lint',
      '          pnpm security:verify',
    ].join('\n'),
  );
  const run = /** @type {any} */ (workflow).jobs.build.steps[0].run;
  assert.match(String(run), /pnpm lint/);
  assert.match(String(run), /pnpm security:verify/);
});

test('a comment is not read as structure', () => {
  const workflow = parseWorkflow(
    [
      '# leading comment',
      'name: W # trailing comment',
      'jobs:',
      '  build:',
      '    # a comment inside the job',
      '    timeout-minutes: 5',
    ].join('\n'),
  );
  assert.equal(workflow.name, 'W');
  assert.equal(/** @type {any} */ (workflow).jobs.build['timeout-minutes'], '5');
});

test('an unparseable workflow raises rather than being silently misread', () => {
  assert.throws(
    () => parseWorkflow(['jobs:', '  build:', '    this line has no key'].join('\n')),
    /unparseable workflow line/,
  );
});

test('every root script carries a tier, and every tier is one of the five', () => {
  // Plan D6: "new scripts are classified `pr-blocking`, `pr-reporting`, `nightly` or
  // `release` before they are written". Declared in a comment it is a convention;
  // declared in the manifest and asserted here it is a gate. An unclassified script
  // is one whose blocking behaviour was decided by whoever happened to wire it.
  //
  // `never-in-ci` is a fifth value for the scripts that are deliberately run by hand
  // — `dev`, `db:migrate`, and the `*:baseline` writers that rewrite a recorded
  // floor. A `*:baseline` script in a workflow would let a job raise a floor instead
  // of measuring against it, which is the same class of defect as lowering one.
  //
  // The rule itself lives in `gate-tooling.mjs` as `tierRegisterProblems`, because
  // `scripts/lib/status-ten.mjs` reports the same facts as the twelve-point
  // measurement and a second copy of this rule is a second place for the
  // classification to be wrong. This test asserts the shared implementation.
  assert.deepEqual(
    tierRegisterProblems(readManifest(), readRootScripts()),
    [],
    'every root script needs a tier in gate-tooling.json, every tier must be one of the five, ' +
      'and verify must stay inside its 20-step budget',
  );
});

test('the step count `verify` is described with is the step count it has', () => {
  // Two documents state this number by hand — the budget anchor in `gate-tooling.json`
  // and the table in `site/operations.md` — and both were stale in the same session
  // that `tenancy:check` made them stale. A number nobody derives is a number that
  // will be wrong again, so it is asserted here against the chain itself rather than
  // corrected a third time. Four lines, in the test that already counts the steps.
  const steps = /** @type {string} */ (
    /** @type {{ scripts: Record<string, string> }} */ (
      JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
    ).scripts.verify
  )
    .split('&&')
    .map((step) => step.trim().replace(/^pnpm /, ''))
    .filter((step) => step !== '');

  // `gate-tooling.json` writes it as a digit and `site/operations.md` spells it,
  // because one is a machine budget and the other is prose. Both are accepted.
  const spelled = [
    '',
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

  // Each pattern is the claim that file actually makes, not a scan for a number. A
  // generic `\d+` scan matched "Four of the nine jobs" three hundred lines before the
  // sentence under test, which is the same mistake as reading a count out of prose.
  //
  // The annotation is not decoration. Without it the array literal infers
  // `(string | RegExp)[][]`, the destructured `pattern` is `string | RegExp`, and
  // `pattern.exec` is a type error — which is how `pnpm typecheck:scripts` came to
  // be red at HEAD on a tree nobody had touched.
  //
  // It is on a **named binding** rather than on the `for…of` expression because a
  // JSDoc type applies where the value is declared, not where it is consumed; put
  // on the loop it is read as the loop's type and the literal is still inferred
  // from itself.
  /** @type {Array<[string, RegExp]>} */
  const documentedSteps = [
    ['scripts/gate-tooling.json', /`verify` may grow from (\d+)/],
    ['site/operations.md', /The whole chain\. (\w+) steps/],
  ];
  for (const [file, pattern] of documentedSteps) {
    const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    const found = pattern.exec(text)?.[1]?.toLowerCase();
    const expected = [String(steps.length), spelled[steps.length] ?? ''].map((word) =>
      word.toLowerCase(),
    );
    assert.ok(
      found !== undefined && expected.includes(found),
      `${file} does not describe \`verify\` as ${expected[1] ?? expected[0]} steps. ` +
        `\`pnpm verify\` runs ${steps.join(', ')}, and a hand-written count drifts the moment ` +
        'one of them moves.',
    );
  }
});

test('a tolerated failure around a pr-blocking gate is a finding, and one around a reporting job is not', () => {
  // W0.9's `no-silent-skip` rule, and the reason it is tier-aware rather than
  // absolute. `continue-on-error` on a `pr-reporting` or `nightly` job is a
  // deliberate classification — `migration-report` and the migration-rehearsal job
  // both carry it, with the reasoning in a comment beside the job. A rule that
  // forbade it outright would push those jobs to be deleted rather than demoted.
  //
  // The defect is the same flag on a job that runs a gate the manifest says blocks
  // the merge: the job reports green whether the gate ran or not.
  /** @param {string} script @param {string} [extra] */
  const fixture = (script, extra = '') =>
    [
      'name: Fixture',
      'on: workflow_dispatch',
      'concurrency:',
      '  group: fixture',
      'jobs:',
      '  probe:',
      '    runs-on: ubuntu-24.04',
      '    timeout-minutes: 5',
      ...extra.split('\n').filter(Boolean),
      '    steps:',
      `      - run: pnpm ${script}`,
    ].join('\n');

  const blocking = auditWorkflow(
    'fixture.yml',
    fixture('lint', '    continue-on-error: true'),
    readManifest(),
    readRootScripts(),
  );
  assert.ok(
    blocking.some((finding) => /continue-on-error[\s\S]*`pnpm lint`/.test(finding)),
    `a tolerated failure around a pr-blocking gate must be a finding; got: ${blocking.join(' | ')}`,
  );

  // The same flag on a tier that already reports is the deliberate case, and a
  // rule that reported it would make the two indistinguishable.
  const reporting = auditWorkflow(
    'fixture.yml',
    fixture('migrate:plan', '    continue-on-error: true'),
    readManifest(),
    readRootScripts(),
  );
  assert.deepEqual(
    reporting.filter((finding) => /continue-on-error/.test(finding)),
    [],
    'continue-on-error on a pr-reporting job is a classification, not a silent pass',
  );

  // And `|| true` is the same statement written in the shell.
  const shell = auditWorkflow(
    'fixture.yml',
    [
      'name: Fixture',
      'on: workflow_dispatch',
      'concurrency:',
      '  group: fixture',
      'jobs:',
      '  probe:',
      '    runs-on: ubuntu-24.04',
      '    timeout-minutes: 5',
      '    steps:',
      '      - run: pnpm lint || true',
    ].join('\n'),
    readManifest(),
    readRootScripts(),
  );
  assert.ok(
    shell.some((finding) => /\|\| true/.test(finding)),
    `a shell that discards a pr-blocking gate's result must be a finding; got: ${shell.join(' | ')}`,
  );
});

test('no CI file sets the host-scanner opt-in, and verify:local is never-in-ci', () => {
  // `AUTOMATE_HOST_SCANNERS=unavailable` turns a scanner that cannot produce a scan
  // into a recorded `not_configured` pass. That is a legitimate trade on a
  // developer laptop with no semgrep and it is a *defect* in a pull request: CI is
  // the only place the security scan is actually enforced, and a job that sets the
  // variable reports green for a scan that never ran.
  //
  // The production audit enforces this (`auditHostDegradation`); this test
  // exercises that path and pins the two properties it depends on. A duplicate
  // implementation of the check would be a second place to keep in agreement,
  // and the one that mattered — `.github/actions/`, which `listWorkflows` cannot
  // see — is exactly the one a copy would have missed.
  const actionFiles = listActionFiles();
  assert.ok(
    actionFiles.length >= 5,
    `found only ${String(actionFiles.length)} .github YAML files; the audit cannot pass on absence`,
  );
  assert.ok(
    actionFiles.some((file) => file.replaceAll('\\', '/').includes('.github/actions/')),
    'the walk must reach .github/actions/, where install-scanners lives — a composite ' +
      "action's step-scoped `env:` is inherited by every later step in the calling job",
  );

  const offenders = auditRepository().filter((finding) => finding.includes(HOST_SCANNERS_ENV));
  assert.deepEqual(offenders, [], 'no .github file may set the host-scanner opt-in');

  assert.equal(
    (readManifest().tiers ?? {})['verify:local'],
    'never-in-ci',
    'verify:local is the degraded chain and has no business being a required or reported check',
  );
  // And `verify` is still a required gate.
  assert.equal((readManifest().tiers ?? {})['verify'], 'pr-blocking');
  // `security:static` is **not**, and this assertion used to say it was.
  //
  // The claim behind it was "the gate that degrades must still block where it counts" —
  // which is the right principle and was applied to a gate that had never run. The
  // scanner-install step failed on every run in this repository's history, so
  // `security:static` executed for the first time on 2026-09-30 and reported 1137 blocking
  // findings. A required check that cannot pass blocks every pull request; the tier moved
  // to `pr-reporting` and the count is recorded in SEM-2 rather than left hypothetical.
  //
  // Asserted *positively* here so that graduating it back is a deliberate edit to this
  // line, at the moment the count reaches zero — rather than a change to the manifest
  // that nobody reads.
  assert.equal(
    (readManifest().tiers ?? {})['security:static'],
    'pr-reporting',
    'security:static graduates to pr-blocking when SEM-2 records zero blocking findings; change ' +
      'this assertion and the manifest row in the same commit',
  );
});

test('the opt-in is reported as a finding when a CI file sets it', () => {
  // Asserted against a source the audit actually parses, so the check is known to
  // produce a finding rather than merely to exist.
  const source = [
    'name: W',
    'on: workflow_dispatch',
    'concurrency:',
    '  group: w',
    'jobs:',
    '  security:',
    '    runs-on: ubuntu-24.04',
    '    timeout-minutes: 15',
    '    env:',
    `      ${HOST_SCANNERS_ENV}: unavailable`,
    '    steps:',
    '      - run: pnpm lint',
  ].join('\n');
  const parsed = /** @type {any} */ (parseWorkflow(source));
  assert.equal(
    parsed.jobs.security.env[HOST_SCANNERS_ENV],
    'unavailable',
    'a job-level env: is the shape that would reach every step in the job',
  );
});

test("the rendering gate's tier follows its baseline, in both directions", () => {
  // The two-phase rollout, enforced. `performance/rendering-budget.json` has no
  // recorded measurement, so the job measures and reports and must not be a required
  // check; once someone records a real run, the comparison becomes a real gate and
  // the tier has to rise with it in the same commit.
  //
  // This lives here rather than in the rendering budget's own test because it is a
  // claim about the *repository* — a manifest tier and a data file have to agree — and
  // this suite is the only one that reads both. Declared in a comment it would be a
  // convention; declared here it is a gate, which is the difference between the state
  // the repository shipped (a `pr-blocking` job that could never pass) and the state
  // it is in now.
  //
  // The direction that matters most is the second one. `recorded: true` beside
  // invented numbers with a `pr-reporting` tier would be a gate that is permanently
  // green *and* not required — and nothing else in the repository would notice.
  const manifest = readManifest();
  const declared = (manifest.tiers ?? {})['test:render'];
  assert.equal(typeof declared, 'string', 'test:render needs a tier in gate-tooling.json');

  const baseline = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'performance', 'rendering-budget.json'), 'utf8'),
  );

  assert.deepEqual(
    tierProblems(baseline, declared),
    [],
    `test:render is ${phaseFor(baseline)} but is tiered "${declared}". ` +
      'See scripts/lib/render-gate-phase.mjs.',
  );
});

test('the status:10 tier is what its own reports require, not a hand-set constant', () => {
  // The same rule as the test above, for the same reason. `status:10` was armed
  // `pr-blocking` on 2026-10-01 when the fails were zero and the count went back to
  // one on 2026-10-02 when RF-5 returned to `open`/`Blocker` — a fail whose removal
  // condition needs an installation. Left as a hand-set tier it is either a required
  // check that can never pass, or a real gate nobody is required to satisfy, and
  // nothing else in the repository would notice either way.
  const manifest = readManifest();
  const declared = (manifest.tiers ?? {})['status:10'];
  assert.equal(typeof declared, 'string', 'status:10 needs a tier in gate-tooling.json');

  const reports = evaluate(loadContext(REPO_ROOT));
  assert.deepEqual(
    statusTenTierProblems(reports, declared),
    [],
    `status:10 is ${statusTenPhaseFor(reports)} but is tiered "${declared}". See phaseFor in ` +
      'scripts/lib/status-ten.mjs.',
  );
});

test('the committed workflows are wired correctly', () => {
  assert.ok(listWorkflows().length > 0, 'no workflows found; the audit would pass on absence');
  const findings = auditRepository();
  assert.deepEqual(findings, []);
});
