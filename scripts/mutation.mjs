/**
 * `pnpm mutation`: runs StrykerJS once per core package and leaves
 * `<package>/reports/mutation/mutation.json` for `pnpm mutation:ratchet`.
 *
 *   node scripts/mutation.mjs [packages/auth ...]   (default: all five)
 *
 * Tier: nightly. Stryker runs in place (`inPlace: true`, see `.config/stryker.config.mjs`)
 * because each package's Vitest config imports `../../.config/vitest.shared.js`, which a
 * copied sandbox would break. Exits non-zero if any package's run fails; a package that
 * produced no report is then reported by the ratchet rather than skipped here.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTATION_PACKAGES } from './lib/mutation-ratchet.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !MUTATION_PACKAGES.includes(name));
if (unknown.length > 0) {
  console.error(
    `Not a mutation package: ${unknown.join(', ')}. Known: ${MUTATION_PACKAGES.join(', ')}`,
  );
  process.exit(2);
}
const targets = requested.length > 0 ? requested : [...MUTATION_PACKAGES];
const stryker = path.join(root, 'node_modules', '@stryker-mutator', 'core', 'bin', 'stryker.js');
// Packages import `@automate/shared-contracts` through its `dist/` entry. Without a build
// those test files fail to load and Stryker reports their mutants as NoCoverage instead of
// failing - a score that quietly measures less than the suite. Refuse to run unbuilt.
const builtEntry = path.join(root, 'packages', 'shared-contracts', 'dist', 'index.js');
if (!existsSync(builtEntry)) {
  console.error(
    'packages/shared-contracts/dist is missing. Run `pnpm build` before `pnpm mutation`.',
  );
  process.exit(2);
}
const config = path.join(root, '.config', 'stryker.config.mjs');

let failed = false;
for (const name of targets) {
  console.log(`\n=== mutation: ${name} ===`);
  const result = spawnSync(process.execPath, [stryker, 'run', config], {
    cwd: path.join(root, name),
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`stryker exited ${String(result.status)} for ${name}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
