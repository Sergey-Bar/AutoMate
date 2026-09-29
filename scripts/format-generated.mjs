/**
 * Formats the files named after `--` with Prettier.
 *
 * A separate process so `build-site-pages.mjs` can format what it writes without
 * `build-site-pages.mjs` having to know where Prettier lives — and, more usefully,
 * so the resolution works from *any* directory under the repository. Resolving
 * `node_modules/prettier/bin/prettier.cjs` relative to the repository root made the
 * generator fail when run from a copy, which is precisely what the staleness gate
 * does when it checks that the committed pages match what the generator produces.
 *
 * Node resolves `prettier` through the module system, walking up from this file, so
 * the copy the gate makes still finds the repository's installed copy.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const prettierEntry = require.resolve('prettier/bin/prettier.cjs');

const files = process.argv.slice(2).filter((argument) => argument !== '--');
if (files.length === 0) {
  console.error('format-generated: no files named after `--`');
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  [prettierEntry, '--write', '--log-level', 'warn', ...files],
  {
    stdio: 'inherit',
  },
);
process.exit(result.status ?? 1);
