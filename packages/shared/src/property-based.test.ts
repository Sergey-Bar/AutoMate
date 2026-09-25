/**
 * Property-based tests for Automate shared schemas and utility functions.
 *
 * Verifies:
 *  - Schema parse idempotency: schema.parse(schema.parse(data)) equals schema.parse(data)
 *  - parseJsonSafe round-trips valid JSON values
 *  - parseJsonSafe returns the fallback for strings that are never valid JSON
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ConversationSchema,
  ExecutionLogSchema,
  MessageSchema,
  parseJsonSafe,
} from './index.js';

// Deterministic seed; 200 examples per property keeps the suite fast.
fc.configureGlobal({ seed: 42, numRuns: 200 });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate either an arbitrary value or null (nullable field). */
const nullable = <T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | null> =>
  fc.oneof(arb, fc.constant(null));

const nonEmptyString = fc.string({ minLength: 1, maxLength: 50 });

// ─── Arbitraries for each schema ──────────────────────────────────────────────

const conversationArb = fc.record({
  id: nonEmptyString,
  title: nullable(fc.string()),
  flowTemplateId: nullable(fc.string()),
  createdAt: fc.string(),
  updatedAt: fc.string(),
});

const messageArb = fc.record({
  id: nonEmptyString,
  conversationId: nonEmptyString,
  role: fc.constantFrom('user', 'assistant', 'system', 'tool'),
  content: fc.string(),
  toolCallId: nullable(fc.string()),
  toolName: nullable(fc.string()),
  metadata: nullable(fc.string()),
  createdAt: fc.string(),
});

const executionLogArb = fc.record({
  id: nonEmptyString,
  conversationId: nullable(fc.string()),
  toolName: nonEmptyString,
  input: fc.string(),
  output: nullable(fc.string()),
  status: fc.constantFrom('running', 'success', 'error', 'timeout'),
  durationMs: nullable(fc.nat({ max: 1_000_000 })),
  errorMessage: nullable(fc.string()),
  createdAt: fc.string(),
});

// ─── Schema idempotency: parse(parse(data)) equals parse(data) ────────────────

describe('ConversationSchema property', () => {
  it('parse is idempotent', () => {
    fc.assert(
      fc.property(conversationArb, (data) => {
        const once = ConversationSchema.parse(data);
        const twice = ConversationSchema.parse(once);
        expect(twice).toStrictEqual(once);
      }),
    );
  });
});

describe('MessageSchema property', () => {
  it('parse is idempotent', () => {
    fc.assert(
      fc.property(messageArb, (data) => {
        const once = MessageSchema.parse(data);
        const twice = MessageSchema.parse(once);
        expect(twice).toStrictEqual(once);
      }),
    );
  });
});

describe('ExecutionLogSchema property', () => {
  it('parse is idempotent', () => {
    fc.assert(
      fc.property(executionLogArb, (data) => {
        const once = ExecutionLogSchema.parse(data);
        const twice = ExecutionLogSchema.parse(once);
        expect(twice).toStrictEqual(once);
      }),
    );
  });
});

// ─── parseJsonSafe: round-trips any JSON-serializable value ──────────────────

describe('parseJsonSafe property', () => {
  it('round-trips any JSON-serializable value', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const json = JSON.stringify(value);
        const result = parseJsonSafe<unknown>(json, null);
        expect(result).toStrictEqual(value);
      }),
    );
  });

  it('returns the fallback for strings that are never valid JSON', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }),
        fc.string(),
        (suffix, fallback) => {
          // The "!!!" prefix is never a valid JSON start character
          const invalidJson = `!!!${suffix}`;
          const result = parseJsonSafe<string>(invalidJson, fallback);
          expect(result).toBe(fallback);
        },
      ),
    );
  });
});
