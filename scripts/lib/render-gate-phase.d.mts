/**
 * Types for `render-gate-phase.mjs`, so its consumer in `e2e/` is checked rather than
 * implicitly `any`.
 *
 * The spec uses `phaseFor` to decide whether it is measuring or comparing, and
 * `gate-tooling.test.mjs` uses the same function to decide what tier the CI job may
 * have. Two derivations of the same property would be free to drift, and the drift
 * would be silent: the spec comparing while the job was tiered as a non-gate is
 * precisely the state this pairing exists to rule out.
 */

export declare const PHASES: {
  readonly measurement: 'pr-reporting';
  readonly threshold: 'pr-blocking';
};

export declare function phaseFor(baseline: unknown): 'measurement' | 'threshold';

export declare function tierProblems(baseline: unknown, tier: string): string[];
