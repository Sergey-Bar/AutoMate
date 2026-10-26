import { describe, expect, it } from 'vitest';
import {
  MAX_SOURCE_SNIPPET,
  TestProposalBodySchema,
  TestProposalListSchema,
  TestProposalSchema,
} from './test-proposals.js';

const FINDING = '00000000-0000-4000-8000-000000000001';

describe('the test proposal body', () => {
  it('accepts a surviving mutant and uncovered lines, each with its own evidence', () => {
    expect(TestProposalBodySchema.parse({ kind: 'surviving-mutant', findingId: FINDING })).toEqual({
      kind: 'surviving-mutant',
      findingId: FINDING,
    });
    expect(
      TestProposalBodySchema.parse({
        kind: 'uncovered-lines',
        commit: 'ABC1234',
        path: ' src/a.ts ',
        testFramework: ' vitest ',
      }),
    ).toEqual({
      kind: 'uncovered-lines',
      commit: 'ABC1234',
      path: 'src/a.ts',
      testFramework: 'vitest',
    });
  });

  it('refuses evidence of the wrong kind, a short commit and an unbounded snippet', () => {
    expect(
      TestProposalBodySchema.safeParse({ kind: 'surviving-mutant', commit: 'abc1234' }).success,
    ).toBe(false);
    expect(
      TestProposalBodySchema.safeParse({ kind: 'uncovered-lines', commit: 'abc', path: 'a' })
        .success,
    ).toBe(false);
    expect(
      TestProposalBodySchema.safeParse({
        kind: 'surviving-mutant',
        findingId: FINDING,
        sourceSnippet: 'x'.repeat(MAX_SOURCE_SNIPPET + 1),
      }).success,
    ).toBe(false);
    expect(
      TestProposalBodySchema.safeParse({
        kind: 'surviving-mutant',
        findingId: FINDING,
        testFramework: 'vitest; rm -rf /',
      }).success,
    ).toBe(false);
  });

  it('reads back a stored proposal and a list of them', () => {
    const proposal = {
      id: 'p1',
      projectId: 'p',
      kind: 'surviving-mutant',
      findingId: FINDING,
      commit: null,
      path: 'src/math.ts',
      testFramework: 'vitest',
      suggestedPath: 'src/math.proposed.test.ts',
      patch: 'diff --git a/x b/x',
      rationale: '',
      model: 'm',
      provider: 'ollama',
      tokens: { input: null, output: 3 },
      createdBy: 'a',
      createdAt: '2026-10-26T12:00:00.000Z',
    };
    expect(TestProposalSchema.parse(proposal)).toEqual(proposal);
    expect(TestProposalListSchema.parse({ proposals: [proposal] }).proposals).toHaveLength(1);
  });
});
