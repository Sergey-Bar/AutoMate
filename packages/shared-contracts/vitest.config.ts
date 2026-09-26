import { defineConfig } from 'vitest/config';
import { standardCoverage } from '../../vitest.shared.js';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    // This config used to be hand-rolled: its own `all: true`, its own reporters,
    // its own thresholds at 95/90/95/95, and an `src/**/index.ts` exclusion.
    //
    // That exclusion contradicted the stated policy in `vitest.shared.ts`, which
    // says barrels are deliberately *not* excluded because packages that keep
    // their code in `src/index.ts` otherwise report 0/0. Two authorities, one of
    // them contradicting the other, is how a floor ends up meaning nothing. The
    // floor for every package now lives in one place: its row in
    // `coverage-baseline.json`, enforced by `pnpm coverage:ratchet`.
    coverage: standardCoverage(process.cwd()),
  },
});
