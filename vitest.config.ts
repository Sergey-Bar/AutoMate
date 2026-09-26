import { defineConfig } from 'vitest/config';

/**
 * Every workspace package's Vitest config, so a root `pnpm test` runs them all.
 *
 * The `packages/connectors` level was missing, so the four connector suites
 * were invisible to a root run: 22 packages have a Vitest config, and this
 * array named 18. The nested glob is listed explicitly because a single-level
 * wildcard cannot reach into a nested workspace directory.
 *
 * `apps/runner` and `apps/worker` are included; both have real suites.
 */
export default defineConfig({
  test: {
    projects: [
      'apps/*/vitest.config.ts',
      'packages/*/vitest.config.ts',
      'packages/connectors/*/vitest.config.ts',
      'tools/*/vitest.config.ts',
      'tests/*/vitest.config.ts',
    ],
  },
});
