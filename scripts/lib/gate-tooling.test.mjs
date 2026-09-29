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
  readRootScriptCommand,
  readRootScripts,
  referencedScripts,
} from './gate-tooling.mjs';
import { phaseFor, tierProblems } from './render-gate-phase.mjs';
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

test('every root script carries a tier, and every tier is one of the four', () => {
  // Plan D6: "new scripts are classified `pr-blocking`, `pr-reporting`, `nightly` or
  // `release` before they are written". Declared in a comment it is a convention;
  // declared in the manifest and asserted here it is a gate. An unclassified script
  // is one whose blocking behaviour was decided by whoever happened to wire it.
  //
  // `never-in-ci` is a fifth value for the scripts that are deliberately run by hand
  // — `dev`, `db:migrate`, and the `*:baseline` writers that rewrite a recorded
  // floor. A `*:baseline` script in a workflow would let a job raise a floor instead
  // of measuring against it, which is the same class of defect as lowering one.
  const manifest = readManifest();
  const scripts = readRootScripts();
  const tiers = manifest.tiers ?? {};
  const ALLOWED = new Set(['pr-blocking', 'pr-reporting', 'nightly', 'release', 'never-in-ci']);
  const unclassified = [...scripts.keys()].filter((name) => tiers[name] === undefined);
  assert.deepEqual(unclassified, [], 'every root script needs a tier in gate-tooling.json');
  for (const [name, tier] of Object.entries(tiers)) {
    if (typeof tier !== 'string') continue; // the `$comment` key
    assert.ok(ALLOWED.has(tier), `${name} has the unknown tier "${tier}"`);
    assert.ok(scripts.has(name), `gate-tooling.json tiers "${name}", which is not a root script`);
  }
  // `verify` itself must not have outgrown its budget. Plan D6: 13 steps today, at
  // most 20. This is the count that has to be edited deliberately rather than
  // discovered when the PR queue turns red.
  const steps = readRootScriptCommand('verify')
    .split('&&')
    .map((step) => step.trim())
    .filter(Boolean);
  assert.ok(
    steps.length <= 20,
    `verify has ${String(steps.length)} steps, over the plan's budget of 20. Move the new ` +
      'one to nightly rather than raising the budget.',
  );
  assert.ok(
    !steps.some((step) => step.includes('migrate:apply')),
    'migrate:apply must never enter verify: CI has no persistent database',
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
  // And the gate that degrades must still be blocking where it counts.
  assert.equal((readManifest().tiers ?? {})['security:static'], 'pr-blocking');
  assert.equal((readManifest().tiers ?? {})['verify'], 'pr-blocking');
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

test('the committed workflows are wired correctly', () => {
  assert.ok(listWorkflows().length > 0, 'no workflows found; the audit would pass on absence');
  const findings = auditRepository();
  assert.deepEqual(findings, []);
});
