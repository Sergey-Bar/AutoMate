import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CORE_HEALTH_DIMENSIONS,
  FINDING_KINDS,
  FINDING_SEVERITIES,
  HEALTH_DIMENSIONS,
  HealthGradeSchema,
  OPT_IN_HEALTH_DIMENSIONS,
  type DimensionMetric,
  type HealthDimension,
} from '@automate/shared-contracts';
import {
  DEFAULT_HEALTH_WEIGHTS,
  grade,
  type FindingObservation,
  type HealthInputs,
} from './grade.js';

/**
 * Property suite for invariant HEALTH-3 in `docs/quality/property-invariants.json`:
 * **an opt-in dimension changes nothing until a policy weights it.**
 *
 * Five dimensions were added after grades had been published. A grade that moved because
 * the vocabulary grew would have told every project something about itself that nobody
 * measured, so the claim is stated over generated input rather than over one fixture.
 */
const SEED = 20261026;
const params = { seed: SEED, numRuns: 300 } as const;

function findingIn(
  dimensions: readonly HealthDimension[],
  kinds: readonly FindingObservation['kind'][] = FINDING_KINDS,
): fc.Arbitrary<FindingObservation> {
  return fc.record({
    fingerprint: fc.uuid(),
    tool: fc.constantFrom('semgrep', 'gitleaks', 'osv-scanner', 'axe'),
    ruleId: fc.constantFrom('a', 'b', 'c'),
    kind: fc.constantFrom(...kinds),
    severity: fc.constantFrom(...FINDING_SEVERITIES),
    dimension: fc.constantFrom(...dimensions),
    path: fc.constant('src/a.ts'),
    line: fc.constant(1),
    message: fc.constant('m'),
    helpUri: fc.constant(null),
    fixAvailable: fc.constantFrom(true, false, null),
    state: fc.constantFrom('open', 'open', 'accepted', 'fixed'),
  });
}

function metricIn(dimensions: readonly HealthDimension[]): fc.Arbitrary<DimensionMetric> {
  return fc.record({
    dimension: fc.constantFrom(...dimensions),
    metric: fc.constantFrom('m1', 'm2'),
    tool: fc.constant({ name: 'tool', version: null }),
    score: fc.integer({ min: 0, max: 100 }),
    summary: fc.constant('a number'),
  });
}

const coreInputs: fc.Arbitrary<HealthInputs> = fc.record({
  findingTools: fc.subarray(
    CORE_HEALTH_DIMENSIONS.map((dimension) => ({
      tool: { name: `tool-${dimension}`, version: null },
      dimensions: [dimension] as HealthDimension[],
    })),
    { minLength: 1 },
  ),
  findings: fc.array(findingIn(CORE_HEALTH_DIMENSIONS), { maxLength: 15 }),
  metrics: fc.array(metricIn(CORE_HEALTH_DIMENSIONS), { maxLength: 5 }),
  failingTests: fc.constantFrom(null, 0, 2),
});

/**
 * Opt-in signals are `issue` findings. A secret or a fixable critical vulnerability trips
 * a hard gate **wherever it is filed** — the gates key on what a finding is, not where it
 * lands — so that case is pinned separately below rather than generated here.
 */
const optInSignals = fc.record({
  findings: fc.array(findingIn(OPT_IN_HEALTH_DIMENSIONS, ['issue']), { maxLength: 10 }),
  metrics: fc.array(metricIn(OPT_IN_HEALTH_DIMENSIONS), { maxLength: 6 }),
});
type OptInSignals = { findings: FindingObservation[]; metrics: DimensionMetric[] };

/** Everything a reader of the grade acts on. `dimensions` grows by design and is left out. */
function verdict(inputs: HealthInputs) {
  const result = grade(inputs);
  return {
    score: result.score,
    letter: result.letter,
    incomplete: result.incomplete,
    cappedBy: result.cappedBy,
    cappingValue: result.cappingValue,
    limiter: result.limiter,
    gates: result.gates,
    fixNext: result.fixNext,
  };
}

function withOptIn(base: HealthInputs, extra: OptInSignals): HealthInputs {
  return {
    ...base,
    findingTools: [
      ...base.findingTools,
      { tool: { name: 'opt-in', version: null }, dimensions: [...OPT_IN_HEALTH_DIMENSIONS] },
    ],
    findings: [...base.findings, ...extra.findings],
    metrics: [...base.metrics, ...extra.metrics],
  };
}

describe('the opt-in dimensions', () => {
  it('default to a weight of zero, and the core dimensions keep theirs', () => {
    for (const dimension of OPT_IN_HEALTH_DIMENSIONS) {
      expect(DEFAULT_HEALTH_WEIGHTS[dimension]).toBe(0);
    }
    for (const dimension of CORE_HEALTH_DIMENSIONS) {
      expect(DEFAULT_HEALTH_WEIGHTS[dimension]).toBeGreaterThan(0);
    }
  });

  it('are always present in the grade, so the contract holds', () => {
    const result = grade({ findingTools: [], findings: [], metrics: [], failingTests: null });
    expect(result.dimensions.map((entry) => entry.dimension)).toEqual([...HEALTH_DIMENSIONS]);
    expect(HealthGradeSchema.safeParse(result).success).toBe(true);
  });
});

describe('HEALTH-3: an opt-in dimension changes nothing until a policy weights it', () => {
  it('adding any opt-in finding, tool or metric leaves the verdict identical', () => {
    fc.assert(
      fc.property(coreInputs, optInSignals, (base, extra) => {
        expect(verdict(withOptIn(base, extra))).toEqual(verdict(base));
      }),
      params,
    );
  });

  it('a weight in the policy makes the dimension count', () => {
    const base: HealthInputs = {
      findingTools: [
        { tool: { name: 'semgrep', version: null }, dimensions: ['security'] },
        { tool: { name: 'eslint', version: null }, dimensions: ['code-quality'] },
      ],
      findings: [],
      metrics: [
        {
          dimension: 'delivery',
          metric: 'change-failure-rate',
          tool: { name: 'automate', version: null },
          score: 40,
          summary: 'Change failure rate 30%',
        },
      ],
      failingTests: 0,
    };
    const unweighted = grade(base);
    const weighted = grade({ ...base, policy: { weights: { delivery: 10 } } });
    expect(unweighted.score).toBe(100);
    expect(weighted.score).toBeLessThan(100);
    expect(weighted.cappedBy).toBe('delivery');
  });

  it('a secret trips the gate even when it is filed under an opt-in dimension', () => {
    const result = grade({
      findingTools: [
        { tool: { name: 'semgrep', version: null }, dimensions: ['security', 'code-quality'] },
        { tool: { name: 'agent-config', version: null }, dimensions: ['ai-governance'] },
      ],
      findings: [
        {
          fingerprint: 'f1',
          tool: 'agent-config',
          ruleId: 'mcp-embedded-secret',
          kind: 'secret',
          severity: 'critical',
          dimension: 'ai-governance',
          path: '.cursor/mcp.json',
          line: 3,
          message: 'A token is written into the MCP config',
          helpUri: null,
          fixAvailable: null,
          state: 'open',
        },
      ],
      metrics: [],
      failingTests: 0,
    });
    expect(result.cappedBy).toBe('open-secret');
  });
});

describe('the property harness can fail', () => {
  it('refutes a wrong claim: a weighted opt-in metric changing nothing', () => {
    expect(() =>
      fc.assert(
        fc.property(coreInputs, optInSignals, (base, extra) => {
          const weights = Object.fromEntries(
            OPT_IN_HEALTH_DIMENSIONS.map((dimension) => [dimension, 50]),
          );
          const signals = {
            ...extra,
            metrics: [
              ...extra.metrics,
              ...OPT_IN_HEALTH_DIMENSIONS.map((dimension) => ({
                dimension,
                metric: 'low',
                tool: { name: 'tool', version: null },
                score: 1,
                summary: 'low',
              })),
            ],
          };
          expect(verdict({ ...withOptIn(base, signals), policy: { weights } })).toEqual(
            verdict({ ...base, policy: { weights } }),
          );
        }),
        params,
      ),
    ).toThrow();
  });
});
