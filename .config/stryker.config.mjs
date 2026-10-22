// @ts-check
import { fileURLToPath } from 'node:url';
/**
 * StrykerJS configuration shared by the five core packages (see MUTATION_PACKAGES in
 * `scripts/lib/mutation-ratchet.mjs`). `scripts/mutation.mjs` runs it with the package
 * directory as the working directory, so every glob below is relative to that package.
 *
 * `inPlace: true`, on purpose: each package's `vitest.config.ts` imports
 * `../../.config/vitest.shared.js`, and Stryker's default sandbox copies the package to
 * `.stryker-tmp/sandbox-*`, two directories deeper, where that import does not resolve.
 * Stryker restores the mutated files itself; a killed run is repaired with `git checkout`.
 *
 * `coverageAnalysis: perTest` runs only the tests that cover a mutant. Incremental mode
 * is off, so a CI run measures the whole package rather than trusting a stale file.
 *
 * Nothing is excluded to raise a score. A `// Stryker disable` in source needs a written
 * reason beside it.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  testRunner: 'vitest',
  // Stryker discovers `@stryker-mutator/*` plugins from the working directory, which is a
  // package that (correctly) does not depend on it. Resolve from this file instead - the
  // root `node_modules` - and pass the path in, or pnpm's isolated tree hides the runner.
  plugins: [fileURLToPath(import.meta.resolve('@stryker-mutator/vitest-runner'))],
  inPlace: true,
  coverageAnalysis: 'perTest',
  incremental: false,
  mutate: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.d.ts',
    // Test fixtures and support are test code, not code under test.
    '!src/**/test-support/**',
    '!src/**/__tests__/**',
  ],
  reporters: ['json', 'clear-text', 'progress'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
  timeoutMS: 10000,
  timeoutFactor: 2,
  concurrency: 4,
  // Mutation testing a mutant that does not compile is noise; the vitest runner has no
  // type checker, so mutants that break types still run and are killed or survive on
  // behaviour, which is the point.
  ignoreStatic: false,
};
