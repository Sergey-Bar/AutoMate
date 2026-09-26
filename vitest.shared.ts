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
