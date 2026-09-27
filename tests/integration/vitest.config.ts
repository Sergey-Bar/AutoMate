import { defineConfig } from 'vitest/config';
import { standardCoverage } from '../../vitest.shared.js';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Every file in this package applies the **real** migration graph to a fresh
    // PGlite instance — a dozen `CREATE`/`ALTER` statements through a full Postgres
    // build, which is CPU-bound rather than I/O-bound. Two files did it in parallel
    // and each crossed Vitest's 10s default `hookTimeout`.
    //
    // That was a genuinely red gate, not a cosmetic one: a `beforeAll` over the
    // timeout fails its file and fails the run, and `pnpm verify` stopped here.
    //
    // `fileParallelism: false` is the fix, not the timeout. The files were competing
    // for the same cores while each held a Postgres WASM heap, so serialising them
    // is both faster in wall time and deterministic: one migrated database at a
    // time instead of two competing for cores. `hookTimeout` then only has to cover
    // a single file's real work rather than a contention worst case.
    fileParallelism: false,
    // Generous, because the work being waited on is genuinely long and is now
    // uncontended. A timeout here would report a failure that says nothing about the
    // migration graph.
    hookTimeout: 120_000,
    testTimeout: 60_000,
    // Standard floors plus an explicit `include`: without it, an untested
    // module is invisible to the coverage report.
    coverage: standardCoverage(process.cwd()),
  },
});
