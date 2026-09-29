import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/** The repository root, for the committed data file this suite also reads. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

const PACKAGE_ROOTS = ['apps', 'packages', 'tools', 'tests'];

/**
 * Every `vitest.config.ts` under a known workspace root, as a `/`-separated
 * path relative to the repository root.
 *
 * Derived the same way `scripts/coverage-ratchet.mjs` derives its members, so
 * this suite and the ratchet agree on what a package is. A config under a root
 * that is not listed here is invisible to both, which is why the set below is
 * asserted rather than assumed.
 */
function vitestConfigs() {
  /** @type {string[]} */
  const found = [];
  for (const root of PACKAGE_ROOTS) {
    /** @param {string} directory */
    const walk = (directory) => {
      if (!existsSync(directory)) return;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue;
          walk(full);
        } else if (entry.name === 'vitest.config.ts') {
          found.push(path.relative(REPO_ROOT, full).replaceAll('\\', '/'));
        }
      }
    };
    walk(path.join(REPO_ROOT, root));
  }
  return found.sort();
}

test('the suite can actually see the packages it is here to check', () => {
  // A gate that iterates an empty list passes vacuously. `packages/config` and
  // `apps/api` are here as the two ends of the tree — the smallest and the
  // largest — and a failure to discover either means the walk is broken, not the
  // repository.
  const configs = vitestConfigs();
  assert.ok(configs.length >= 15, `found only ${String(configs.length)} vitest configs`);
  assert.ok(configs.includes('apps/api/vitest.config.ts'));
  assert.ok(configs.includes('packages/config/vitest.config.ts'));
  assert.ok(configs.includes('apps/web/vitest.config.ts'));
});

/**
 * Packages that deliberately declare their own budget, with the reason each one
 * is exempt from the shared constant.
 *
 * `tests/integration` applies the real migration graph to a fresh PGlite instance
 * per file — a dozen statements through a full Postgres build — and sets 120s
 * because the work is genuinely long. `apps/runner` sets 30s deliberately, and
 * says why in the file: its `until` helper's own budget must fit inside the test
 * timeout, so raising the ceiling to the shared 60s would double the time a real
 * failure takes to be reported without making anything more reliable.
 *
 * Flattening these to 60s would be the wrong fix in both directions, so they are
 * named here rather than silently exempted — an exemption with no recorded reason
 * is how a package quietly keeps the wrong number.
 */
const DOCUMENTED_EXCEPTIONS = {
  'tests/integration/vitest.config.ts': 'migration graph over PGlite; 120s is real work',
  'apps/runner/vitest.config.ts': "the `until` helper's budget must fit inside the test timeout",
};

test('every vitest config carries a deliberate test timeout', () => {
  // Vitest's default is 5s, which is fine for one test file on an idle machine
  // and wrong for twenty-odd suites running at once under turbo. The measured
  // cases are recorded in `STANDARD_TEST_TIMEOUT_MS`.
  //
  // This is a gate rather than a convention because the failure it prevents is
  // invisible: a suite that times out under load looks like a failing assertion
  // on an unchanged tree, and the reflex is to re-run rather than to look. A
  // package added tomorrow inherits the shared value; one that forgot it would
  // otherwise be a flake waiting for the busiest Tuesday.
  const configs = vitestConfigs();
  const unaccounted = configs.filter((file) => {
    if (file in DOCUMENTED_EXCEPTIONS) return false;
    const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    return !source.includes('STANDARD_TEST_TIMEOUT_MS');
  });
  assert.deepEqual(
    unaccounted,
    [],
    "these vitest configs would use Vitest's 5s default: import STANDARD_TEST_TIMEOUT_MS, " +
      'or record the reason for a different budget in DOCUMENTED_EXCEPTIONS',
  );
});

test('every exception is still an exception, not a stale entry', () => {
  // An exemption outliving the problem it excused is worse than no exemption: the
  // file quietly stops being checked while the list still claims it is.
  for (const [file, reason] of Object.entries(DOCUMENTED_EXCEPTIONS)) {
    const full = path.join(REPO_ROOT, file);
    assert.ok(existsSync(full), `${file} is exempted but does not exist`);
    const source = readFileSync(full, 'utf8');
    assert.ok(
      /testTimeout:\s*[\d_]+/.test(source),
      `${file} is exempted from the shared timeout but no longer sets one of its own`,
    );
    assert.ok(reason.length > 0);
  }
});

test('the shared timeout is headroom, not a target', () => {
  // A raised ceiling only stays meaningful while it is read. If this number
  // approaches the largest observed test, the tests have moved their cost
  // somewhere it can be made cheaper and the constant should follow it down.
  const shared = readFileSync(path.join(REPO_ROOT, 'vitest.shared.ts'), 'utf8');
  const declared = /STANDARD_TEST_TIMEOUT_MS = ([\d_]+)/.exec(shared);
  assert.ok(declared, 'STANDARD_TEST_TIMEOUT_MS must be declared in vitest.shared.ts');
  assert.equal(Number((declared[1] ?? '').replaceAll('_', '')), 60_000);
  // And the reasoning has to travel with it, or the next person to raise it
  // back to 5s has nothing to weigh.
  assert.match(shared, /loaded machine/);
});
