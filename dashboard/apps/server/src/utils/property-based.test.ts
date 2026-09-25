/**
 * Property-based tests for Dashboard server utility functions.
 *
 * Verifies structural invariants of pure transformation functions:
 *  - escapeXml: output never contains raw `<` characters from input
 *  - escapeMarkdown: output never contains raw newlines; no-op on safe strings
 *  - sanitizeError: non-sensitive keys pass through unchanged
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { escapeXml } from './xml-util.js';
import { escapeMarkdown, escapeSlackMrkdwn } from './sanitize-text.js';
import { sanitizeError } from './sanitize-error.js';

// ─── escapeXml ────────────────────────────────────────────────────────────────

// Deterministic seed; 200 examples per property keeps the suite fast.
fc.configureGlobal({ seed: 42, numRuns: 200 });

// ─── escapeXml ────────────────────────────────────────────────────────────────

/**
 * A string that contains none of the five XML special characters.
 * For such strings, escapeXml must be a no-op.
 */
const safeXmlString = fc
  .string({ minLength: 0, maxLength: 200 })
  .filter((s) => !/[&<>"']/.test(s));

describe('escapeXml property', () => {
  it('is a no-op on strings with no XML special characters', () => {
    fc.assert(
      fc.property(safeXmlString, (s) => {
        expect(escapeXml(s)).toBe(s);
      }),
    );
  });

  it('output never contains a raw less-than sign', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (s) => {
        const escaped = escapeXml(s);
        // Every `<` in the input gets replaced with `&lt;`
        const rawLt = escaped.indexOf('<');
        expect(rawLt).toBe(-1);
      }),
    );
  });
});

// ─── escapeMarkdown ───────────────────────────────────────────────────────────

/**
 * A string with no Markdown control characters.
 * escapeMarkdown must be a no-op for such strings.
 */
const safeMdString = fc
  .string({ minLength: 0, maxLength: 200 })
  .filter((s) => !/[|\n`*_[\]]/.test(s));

describe('escapeMarkdown property', () => {
  it('is a no-op on strings with no Markdown control characters', () => {
    fc.assert(
      fc.property(safeMdString, (s) => {
        expect(escapeMarkdown(s)).toBe(s);
      }),
    );
  });

  it('output never contains a raw newline character', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (s) => {
        const escaped = escapeMarkdown(s);
        expect(escaped).not.toContain('\n');
      }),
    );
  });
});

// ─── escapeSlackMrkdwn ────────────────────────────────────────────────────────

const safeSlackString = fc
  .string({ minLength: 0, maxLength: 200 })
  .filter((s) => !/[&<>*_~`]/.test(s));

describe('escapeSlackMrkdwn property', () => {
  it('is a no-op on strings with no Slack control characters', () => {
    fc.assert(
      fc.property(safeSlackString, (s) => {
        expect(escapeSlackMrkdwn(s)).toBe(s);
      }),
    );
  });
});

// ─── sanitizeError ────────────────────────────────────────────────────────────

/** Keys that do NOT match the sensitive-key regex. */
const safeKeyArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter(
    (k) =>
      !/^(apikey|api_key|token|password|secret|authorization|cookie|credential)$/i.test(k),
  );

describe('sanitizeError property', () => {
  it('passes through all non-sensitive string values unchanged', () => {
    fc.assert(
      fc.property(fc.dictionary(safeKeyArb, fc.string()), (obj) => {
        const result = sanitizeError(obj) as Record<string, unknown>;
        for (const [key, value] of Object.entries(obj)) {
          expect(result[key]).toBe(value);
        }
      }),
    );
  });
});
