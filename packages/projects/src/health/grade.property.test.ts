import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FINDING_SEVERITIES, HEALTH_DIMENSIONS, FINDING_KINDS } from '@automate/shared-contracts';
import { GATE_CEILING, grade, type FindingObservation, type HealthInputs } from './grade.js';

/**
 * Property suites for invariants HEALTH-1 and HEALTH-2 in `docs/quality/property-invariants.json`.
 * A fixed seed and `numRuns`, so a red run is the same red run on every host.
 */
const SEED = 20261023;
const params = { seed: SEED, numRuns: 300 } as const;

const findingArb: fc.Arbitrary<FindingObservation> = fc.record({
  fingerprint: fc.uuid(),
  tool: fc.constantFrom('semgrep', 'gitleaks', 'osv-scanner', 'eslint'),
  ruleId: fc.constantFrom('a', 'b', 'c', 'd'),
  kind: fc.constantFrom(...FINDING_KINDS),
  severity: fc.constantFrom(...FINDING_SEVERITIES),
  dimension: fc.constantFrom(...HEALTH_DIMENSIONS),
  path: fc.constant('src/a.ts'),
  line: fc.constant(1),
  message: fc.constant('m'),
  helpUri: fc.constant(null),
  fixAvailable: fc.constantFrom(true, false, null),
  state: fc.constantFrom('open', 'open', 'open', 'accepted', 'fixed'),
});

const inputsArb: fc.Arbitrary<HealthInputs> = fc.record({
  findingTools: fc.constant(
    HEALTH_DIMENSIONS.map((dimension) => ({
      tool: { name: `tool-${dimension}`, version: null },
      dimensions: [dimension],
    })),
  ),
  findings: fc.array(findingArb, { maxLength: 25 }),
  metrics: fc.constant([]),
  failingTests: fc.constantFrom(null, 0, 2),
});

describe('HEALTH-1: an open finding never raises a score', () => {
  it('adding one open finding leaves every dimension and the overall score no higher', () => {
    fc.assert(
      fc.property(inputsArb, findingArb, (base, extra) => {
        const before = grade(base);
        const after = grade({ ...base, findings: [...base.findings, { ...extra, state: 'open' }] });
        expect(after.score ?? 0).toBeLessThanOrEqual(before.score ?? 0);
        for (const dimension of after.dimensions) {
          const prior = before.dimensions.find((entry) => entry.dimension === dimension.dimension);
          expect(dimension.score ?? 0).toBeLessThanOrEqual(prior?.score ?? 0);
        }
      }),
      params,
    );
  });
});

describe('the property harness can fail', () => {
  it('refutes a wrong claim: an open critical finding raising the score', () => {
    expect(() =>
      fc.assert(
        fc.property(inputsArb, findingArb, (base, extra) => {
          const before = grade(base);
          const after = grade({
            ...base,
            findings: [...base.findings, { ...extra, state: 'open', severity: 'critical' }],
          });
          expect(after.score ?? 0).toBeGreaterThan(before.score ?? 0);
        }),
        params,
      ),
    ).toThrow();
  });
});

describe('HEALTH-2: a tripped, enabled gate is never exceeded', () => {
  it('the overall score stays at or below the ceiling while any enabled gate is tripped', () => {
    fc.assert(
      fc.property(inputsArb, (inputs) => {
        const result = grade(inputs);
        if (result.gates.some((gate) => gate.enabled && gate.tripped)) {
          expect(result.score ?? 0).toBeLessThanOrEqual(GATE_CEILING);
          expect(result.letter === null || result.letter === 'D' || result.letter === 'F').toBe(
            true,
          );
        }
      }),
      params,
    );
  });
});
