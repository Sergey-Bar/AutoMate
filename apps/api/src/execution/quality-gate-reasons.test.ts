import { describe, expect, it } from 'vitest';
import { evaluateQualityGate } from './quality-gate.js';

/**
 * X-5: "Why did this verdict?" had no answer anywhere in the product.
 *
 * The reasons used to be a code and, at best, the observed value —
 * `threshold:PASS_RATE_98.20`, `threshold:DURATION`. A reader could see *that* a gate
 * failed and not *why*: 98.20 reads like a pass until you know the threshold was 99,
 * and the duration refusal carried neither of the two numbers that were compared. The
 * rule that fired was named by a field name rather than an identifier, so it could not
 * be cited or resolved to configuration.
 *
 * `GateReasonSchema` is an opaque non-empty string, so the fix is contract-compatible:
 * the leading code is unchanged and a machine-readable tail is appended. These cases
 * assert both halves, because a change that broke the prefix would silently stop the
 * existing `startsWith('threshold:')` classification from working.
 */

const BASE_RUN = {
  id: 'run-1',
  workspaceId: 'workspace-1',
  projectId: 'p',
  environmentId: 'e',
  releaseId: 'r',
  branch: 'main',
  commit: 'abc',
  phase: 'complete',
  outcome: 'passed',
  idempotencyKey: 'idem-1',
  startedAt: '2026-09-27T00:00:00.000Z',
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:01.000Z',
  rawEvidenceRefs: [],
  artifacts: [],
};

const POLICY = {
  version: 1,
  hash: 'h'.repeat(64),
  requiredDomains: ['browser'],
  rules: [],
  isDefault: true,
  browserPassRateThreshold: 99,
  maxFlakyRate: 5,
  maxDurationMs: 60_000,
};

/**
 * A run fixture.
 *
 * Typed as the gate's own parameter type rather than left as a widened object literal,
 * so the fixture states the shape it claims to be and a change to `ExecutionRun` is
 * caught here rather than at three call sites. The `unknown` overrides are the point: a
 * case varies one field and nothing else.
 */
type GateRun = Parameters<typeof evaluateQualityGate>[0]['run'];

const runWith = (overrides: Record<string, unknown>): GateRun =>
  ({ ...BASE_RUN, ...overrides }) as GateRun;

/** Pull the `key=value` tail of a reason into a map, ignoring the leading code. */
function detailOf(reason: string): { code: string; detail: Record<string, string> } {
  // Destructuring `[code, tail]` kept only the *first* tail pair and discarded the
  // rest, so `required` and `rule` were always undefined — a helper that silently
  // drops the data it exists to extract.
  const parts = reason.split('; ');
  const code = parts[0] ?? '';
  const detail: Record<string, string> = {};
  for (const pair of parts.slice(1)) {
    const [key, ...rest] = pair.split('=');
    if (key !== undefined) detail[key] = rest.join('=').replace(/^"|"$/g, '');
  }
  return { code, detail };
}

describe('a refusal says which rule, against what, and by how much', () => {
  it('names the observed value, the threshold, and the rule for a pass-rate refusal', () => {
    const summary = { total: 100, passed: 98, failed: 1, skipped: 0, flaky: 0, durationMs: 1_000 };
    const result = evaluateQualityGate({
      run: runWith({ summary, outcome: 'failed' }),
      policy: POLICY as never,
    });

    const reason = result.reasons.find((r) => r.startsWith('threshold:PASS_RATE'));
    expect(reason, `no pass-rate refusal in ${JSON.stringify(result.reasons)}`).toBeDefined();

    const { detail } = detailOf(String(reason));
    // 98.20 alone reads like a pass. With the required value beside it, the verdict is
    // answerable without reading the policy.
    expect(detail['observed']).toBe('98.00');
    expect(detail['required']).toBe('99');
    // A stable identifier, not a label: this is resolvable to configuration.
    expect(detail['rule']).toBe('browserPassRateThreshold');
  });

  it('keeps the leading code unchanged, so existing classification still works', () => {
    // The tail is additive. If this regresses, `startsWith('threshold:')` and
    // `endsWith('…RUNNER_INFRASTRUCTURE')` stop matching and every reason silently
    // changes category.
    const summary = { total: 100, passed: 98, failed: 1, skipped: 0, flaky: 0, durationMs: 90_000 };
    const result = evaluateQualityGate({
      run: runWith({ summary, outcome: 'failed' }),
      policy: POLICY as never,
    });
    const thresholds = result.reasons.filter((r) => r.startsWith('threshold:'));
    expect(thresholds.length).toBeGreaterThan(0);
    for (const reason of thresholds) {
      expect(reason.split(';')[0]).toMatch(/^threshold:[A-Z_]+$/);
    }
  });

  it('omits a detail rather than writing an empty one', () => {
    // `maxDurationMs: null` means "not configured", and `required=null` in the tail would
    // read as a rule that exists with no value.
    const summary = { total: 10, passed: 10, failed: 0, skipped: 0, flaky: 0, durationMs: 90_000 };
    const result = evaluateQualityGate({
      run: runWith({ summary }),
      policy: { ...POLICY, maxDurationMs: null } as never,
    });
    expect(result.reasons.some((r) => r.includes('required=') && r.endsWith('required='))).toBe(
      false,
    );
  });
});
