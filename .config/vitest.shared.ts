import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The standard coverage floors for this repository.
 *
 * These are the plan's "clean-as-you-code" levels, not a percentage contest: a
 * change is expected to arrive at ≥90% lines and ≥80% branches.
 *
 * They are applied by `scripts/coverage-ratchet.mjs` against each package's
 * recorded floor, not as per-package Vitest `thresholds`. Enforcing them
 * per-package would fail four packages that are genuinely under-covered today
 * (`apps/worker` 57%, `packages/db` 31%, `packages/ui` 62%,
 * `tools/migrate-cli` 78%), and a gate that blocks every test run gets raised
 * until it means nothing. The ratchet records the real number per package and
 * fails on regression, so the floor only ever moves up.
 */
export const STANDARD_THRESHOLDS = {
  statements: 90,
  branches: 80,
  functions: 90,
  lines: 90,
} as const;

/**
 * The per-test budget, in milliseconds.
 *
 * Vitest's default is 5s, which is a reasonable default for a machine that is
 * running one test file. This repository runs twenty-odd package suites at once
 * under turbo, and the difference is not marginal: `packages/reporter`'s
 * whole-tree ownership scan took 0.3s in isolation and was observed at 25.1s
 * under `pnpm test`; `packages/runner-sdk`'s PBKDF2 and sealed-queue round-trips
 * were observed at 2.3–3.5s each against 2.45s for its entire file in isolation.
 * `apps/api` recorded 31.5s, 44.0s and 57.0s for the same test across three
 * runs of an unchanged tree.
 *
 * None of those is a slow test. All of them are a slow *machine*, and the
 * assertion was identical in every case. A timeout that reports a loaded machine
 * as a failing repository is a timeout people learn to re-run, and a gate that
 * must be re-run before it can be believed provides nothing at all — which is how
 * a flaky gate gets switched off rather than fixed.
 *
 * 60s is headroom for the observed worst case, not a target. A test that
 * genuinely needs a minute has moved its cost somewhere it can be made cheaper.
 *
 * Nothing about what is asserted changes here. Only how long the harness waits
 * before saying so.
 */
export const STANDARD_TEST_TIMEOUT_MS = 60_000;

/**
 * Coverage measurement config for a package.
 *
 * `all: true` with an explicit `include` is the part that matters. Without it,
 * V8 only reports files a test happened to import, so an untested module is
 * invisible and the gate passes while measuring almost nothing.
 *
 * No `thresholds` here on purpose — see {@link STANDARD_THRESHOLDS}.
 */
export function standardCoverage(_packageRoot: string) {
  return {
    provider: 'v8' as const,
    reporter: ['text', 'json-summary', 'json', 'html'],
    reportsDirectory: './coverage',
    all: true,
    include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.js', 'src/**/*.mjs', 'src/**/*.vue'],
    exclude: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.spec.ts',
      'src/**/*.spec.tsx',
      'src/**/__tests__/**',
      'src/**/*.test-d.ts',
      'src/**/*.d.ts',
      '**/node_modules/**',
      // `index.ts` is deliberately *not* excluded. Several packages keep all of
      // their code in `src/index.ts`, so excluding barrels made their coverage
      // report 0/0 — a gate measuring nothing while reporting a number.
    ],
  };
}

/** True when a directory holds any source file, so the gate cannot be vacuous. */
export function hasSourceFiles(packageRoot: string): boolean {
  const sourceRoot = path.join(packageRoot, 'src');
  try {
    for (const entry of readdirSync(sourceRoot)) {
      if (statSync(path.join(sourceRoot, entry)).isFile() && !/\.test\.|\.spec\./.test(entry)) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * The whole of a node package's `vitest.config.ts`.
 *
 * ## Why this exists
 *
 * Five packages shipped a byte-identical seventeen-line config file, and jscpd
 * reported all five as clones. That is not untidy — it is five places a change has to
 * be made, and the realistic outcome is that the sixth package copies the first one
 * from an older commit and quietly keeps a different coverage reporter.
 *
 * `STANDARD_TEST_TIMEOUT_MS` already lives here for exactly this reason, and the
 * timeout is the clause that mattered most: a package whose config predates it keeps
 * Vitest's 5s default and reports a loaded machine as a failing repository.
 *
 * The one thing a package may still vary is `environment`, and `jsdom` packages
 * override it explicitly rather than by copying the file.
 */
export function standardVitestConfig(
  packageRoot: string,
  overrides: { environment?: 'node' | 'jsdom' } = {},
) {
  return {
    test: {
      environment: overrides.environment ?? ('node' as const),
      globals: true,
      testTimeout: STANDARD_TEST_TIMEOUT_MS,
      hookTimeout: STANDARD_TEST_TIMEOUT_MS,
      coverage: {
        ...standardCoverage(packageRoot),
        provider: 'v8' as const,
        reporter: ['text', 'json-summary', 'json', 'html'],
        reportsDirectory: './coverage',
      },
    },
  };
}
