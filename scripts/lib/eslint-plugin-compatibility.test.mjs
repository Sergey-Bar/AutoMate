import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The live half of widening `eslint-plugin-jsx-a11y`'s peer range to ESLint 10.
 *
 * ## Why this file exists
 *
 * `eslint-plugin-jsx-a11y@6.10.2` is the latest release, and its peer range is
 * `eslint@^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9`. There is no version of it that
 * declares ESLint 10. ESLint 9 reached end of life on 2026-08-06, so staying on it is
 * not an option, and the alternative — `strictPeerDependencies: false` — switches the
 * check off for the whole workspace to accommodate one package.
 *
 * So `pnpm-workspace.yaml` widens that one range with
 * `peerDependencyRules.allowedVersions`. **A widened range is a claim, not a fix**, and
 * this is what holds the claim to account.
 *
 * ## The failure this would otherwise be
 *
 * A lint plugin that stops reporting under a major bump produces a *clean* lint run.
 * Not a warning, not an error — silence. Every accessibility finding in the repository
 * would disappear at the moment ESLint 10 landed, the gate would go green, and nothing
 * in the output would say so. `axe-core` and `vitest-axe` would not cover the gap:
 * they run in a browser against rendered DOM, so they catch what a user cannot do, not
 * what a control has no name for. Static a11y rules catch the second class, and this
 * file proves the second class is still caught.
 *
 * That is the shape this repository keeps recording: a check that cannot tell the
 * difference between "nothing to report" and "not reporting" is the same object as a
 * check that has stopped running.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const eslintBin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
// `packages/ui/src` is one of the two globs that turn the recommended rules on, so a
// probe outside it would measure nothing and pass.
const probeDirectory = path.join(root, 'packages', 'ui', 'src');
const probe = path.join(probeDirectory, 'zz-a11y-peer-probe.tsx');

/**
 * Two components that must be reported, and one that must not.
 *
 * The safe twin is the half that matters. Without it a rule that reported everything
 * would satisfy every assertion below, and the test would pass on a plugin that had
 * stopped discriminating between a defect and correct code.
 */
const PROBE_SOURCE = `export function Broken(): JSX.Element {
  return (
    <>
      <img src="/logo.png" />
      <div onClick={() => undefined}>Click me</div>
    </>
  );
}

export function Correct(): JSX.Element {
  return (
    <>
      <img src="/logo.png" alt="Automate" />
      <button type="button" onClick={() => undefined}>
        Click me
      </button>
    </>
  );
}
`;

/**
 * @param {string} file
 * @returns {string}
 */
function lint(file) {
  const result = spawnSync(process.execPath, [eslintBin, file], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

test('the jsx-a11y rules still report a violation under the widened peer range', (t) => {
  writeFileSync(probe, PROBE_SOURCE, 'utf8');
  t.after(() => rmSync(probe, { force: true }));

  const output = lint(probe);

  // An image with no `alt`, and a click handler on a static element. Both are in the
  // recommended set, and both are the class of defect the config comment names.
  assert.match(output, /jsx-a11y\/alt-text/, `alt-text did not fire:\n${output}`);
  assert.match(
    output,
    /jsx-a11y\/(?:click-events-have-key-events|no-static-element-interactions)/,
    `neither click-handler rule fired:\n${output}`,
  );
});

test('a compliant component is not reported, so the rules are discriminating', (t) => {
  writeFileSync(probe, PROBE_SOURCE, 'utf8');
  t.after(() => rmSync(probe, { force: true }));

  const output = lint(probe);

  // The `Correct` component is reported by no jsx-a11y rule. If the plugin were
  // flagging indiscriminately — the failure mode of a misconfigured flat-config
  // spread — every id would appear and this assertion would fail.
  const correctFindings = output
    .split('\n')
    .filter((line) => /jsx-a11y/.test(line))
    .filter((line) => /\b1[0-9]:\d+\b|\b[1-9]:\d+\b/.test(line));
  assert.ok(
    correctFindings.length > 0,
    `expected the broken component to be reported, so the probe can discriminate:\n${output}`,
  );
  for (const finding of correctFindings) {
    const line = Number.parseInt(finding.trim().split(':')[0], 10);
    assert.ok(line < 8, `a jsx-a11y rule reported the compliant component: ${finding}`);
  }
});

test('the plugin is loaded rather than absent, which the flat config would otherwise hide', () => {
  // `eslint.config.js` does `...jsxA11y.configs.recommended.rules` at module load. If
  // the plugin failed to load under ESLint 10 that spread would throw on `undefined`
  // and every lint run in the repository would fail — loudly, which is the good case.
  // This assertion exists so that a future config which stops spreading the rules
  // cannot quietly retire the whole accessibility gate.
  const source = readFileSync(path.join(root, 'eslint.config.js'), 'utf8');
  assert.match(
    source,
    /jsxA11y\.configs\.recommended\.rules/,
    'the recommended rules are no longer spread into the config',
  );
  assert.match(
    source,
    /packages\/ui\/src\/\*\*\/\*\.tsx/,
    'the packages/ui tsx glob is no longer covered',
  );
});

test('no package declares its own ESLint config, because ESLint 10 makes that fatal in silence', () => {
  // **This is the whole reason the accessibility gate above is trustworthy.**
  //
  // Every package used to carry a one-line `eslint.config.js` doing
  // `export { default } from '../../eslint.config.js'`. Under ESLint 9 that was
  // harmless: config lookup started at the working directory, so a root run used the
  // root config.
  //
  // ESLint 10 made lookup start at **each linted file's directory** and walk up. The
  // nearest config to any file inside a package is that package's shim, and the shim's
  // **directory becomes the base path** the `files` patterns are resolved against. So
  // `packages/ui/src/**/*.tsx` was resolved as `packages/ui/packages/ui/src/**/*.tsx`
  // and matched nothing — the jsx-a11y rules, the glass ban, the double-assertion ban
  // and the `.skip`/`.only` ban all silently stopped applying to every file in every
  // package, while `pnpm lint` stayed green.
  //
  // The per-package `lint` scripts (`eslint --max-warnings=0 src/` run with the package
  // as the working directory) were *already* resolving the base path wrongly under
  // ESLint 9. Removing the shims fixed that too: `node --test` on this suite lints from
  // inside `packages/ui`, and the rules now fire.
  //
  // A shim is one line and looks like good hygiene, which is exactly why this test
  // exists. Deleting 24 files left no trace in the lint output to notice.
  const nested = [
    'apps/api',
    'apps/runner',
    'apps/web',
    'apps/worker',
    'apps/tui',
    'packages/ui',
    'packages/db',
    'packages/shared-contracts',
    'packages/auth',
    'packages/automation',
    'packages/config',
    'packages/orchestration',
    'packages/projects',
    'packages/realtime',
    'packages/reporter',
    'packages/reporting',
    'packages/runner-sdk',
    'packages/connectors/github',
    'packages/connectors/jira',
    'packages/connectors/sdk',
    'packages/connectors/slack',
    'tests/contract',
    'tests/integration',
  ];

  const found = [];
  for (const directory of nested) {
    for (const name of ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs']) {
      if (existsSync(path.join(root, directory, name))) found.push(`${directory}/${name}`);
    }
  }

  assert.deepEqual(
    found,
    [],
    'a nested ESLint config moves the base path under ESLint 10 and silently disables ' +
      'every path-scoped rule for the files beneath it. Delete it: ESLint walks up to ' +
      'the root config on its own.',
  );
});
