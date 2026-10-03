import { describe, expect, it } from 'vitest';

import {
  COPILOT_SUGGESTION_KINDS,
  CopilotAnswerSchema,
  CopilotSuggestionSchema,
  DraftedFileSchema,
  PlainExplanationSchema,
} from './copilot.js';

/**
 * The copilot contract, and the two capabilities added last.
 *
 * ## The empty-evidence test is the point of this file
 *
 * Plan task 19: "an adversarial test that a suggestion with an empty `evidence`
 * array is rejected at the schema boundary before any UI exists". It is here, and it
 * is **red against a schema without `.min(1)`** — which is the whole reason the
 * constraint is a schema and not a rendering check. A UI check would be one
 * implementation and the TUI would be a second; a prompt saying "please cite
 * evidence" is advisory by construction; a schema is the one place every caller is
 * already obliged to pass through.
 */

const evidence = [{ kind: 'cell' as const, id: 'unit:backend', summary: 'presence 0' }];

const suggestion = (overrides: Record<string, unknown> = {}) =>
  CopilotSuggestionSchema.parse({
    kind: 'add-missing-suite',
    what: 'Add a unit suite.',
    why: 'unit:backend has presence 0.',
    target: 'unit:backend',
    impact: -1,
    evidence,
    overrides: { version: 1 },
    confidence: 1,
    ...overrides,
  });

describe('the hard rule: a suggestion that cannot cite a row does not render', () => {
  it('refuses a suggestion with an empty evidence array', () => {
    expect(CopilotSuggestionSchema.safeParse({ ...suggestion(), evidence: [] }).success).toBe(
      false,
    );
  });

  it('refuses a suggestion whose evidence key is missing entirely', () => {
    const without = { ...suggestion() } as Record<string, unknown>;
    delete without['evidence'];
    expect(CopilotSuggestionSchema.safeParse(without).success).toBe(false);
  });

  it('refuses a suggestion whose evidence carries no id a reader could open', () => {
    // An id is what a client turns into a link. An evidence entry with a summary
    // and no id is a sentence about a row nobody can reach.
    expect(
      CopilotSuggestionSchema.safeParse({
        ...suggestion(),
        evidence: [{ kind: 'cell', summary: 'something' }],
      }).success,
    ).toBe(false);
  });

  it('refuses the whole answer when any one suggestion cites nothing', () => {
    // The rule has to hold at the answer boundary too. A client that reads
    // `CopilotAnswerSchema` once gets the guarantee for every suggestion, rather
    // than one it has to remember to apply per item.
    expect(
      CopilotAnswerSchema.safeParse({
        projectId: 'p',
        derivedFrom: { at: '2026-10-02T00:00:00.000Z', total: 0, cappedBy: 'security' },
        suggestions: [{ ...suggestion(), evidence: [] }],
        notSuggested: [],
        coveredCategories: ['unit'],
      }).success,
    ).toBe(false);
  });
});

describe('a suggestion names the payload its kind allows, and no other', () => {
  it('attaches a draft only to a regression-suite suggestion', () => {
    // "The client must check which kind this is" is a convention every client has
    // to remember, and one of them will not. A diff button rendered next to advice
    // it is not attached to is worse than no button.
    const draft = [{ path: 'tests/regression.ts', content: 'x', covers: ['f1'] }];
    expect(
      CopilotSuggestionSchema.safeParse({ ...suggestion(), kind: 'draft-regression-suite', draft })
        .success,
    ).toBe(true);
    expect(CopilotSuggestionSchema.safeParse({ ...suggestion(), draft }).success).toBe(false);
  });

  it('attaches a plain explanation only to a stakeholder suggestion', () => {
    const plain = {
      readAloud: 'We score 0 out of 100.',
      plainTotal: 0,
      citedCells: ['unit:backend'],
    };
    expect(
      CopilotSuggestionSchema.safeParse({ ...suggestion(), kind: 'explain-for-stakeholder', plain })
        .success,
    ).toBe(true);
    expect(CopilotSuggestionSchema.safeParse({ ...suggestion(), plain }).success).toBe(false);
  });

  it('declares every kind it offers', () => {
    expect(COPILOT_SUGGESTION_KINDS).toContain('draft-regression-suite');
    expect(COPILOT_SUGGESTION_KINDS).toContain('explain-for-stakeholder');
  });
});

describe('a drafted regression suite is a document, not a command', () => {
  const file = {
    path: 'tests/regression/auth-1.test.ts',
    content: "test('regression', () => {});",
    covers: ['auth-1', 'auth-2'],
  };

  it('accepts a file that names what it covers', () => {
    expect(DraftedFileSchema.safeParse(file).success).toBe(true);
  });

  it('refuses a draft that covers nothing, because nothing can be reviewed', () => {
    expect(DraftedFileSchema.safeParse({ ...file, covers: [] }).success).toBe(false);
  });

  it('refuses an empty file', () => {
    expect(DraftedFileSchema.safeParse({ ...file, content: '' }).success).toBe(false);
  });

  it('refuses a path that is not a repo-relative path', () => {
    // An absolute or traversing path would be a file written outside the tree the
    // operator reviewed.
    for (const path of ['/etc/passwd', '../outside.test.ts', 'tests/../../etc/passwd']) {
      expect(DraftedFileSchema.safeParse({ ...file, path }).success, path).toBe(false);
    }
  });
});

describe('a plain explanation quotes the number rather than paraphrasing it', () => {
  const plain = {
    readAloud: 'We score 0 out of 100 because there is no security testing at all.',
    plainTotal: 0,
    citedCells: ['security:backend'],
  };

  it('accepts an explanation that cites the cells it used', () => {
    expect(PlainExplanationSchema.safeParse(plain).success).toBe(true);
  });

  it('refuses an explanation citing nothing, which is the same rule as evidence', () => {
    expect(PlainExplanationSchema.safeParse({ ...plain, citedCells: [] }).success).toBe(false);
  });

  it('bounds the plain total to the same range as the score', () => {
    // A `plainTotal` of 120 would be a friendlier number than the dashboard shows,
    // which is exactly the failure this field exists to prevent.
    expect(PlainExplanationSchema.safeParse({ ...plain, plainTotal: 120 }).success).toBe(false);
    expect(PlainExplanationSchema.safeParse({ ...plain, plainTotal: -1 }).success).toBe(false);
  });
});
