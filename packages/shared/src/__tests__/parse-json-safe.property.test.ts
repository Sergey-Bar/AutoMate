import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseJsonSafe } from '../index.js';

fc.configureGlobal({ seed: 42, numRuns: 100 });

describe('parseJsonSafe — property tests', () => {
  it('roundtrip: parseJsonSafe(validJsonString, fallback) equals JSON.parse(validJsonString)', () => {
    // Use fc.json() to generate valid JSON strings directly — avoids -0 / Infinity
    // edge cases that don't round-trip through JSON.stringify(fc.jsonValue()).
    fc.assert(
      fc.property(
        fc.json(),
        fc.anything(),
        (jsonString, fallback) => {
          const expected = JSON.parse(jsonString) as unknown;
          const result = parseJsonSafe<unknown>(jsonString, fallback);
          expect(result).toEqual(expected);
        },
      ),
    );
  });

  it('invalid JSON always returns fallback (strings prefixed with "!" are never valid JSON)', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 200 }).map((s) => `!${s}`),
        fc.anything(),
        (invalid, fallback) => {
          const result = parseJsonSafe<unknown>(invalid, fallback);
          expect(result).toBe(fallback);
        },
      ),
    );
  });

  it('null always returns fallback regardless of fallback type', () => {
    fc.assert(
      fc.property(fc.anything(), (fallback) => {
        const result = parseJsonSafe<unknown>(null, fallback);
        expect(result).toBe(fallback);
      }),
    );
  });

  it('never throws for any string or null input', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(null), fc.string({ maxLength: 1000 })),
        fc.anything(),
        (value, fallback) => {
          expect(() => parseJsonSafe<unknown>(value, fallback)).not.toThrow();
        },
      ),
    );
  });
});
