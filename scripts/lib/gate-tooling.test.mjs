import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditRepository,
  auditWorkflow,
  listWorkflows,
  parseWorkflow,
  readManifest,
  readRootScriptCommand,
  readRootScripts,
  referencedScripts,
} from './gate-tooling.mjs';

// Three imports this file did not use — `readFileSync`, `path`, `fileURLToPath`, plus
// the `root` they computed and `WORKFLOW_DIR` from the module. They were invisible
// until turbo's lint cache was invalidated, which is the part worth noting: a gate
// reporting green from a cached result has not looked at the file at all, and these
// files were untracked, so no cache key had ever covered them.

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

test('the committed workflows are wired correctly', () => {
  assert.ok(listWorkflows().length > 0, 'no workflows found; the audit would pass on absence');
  const findings = auditRepository();
  assert.deepEqual(findings, []);
});
