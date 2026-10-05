import assert from 'node:assert/strict';
import test from 'node:test';

import {
  catalogDivergences,
  compareResolvedToBaseline,
  expiredOverrideReviews,
  isConfigurationFile,
  parseCatalog,
  parseLockfile,
  unusedDependencies,
} from './deps-policy.mjs';

/**
 * The lockfile shape this parser reads, trimmed to the parts that matter.
 *
 * It is copied from `pnpm-lock.yaml` v9 rather than invented, because a parser
 * written against an imagined layout is a parser that has never seen the file.
 */
const LOCKFILE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false

importers:

  .:
    devDependencies:
      typescript:
        specifier: 'catalog:'
        version: 5.9.3
      turbo:
        specifier: ^2.10.4
        version: 2.11.5
    dependencies:
      prettier:
        specifier: ^3.6.2
        version: 3.6.2

  apps/api:
    dependencies:
      '@automate/db':
        specifier: workspace:*
        version: link:../db
      '@hono/node-server':
        specifier: ^1.19.14
        version: 1.19.14(rollup@4.60.3)
      effect:
        specifier: ^3.21.2
        version: 3.21.2
      hono:
        specifier: ^4.12.29
        version: 4.12.29

  apps/web:
    devDependencies:
      turbo:
        specifier: ^2.10.4
        version: 2.11.5

packages:

  hono@4.12.29:
    resolution: {integrity: sha512-aaaa}
`;

/**
 * The root's three dependencies are tools this fixture never invokes, and the
 * function under test has no built-in list of what counts as a tool — the caller
 * supplies exemptions, because a name hard-coded inside a checker is a second
 * authority nobody reviews. `scripts/lib/deps-policy.test.mjs` says so in the test
 * that exempts one, and `docs/quality/dependency-baseline.json` is where the real
 * list lives.
 */
const ROOT_TOOLS = ['typescript', 'turbo', 'prettier'];

/**
 * `apps/web` declares `turbo` and nothing else, so a test about `apps/api` has to
 * exempt it — the same thing the real baseline does for every package's tool
 * dependencies.
 */
const WEB_TOOLS = ['turbo'];

test('the parser reads each importer, its dependencies, and their resolved versions', () => {
  const parsed = parseLockfile(LOCKFILE);
  assert.deepEqual(Object.keys(parsed.importers).sort(), ['.', 'apps/api', 'apps/web']);
  assert.equal(parsed.importers['apps/api'].dependencies.hono.version, '4.12.29');
  // The root's groups are kept apart, because a tool invoked by a script and a
  // library imported by source are different questions.
  assert.equal(parsed.importers['.'].devDependencies.turbo.version, '2.11.5');
  assert.equal(parsed.importers['.'].dependencies.prettier.version, '3.6.2');
  assert.equal(parsed.importers['.'].devDependencies.turbo.specifier, '^2.10.4');
  assert.equal(parsed.importers['apps/api'].dependencies.hono.specifier, '^4.12.29');
});

test('a peer-suffixed resolution is recorded as the bare version it pins', () => {
  // pnpm records `1.19.14(rollup@4.60.3)` for a dependency resolved with a peer
  // context. The peer suffix is resolution detail; the version is `1.19.14`. A
  // baseline that stored the suffix would fail on every peer bump.
  const parsed = parseLockfile(LOCKFILE);
  assert.equal(parsed.importers['apps/api'].dependencies['@hono/node-server'].version, '1.19.14');
});

test('a workspace link is resolved, not versioned, so it is not a version to review', () => {
  const parsed = parseLockfile(LOCKFILE);
  const link = parsed.importers['apps/api'].dependencies['@automate/db'];
  assert.equal(link.specifier, 'workspace:*');
  // `link:../db` is deliberately kept verbatim. Whether an internal dependency is
  // still imported is the unused-dependency check's question; which registry version
  // it resolved to is not a question a link can answer.
  assert.equal(link.version, 'link:../db');
});

test('the packages section is not mistaken for importers', () => {
  // `packages:` also maps a name to a record, at a same-or-shallower indent than a
  // dependency. A parser that keeps scanning after `importers:` reads
  // `hono@4.12.29:` as an importer called `hono@4.12.29`, and every check built on
  // it inherits the phantom.
  const parsed = parseLockfile(LOCKFILE);
  assert.equal(parsed.importers['hono@4.12.29'], undefined);
  assert.deepEqual(
    Object.values(parsed.importers).map((importer) => Object.keys(importer.dependencies)),
    [['prettier'], ['@automate/db', '@hono/node-server', 'effect', 'hono'], []],
  );
});

test('a declared dependency nothing imports is reported, with the importer that declared it', () => {
  // The real case, reproduced exactly: `apps/api` declares `effect`, and no file in
  // the workspace imports it. `hono`, declared in the same block, is imported —
  // the safe twin, which is what stops this check being a pass that reports
  // everything and therefore means nothing.
  const parsed = parseLockfile(LOCKFILE);
  const source = [
    "import { Hono } from 'hono';",
    "import server from '@hono/node-server';",
    "import { createDbResources } from '@automate/db';",
  ].join('\n');

  const unused = unusedDependencies(parsed, source, { '.': ROOT_TOOLS, 'apps/web': WEB_TOOLS });

  assert.deepEqual(unused, [{ name: 'effect', declaredIn: ['apps/api'] }]);
});

test('one dependency declared in many packages is one finding listing all of them', () => {
  // `turbo` is declared by two importers here, as `typescript` is by twenty-two in
  // the real tree. Reporting it twice is a report nobody reads, and a report nobody
  // reads is a gate that has stopped reporting — which is the failure SEM-2's 543
  // semgrep findings taught this repository. Every declaration is still named, because
  // the fix is per package.
  const parsed = parseLockfile(LOCKFILE);
  const unused = unusedDependencies(parsed, '', {
    '.': ['typescript', 'prettier'],
    'apps/api': ['@automate/db', '@hono/node-server', 'effect', 'hono'],
    'apps/web': [],
  });
  assert.deepEqual(unused, [{ name: 'turbo', declaredIn: ['.', 'apps/web'] }]);
});

test('a package named in a configuration string counts as referenced', () => {
  // Verbatim in spirit from `packages/ui/.storybook/main.ts`:
  //   addons: ['@hono/node-server'],
  // Configuration references a package by string, not by import. An import-only
  // matcher reports it unused, and the first thing a reviewer does with a false
  // positive is distrust the whole report.
  const parsed = parseLockfile(LOCKFILE);
  const unused = unusedDependencies(
    parsed,
    '',
    { '.': ROOT_TOOLS, 'apps/api': ['@automate/db', 'effect', 'hono'], 'apps/web': WEB_TOOLS },
    [],
    ["  addons: ['@hono/node-server'],"].join('\n'),
  );
  assert.deepEqual(unused, []);
});

test('the same string in application source is not a reference', () => {
  // The regression that shaped the rule above. Accepting a quoted package name
  // anywhere made `effect` disappear from this gate's output against the real tree,
  // because some application file contains the literal `'effect'` and `effect` is
  // also an English word. The one finding this gate was written for was the one it
  // stopped reporting — so the string rule is scoped to configuration, and this test
  // is what holds that scope.
  const parsed = parseLockfile(LOCKFILE);
  const unused = unusedDependencies(
    parsed,
    "const effect = 'effect';",
    {
      '.': ROOT_TOOLS,
      'apps/api': ['@automate/db', '@hono/node-server', 'hono'],
      'apps/web': WEB_TOOLS,
    },
    [],
    '',
  );
  assert.deepEqual(unused, [{ name: 'effect', declaredIn: ['apps/api'] }]);
});

test('a dot-directory above the repository root does not make the whole tree configuration', () => {
  // The bug this predicate shipped with, found by running it. The check read the
  // **absolute** path, so a checkout anywhere under a dot-directory — which is where
  // an agent worktree lives, and where `~/.cache` or `.work` would put a developer's —
  // made every file configuration, applied the string rule everywhere, and hid
  // `effect`. A gate whose verdict depends on where it was run is not a gate.
  const root = 'C:\\src\\.work\\programme-a';
  assert.equal(isConfigurationFile(`${root}\\scripts\\lib\\deps-policy.mjs`, root), false);
  assert.equal(isConfigurationFile(`${root}\\apps\\api\\src\\routes\\reporter.ts`, root), false);
  // The three real shapes still classify as configuration.
  assert.equal(isConfigurationFile(`${root}\\packages\\ui\\.storybook\\main.ts`, root), true);
  assert.equal(isConfigurationFile(`${root}\\apps\\web\\vite.config.ts`, root), true);
  assert.equal(isConfigurationFile(`${root}\\apps\\api\\src\\config\\index.ts`, root), true);
});

test('a file named `.config.ts` counts as configuration, and one merely containing it does not', () => {
  // `vite.config.ts` is configuration; `configure.ts` is a source file whose name
  // happens to contain the letters.
  assert.equal(isConfigurationFile('/repo/apps/web/vite.config.ts', '/repo'), true);
  assert.equal(isConfigurationFile('/repo/apps/api/src/configure.ts', '/repo'), false);
});

test('a package named in prose, without quotes, is still unused', () => {
  // The cost of accepting configuration strings, stated rather than hidden. A comment
  // that quotes a package name would read as a reference — and the case that motivated
  // this gate is not written that way: `effect` is four sentences of plain prose, and
  // it is still reported.
  const parsed = parseLockfile(LOCKFILE);
  const prose = '// Import effect here once the boundary exists. Effect is the plan.';
  const unused = unusedDependencies(parsed, prose, {
    '.': ROOT_TOOLS,
    'apps/api': ['@automate/db', '@hono/node-server', 'hono'],
    'apps/web': WEB_TOOLS,
  });
  assert.deepEqual(unused, [{ name: 'effect', declaredIn: ['apps/api'] }]);
});

test('an exemption marked with `*` applies to every importer', () => {
  // `typescript` is invoked by every package's `typecheck` script, so listing it
  // twenty-four times would be twenty-four rows to keep in step with the tree. `*` is a
  // statement about which names are tools everywhere; a per-importer entry still
  // applies to that importer alone, which is the next test.
  const parsed = parseLockfile(LOCKFILE);
  const unused = unusedDependencies(parsed, '', {
    '*': ['@automate/db', '@hono/node-server', 'effect', 'hono', 'prettier', 'typescript', 'turbo'],
  });
  assert.deepEqual(unused, []);
});

test('a dependency recorded as deliberately unused is exempt, and the exemption is explicit', () => {
  // `ajv` in `packages/shared-contracts` is a real instance: the package's own
  // README says it is "installed and unused" for a capability the register marks not
  // shipped. Deleting it is a product decision, so the exemption carries a reason in
  // the reviewed baseline rather than being buried in the checker.
  const parsed = parseLockfile(LOCKFILE);
  const unused = unusedDependencies(
    parsed,
    '',
    {
      '.': ROOT_TOOLS,
      'apps/api': ['@automate/db', '@hono/node-server', 'hono'],
      'apps/web': WEB_TOOLS,
    },
    ['effect'],
  );
  assert.deepEqual(unused, []);
});

test('a subpath import counts as an import of the package', () => {
  const parsed = parseLockfile(LOCKFILE);
  const unused = unusedDependencies(parsed, "import { bodyLimit } from 'hono/body-limit';", {
    '.': ROOT_TOOLS,
    'apps/api': ['@automate/db', '@hono/node-server', 'effect'],
    'apps/web': WEB_TOOLS,
  });
  assert.deepEqual(unused, []);
});

test('a dynamic import and a require count as imports', () => {
  const parsed = parseLockfile(LOCKFILE);
  const exemptions = {
    '.': ROOT_TOOLS,
    'apps/api': ['@automate/db', '@hono/node-server', 'effect'],
    'apps/web': WEB_TOOLS,
  };
  assert.deepEqual(
    unusedDependencies(parsed, "const hono = await import('hono');", exemptions),
    [],
  );
  assert.deepEqual(unusedDependencies(parsed, "const hono = require('hono');", exemptions), []);
});

test('a dependency named only in prose is still unused', () => {
  // The failure mode a name-only match would miss: a comment or a doc string that
  // mentions the package. This is the `effect` case exactly — four mentions in
  // `AGENTS.md` and four agent personas, zero imports.
  const parsed = parseLockfile(LOCKFILE);
  const prose = '// Use Effect for dependency injection. See the effect documentation.';
  const unused = unusedDependencies(parsed, prose, {
    '.': ROOT_TOOLS,
    'apps/api': ['@automate/db'],
    'apps/web': WEB_TOOLS,
  });
  assert.deepEqual(unused.map((entry) => entry.name).sort(), [
    '@hono/node-server',
    'effect',
    'hono',
  ]);
});

test('an exemption at one importer does not silence the same name at another', () => {
  // `typescript` is never imported by a `.ts` file. It is invoked, so it is exempt —
  // at the root, where the `tsc` calls live. The same name at `apps/web`, which has
  // no reason to declare it, is reported. This is the property that stops a
  // root-level exemption from becoming a hole a genuinely unused dependency hides in.
  const parsed = parseLockfile(LOCKFILE);
  const unused = unusedDependencies(parsed, '', {
    '.': ['typescript', 'prettier'],
    'apps/api': ['@automate/db', '@hono/node-server', 'effect', 'hono'],
  });
  assert.deepEqual(unused, [{ name: 'turbo', declaredIn: ['.', 'apps/web'] }]);
});

test('a review date wrapped across two comment lines is still the review date', () => {
  // Verbatim from `pnpm-workspace.yaml`. `Reviewed` and the date it introduces are on
  // different lines, separated by a comment marker. A matcher that does not strip the
  // marker finds no date, and reports a reviewed override as having no provenance —
  // the one answer that is wrong in the direction that reads like a defect.
  const yaml = [
    'overrides:',
    '  # GHSA-7fh5-64p2-3v2j (browserslist ReDoS) in 4.28.2 and earlier. Reviewed',
    '  # 2026-06-30.',
    "  'browserslist@4.28.2': 4.28.7",
  ].join('\n');
  assert.deepEqual(expiredOverrideReviews(yaml, '2026-10-04'), [
    { override: 'browserslist@4.28.2', reviewedOn: '2026-06-30' },
  ]);
});

test('a resolution the baseline does not record is drift', () => {
  // A dependency nobody reviewed. The ratchet shape: the tree may not introduce a
  // version without a recorded decision about it.
  const drift = compareResolvedToBaseline(
    { hono: '4.12.29', effect: '3.21.2' },
    { entries: [{ name: 'hono', version: '4.12.29' }] },
  );
  assert.deepEqual(drift.unreviewed, [{ name: 'effect', version: '3.21.2' }]);
  assert.deepEqual(drift.stale, []);
  assert.deepEqual(drift.changed, []);
});

test('a baseline row the tree no longer resolves is drift in the other direction', () => {
  // The other half of "both directions", which is what stops the baseline
  // accumulating rows for dependencies that were deleted on purpose.
  const drift = compareResolvedToBaseline(
    { hono: '4.12.29' },
    {
      entries: [
        { name: 'hono', version: '4.12.29' },
        { name: 'effect', version: '3.21.2' },
      ],
    },
  );
  assert.deepEqual(drift.unreviewed, []);
  assert.deepEqual(drift.stale, [{ name: 'effect', version: '3.21.2' }]);
  assert.deepEqual(drift.changed, []);
});

test('a resolved version that differs from the reviewed one is drift', () => {
  const drift = compareResolvedToBaseline(
    { hono: '4.13.12' },
    { entries: [{ name: 'hono', version: '4.12.29' }] },
  );
  assert.deepEqual(drift.unreviewed, []);
  assert.deepEqual(drift.stale, []);
  assert.deepEqual(drift.changed, [{ name: 'hono', reviewed: '4.12.29', resolved: '4.13.12' }]);
});

test('a baseline that agrees with the tree reports nothing', () => {
  const drift = compareResolvedToBaseline(
    { hono: '4.12.29' },
    { entries: [{ name: 'hono', version: '4.12.29' }] },
  );
  assert.deepEqual(drift, { unreviewed: [], stale: [], changed: [] });
});

test('a review date in the past is an expired override', () => {
  // `pnpm-workspace.yaml` records, per override, the advisory it exists for and the
  // date it was reviewed. The date arrives and nothing moves it, which is how an
  // override pinned to the version that was current when it was written quietly
  // outlives its advisory — the failure the file's own header warns about.
  const yaml = [
    'overrides:',
    "  'ajv@8.20.0>fast-uri': 3.1.7",
    '  # GHSA-vfh2-g5qg-2w2x reaches us through ajv. Reviewed 2026-06-30.',
    "  'browserslist@4.28.2': 4.28.7",
    '  # GHSA-7fh5-64p2-3v2j (ReDoS) in 4.28.2 and earlier. Reviewed 2026-06-30.',
    "  'vitepress>vite': ^6.4.3",
    '  # Revisit when 2.x stabilises. Reviewed 2026-09-29.',
  ].join('\n');

  const expired = expiredOverrideReviews(yaml, '2026-10-04');

  assert.deepEqual(
    expired.map((entry) => entry.override),
    ['ajv@8.20.0>fast-uri', 'browserslist@4.28.2', 'vitepress>vite'],
  );
  assert.equal(expired[0].reviewedOn, '2026-06-30');
});

test('a comment written above the override it documents is read the same way', () => {
  // The real file puts the provenance *above* each key, not below it. A rule that
  // only read trailing comments would find no dates in `pnpm-workspace.yaml` and
  // report every override as having none.
  const yaml = [
    'overrides:',
    '  # GHSA-vfh2-g5qg-2w2x (body-parser DoS) reaches us through ajv. Reviewed 2026-09-29.',
    "  'ajv@8.20.0>fast-uri': 3.1.7",
  ].join('\n');
  const expired = expiredOverrideReviews(yaml, '2026-10-04');
  assert.deepEqual(expired, [{ override: 'ajv@8.20.0>fast-uri', reviewedOn: '2026-09-29' }]);
});

test('a review date in the future is not expired', () => {
  // A date past today still has to be acted on when it arrives; the gate cannot be
  // satisfied by moving a date out of sight.
  const yaml = ['overrides:', "  'some-pkg': 1.0.0", '  # Reviewed 2027-01-01.'].join('\n');
  assert.deepEqual(expiredOverrideReviews(yaml, '2026-10-04'), []);
});

test('an override with no review date is reported rather than trusted', () => {
  // The provenance rule the file states: an override with no provenance applies
  // forever and silently masks the next parent bump. Missing provenance is the same
  // defect, so it fails rather than passing by absence.
  const yaml = ['overrides:', "  'mystery-pkg': 1.0.0", '  # pinned by a former maintainer'].join(
    '\n',
  );
  const expired = expiredOverrideReviews(yaml, '2026-10-04');
  assert.deepEqual(
    expired.map((entry) => entry.override),
    ['mystery-pkg'],
  );
  assert.equal(expired[0].reviewedOn, null);
});

test('the parser and the drift check refuse to read a file they do not understand', () => {
  // A gate that throws on an unexpected file reports an exception instead of a
  // verdict. The fail-open direction here would be an empty baseline reading as
  // "no drift", so an unreadable file has to raise and let the CLI exit non-zero.
  assert.throws(() => parseLockfile('not a lockfile'), /importers/);
  assert.throws(() => compareResolvedToBaseline({}, null), /baseline/);
  assert.throws(() => compareResolvedToBaseline({}, { entries: [{ name: 'hono' }] }), /version/);
});

const CATALOG_YAML = `packages:
  - 'apps/*'

catalog:
  '@eslint/js': ^10.0.1
  eslint: ^10.12.0
  typescript: ^6.0.3
  vite: ^6.4.3
`;

test('the catalog block is read as a name to range map', () => {
  // Both spellings, because pnpm's catalog uses the quoted form for scoped names and
  // the bare form for the rest, and a parser that only handles one of them silently
  // drops half the catalog.
  assert.deepEqual(parseCatalog(CATALOG_YAML), {
    '@eslint/js': '^10.0.1',
    eslint: '^10.12.0',
    typescript: '^6.0.3',
    vite: '^6.4.3',
  });
});

test('a file with no catalog block is a workspace that uses none', () => {
  // Not an error. A repository may legitimately have no catalog, and reading that as
  // "the catalog is unreadable" would fail every check for the wrong reason.
  assert.deepEqual(parseCatalog('packages:\n  - apps/*\n'), {});
});

test('a catalogued dependency declared with its own range is a divergence', () => {
  // The case this exists for, reproduced from the real tree: a dependency is in the
  // catalog and two importers declare it at their own ranges. Both resolve, nothing
  // breaks, and two versions of the same package enter the tree when only one of the
  // two is bumped.
  //
  // `typescript` is in the catalog here too, and is correctly declared as `catalog:`,
  // so it is absent from the result — the check reports the exception, not the rule.
  const parsed = parseLockfile(LOCKFILE);
  const divergences = catalogDivergences(parsed, { typescript: '^6.0.3', turbo: '^2.11.5' });

  assert.deepEqual(divergences, [
    { name: 'turbo', importer: '.', specifier: '^2.10.4', catalog: '^2.11.5' },
    { name: 'turbo', importer: 'apps/web', specifier: '^2.10.4', catalog: '^2.11.5' },
  ]);
});

test('a dependency outside the catalog is not a divergence', () => {
  // `hono` is not catalogued and `apps/api` declares it directly. That is correct, and
  // a check that simply demanded `catalog:` everywhere would send the repository to add
  // a one-entry catalog for a package exactly one importer needs.
  const parsed = parseLockfile(LOCKFILE);
  const divergences = catalogDivergences(parsed, { typescript: '^6.0.3' });

  assert.deepEqual(
    divergences.map((entry) => entry.name),
    [],
  );
});

test('`catalog:` for a name with no catalog entry is reported rather than ignored', () => {
  // It fails resolution, so nothing can be reconciled by hand-editing a version — but
  // naming it here turns a resolver error into a report that says which name and which
  // importer, which is the difference between a minute and an afternoon.
  const parsed = parseLockfile(LOCKFILE);
  const divergences = catalogDivergences(parsed, {});
  assert.deepEqual(
    divergences.filter((entry) => entry.specifier === 'catalog:'),
    [{ name: 'typescript', importer: '.', specifier: 'catalog:', catalog: '' }],
  );
});
