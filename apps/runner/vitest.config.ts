import { defineConfig } from 'vitest/config';
import { standardCoverage } from '../../vitest.shared.js';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Standard floors plus an explicit `include`: without it, an untested
    // module is invisible to the coverage report.
    coverage: standardCoverage(process.cwd()),
    include: ['src/**/*.test.ts'],
    // This file does real, repeated filesystem work: `exhaustRetryBudget` runs a whole
    // retry budget against a `DurableSpool` on disk, and one test calls it three times.
    // Vitest's 5 s default was exactly equal to the `until` helper's own budget, so the
    // helper could never reach its budget and throw its labelled error — the test simply
    // died with a bare timeout instead, which is both less useful and unrecoverable in
    // the sense that a reader is told nothing about what was being waited for.
    //
    // 30 s is headroom, not a target: on an idle machine this file finishes in about
    // 1.5 s. It is set so a loaded machine does not report a healthy runner as broken,
    // which is the reasoning `apps/web/vitest.config.ts` already applies for the same
    // reason with the same numbers of observations.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
