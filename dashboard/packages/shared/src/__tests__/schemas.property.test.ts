/**
 * T22 — Property-based tests for Dashboard shared schemas.
 *
 * Strategy:
 *  - Roundtrip: parse(parse(x)) deepEquals parse(x) for all valid inputs
 *  - JSON: for JSON-serialisable inputs, parse(JSON.parse(JSON.stringify(x))) deepEquals x
 *
 * zod-fast-check generates arbitraries from Zod schemas automatically.
 * Schemas with z.number() fields that can produce Infinity (not JSON-safe)
 * use .override() on the specific schema instances to restrict to finite ints.
 *
 * StepSchema (z.lazy) is intentionally excluded — not supported by zod-fast-check.
 */
import fc from 'fast-check';
import { ZodFastCheck } from 'zod-fast-check';
import {
  RunSchema,
  TestSchema,
  ResultSchema,
  CompareRowSchema,
  UserSchema,
  ApiKeySchema,
  AiProviderConfigSchema,
} from '../index.js';

// Deterministic seed; 100 examples per property keeps the suite fast.
fc.configureGlobal({ seed: 42, numRuns: 100 });

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Returns true when val can survive a JSON.stringify → JSON.parse roundtrip. */
function isJsonSafe(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === 'number') return Number.isFinite(val);
  if (Array.isArray(val)) return val.every(isJsonSafe);
  if (typeof val === 'object') {
    return Object.values(val as Record<string, unknown>).every(isJsonSafe);
  }
  return true;
}

// ─── RunSchema ────────────────────────────────────────────────────────────────

describe('RunSchema', () => {
  // Plain arbitrary — may contain Infinity for number fields; fine for roundtrip.
  const arb = ZodFastCheck().inputOf(RunSchema);

  // Finite-only arbitrary for JSON test — override every number field.
  const finiteArb = ZodFastCheck()
    .override(RunSchema.shape.total, fc.nat())
    .override(RunSchema.shape.passed, fc.nat())
    .override(RunSchema.shape.failed, fc.nat())
    .override(RunSchema.shape.flaky, fc.nat())
    .override(RunSchema.shape.skipped, fc.nat())
    .override(RunSchema.shape.durationMs, fc.option(fc.nat(), { nil: null as null }))
    .inputOf(RunSchema);

  it('roundtrip: parse is idempotent', () => {
    fc.assert(
      fc.property(arb, (v) => {
        const parsed = RunSchema.parse(v);
        expect(RunSchema.parse(parsed)).toEqual(parsed);
      }),
    );
  });

  it('JSON serialization survives', () => {
    fc.assert(
      fc.property(finiteArb, (v) => {
        const parsed = RunSchema.parse(v);
        const json = JSON.stringify(parsed);
        expect(RunSchema.parse(JSON.parse(json))).toEqual(parsed);
      }),
    );
  });
});

// ─── TestSchema ───────────────────────────────────────────────────────────────

describe('TestSchema', () => {
  const arb = ZodFastCheck().inputOf(TestSchema);

  // All number fields are nullable — override each to finite ints or null.
  const nullableNat = fc.option(fc.nat(), { nil: null as null });
  const finiteArb = ZodFastCheck()
    .override(TestSchema.shape.line, nullableNat)
    .override(TestSchema.shape.column, nullableNat)
    .override(TestSchema.shape.durationMs, nullableNat)
    .override(TestSchema.shape.retryCount, nullableNat)
    .override(TestSchema.shape.workerIndex, nullableNat)
    .inputOf(TestSchema);

  it('roundtrip: parse is idempotent', () => {
    fc.assert(
      fc.property(arb, (v) => {
        const parsed = TestSchema.parse(v);
        expect(TestSchema.parse(parsed)).toEqual(parsed);
      }),
    );
  });

  it('JSON serialization survives', () => {
    fc.assert(
      fc.property(finiteArb, (v) => {
        const parsed = TestSchema.parse(v);
        const json = JSON.stringify(parsed);
        expect(TestSchema.parse(JSON.parse(json))).toEqual(parsed);
      }),
    );
  });
});

// ─── ResultSchema ─────────────────────────────────────────────────────────────

describe('ResultSchema', () => {
  const arb = ZodFastCheck().inputOf(ResultSchema);

  const nullableNat = fc.option(fc.nat(), { nil: null as null });
  const finiteArb = ZodFastCheck()
    .override(ResultSchema.shape.retry, fc.nat())
    .override(ResultSchema.shape.durationMs, nullableNat)
    .override(ResultSchema.shape.workerIndex, nullableNat)
    .override(ResultSchema.shape.parallelIndex, nullableNat)
    .inputOf(ResultSchema);

  it('roundtrip: parse is idempotent', () => {
    fc.assert(
      fc.property(arb, (v) => {
        const parsed = ResultSchema.parse(v);
        expect(ResultSchema.parse(parsed)).toEqual(parsed);
      }),
    );
  });

  it('JSON serialization survives', () => {
    fc.assert(
      fc.property(finiteArb, (v) => {
        const parsed = ResultSchema.parse(v);
        const json = JSON.stringify(parsed);
        expect(ResultSchema.parse(JSON.parse(json))).toEqual(parsed);
      }),
    );
  });
});

// ─── CompareRowSchema ─────────────────────────────────────────────────────────

describe('CompareRowSchema', () => {
  const arb = ZodFastCheck().inputOf(CompareRowSchema);

  const nullableNat = fc.option(fc.nat(), { nil: null as null });
  const finiteArb = ZodFastCheck()
    .override(CompareRowSchema.shape.durationA, nullableNat)
    .override(CompareRowSchema.shape.durationB, nullableNat)
    .inputOf(CompareRowSchema);

  it('roundtrip: parse is idempotent', () => {
    fc.assert(
      fc.property(arb, (v) => {
        const parsed = CompareRowSchema.parse(v);
        expect(CompareRowSchema.parse(parsed)).toEqual(parsed);
      }),
    );
  });

  it('JSON serialization survives', () => {
    fc.assert(
      fc.property(finiteArb, (v) => {
        const parsed = CompareRowSchema.parse(v);
        const json = JSON.stringify(parsed);
        expect(CompareRowSchema.parse(JSON.parse(json))).toEqual(parsed);
      }),
    );
  });
});

// ─── UserSchema ───────────────────────────────────────────────────────────────

describe('UserSchema', () => {
  // z.string().email() — ZodFastCheck and fc.emailAddress() both produce
  // RFC 5321 addresses (e.g. "/a@a.aa") that Zod v3's stricter regex rejects.
  // Build the email from safe alphanumeric parts to guarantee acceptance.
  const emailArb = fc
    .tuple(fc.nat({ max: 9999 }), fc.nat({ max: 9999 }))
    .map(([n, m]) => `user${n}@domain${m}.test`);

  const validRoles = ['admin', 'editor', 'viewer'] as const;

  const arb = fc.record({
    id: fc.string({ minLength: 1 }),
    email: emailArb,
    displayName: fc.string(),
    role: fc.constantFrom(...validRoles),
    tenantId: fc.option(fc.string({ minLength: 1 }), { nil: null }),
    createdAt: fc.string({ minLength: 1 }),
    updatedAt: fc.string({ minLength: 1 }),
  });

  it('roundtrip: parse is idempotent', () => {
    fc.assert(
      fc.property(arb, (v) => {
        const parsed = UserSchema.parse(v);
        expect(UserSchema.parse(parsed)).toEqual(parsed);
      }),
    );
  });

  it('JSON serialization survives', () => {
    fc.assert(
      fc.property(arb, (v) => {
        const parsed = UserSchema.parse(v);
        const json = JSON.stringify(parsed);
        expect(UserSchema.parse(JSON.parse(json))).toEqual(parsed);
      }),
    );
  });
});

// ─── ApiKeySchema ─────────────────────────────────────────────────────────────

describe('ApiKeySchema', () => {
  const arb = ZodFastCheck().inputOf(ApiKeySchema);

  it('roundtrip: parse is idempotent', () => {
    fc.assert(
      fc.property(arb, (v) => {
        const parsed = ApiKeySchema.parse(v);
        expect(ApiKeySchema.parse(parsed)).toEqual(parsed);
      }),
    );
  });

  it('JSON serialization survives', () => {
    fc.assert(
      fc.property(arb, (v) => {
        const parsed = ApiKeySchema.parse(v);
        const json = JSON.stringify(parsed);
        expect(ApiKeySchema.parse(JSON.parse(json))).toEqual(parsed);
      }),
    );
  });
});

// ─── AiProviderConfigSchema (discriminated union — per-variant) ───────────────

describe('AiProviderConfigSchema', () => {
  // Test each provider variant independently.
  for (const [provider, variant] of AiProviderConfigSchema.optionsMap.entries()) {
    it(`variant "${provider}": roundtrip parse is idempotent`, () => {
      const arb = ZodFastCheck().inputOf(variant);
      fc.assert(
        fc.property(arb, (v) => {
          const parsed = AiProviderConfigSchema.parse(v);
          expect(AiProviderConfigSchema.parse(parsed)).toEqual(parsed);
        }),
      );
    });
  }

  // JSON roundtrip across the full union.
  // visionDiffThreshold: z.number().optional() — use fc.pre to skip Infinity.
  it('JSON serialization survives (finite values)', () => {
    const arb = ZodFastCheck().inputOf(AiProviderConfigSchema);
    fc.assert(
      fc.property(arb, (v) => {
        fc.pre(isJsonSafe(v));
        const parsed = AiProviderConfigSchema.parse(v);
        const json = JSON.stringify(parsed);
        expect(AiProviderConfigSchema.parse(JSON.parse(json))).toEqual(parsed);
      }),
    );
  });
});
