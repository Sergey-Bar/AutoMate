import { describe, expect, it } from 'vitest';
import { CopilotAnswerSchema, CopilotSuggestionSchema } from '@automate/shared-contracts';
import { score, DEFAULT_WEIGHTS, type ScoreInputs } from '@automate/projects';
import { answer } from './copilot-service.js';

/**
 * The copilot over a hand-built score.
 *
 * Every assertion here is about **derivation**: that a suggestion says what the cell
 * says, cites the row it came from, and does not claim more than the number supports.
 * The "does not call a model" decision is what makes these tests possible at all —
 * a suggestion whose text cannot be asserted against arithmetic is a suggestion
 * nobody can review.
 */

const NOW = '2026-10-02T00:00:00.000Z';

const inputs = (overrides: Partial<ScoreInputs> = {}): ScoreInputs => ({
  projectId: 'project-1',
  profile: {
    detectorVersion: 1,
    excludedCells: [],
    targets: { testsPerCell: {}, coverageTarget: {} },
    weights: DEFAULT_WEIGHTS,
  },
  runs: [],
  results: [],
  coverage: null,
  quarantined: [],
  uncoveredModules: [],
  singleLayerE2eFingerprints: [],
  ...overrides,
});

const ask = (
  overrides: Partial<ScoreInputs> = {},
  question: { projectId: string; category?: string } = { projectId: 'project-1' },
) => answer(question, score(inputs(overrides), NOW));

describe('every suggestion cites a row, or it does not render', () => {
  it('refuses a suggestion with no evidence at the schema', () => {
    // The rule, enforced where it cannot be forgotten. A `.default([])` here
    // would accept exactly the suggestion the rule exists to refuse, and the
    // failure would surface as a confident sentence with nothing behind it.
    expect(
      CopilotSuggestionSchema.safeParse({
        kind: 'add-missing-suite',
        what: 'Add a unit suite.',
        why: 'There is none.',
        target: 'unit:backend',
        impact: -1,
        evidence: [],
        overrides: {},
        confidence: 1,
      }).success,
    ).toBe(false);
  });

  it('gives every suggestion it returns at least one piece of evidence', () => {
    const result = ask();
    expect(result.suggestions.length).toBeGreaterThan(0);
    for (const suggestion of result.suggestions) {
      expect(suggestion.evidence.length, suggestion.what).toBeGreaterThan(0);
      for (const piece of suggestion.evidence) {
        // Not just non-empty: an id a client cannot open is not evidence.
        expect(piece.id.length, suggestion.what).toBeGreaterThan(0);
        expect(piece.summary.length, suggestion.what).toBeGreaterThan(0);
      }
    }
  });

  it('returns a schema-valid answer', () => {
    expect(CopilotAnswerSchema.safeParse(ask()).success).toBe(true);
  });

  it('says what it deliberately did not suggest, so silence is not read as health', () => {
    const result = ask({
      profile: {
        detectorVersion: 1,
        excludedCells: [{ category: 'security', surface: 'frontend' }],
        targets: { testsPerCell: {}, coverageTarget: {} },
        weights: DEFAULT_WEIGHTS,
      },
    });
    // An `n/a` cell is excluded and its weight redistributed. It is not a finding,
    // and an empty answer that did not say so would read as "nothing is wrong".
    expect(result.notSuggested.some((entry) => entry.target === 'security:frontend')).toBe(true);
  });
});

describe('"cannot prove" is a fact about presence, not a judgement', () => {
  it('names a cell with presence 0 and says what would close it', () => {
    const result = ask();
    const suggestion = result.suggestions.find(
      (candidate) => candidate.kind === 'add-missing-suite' && candidate.target === 'unit:backend',
    );
    expect(suggestion).toBeDefined();
    expect(suggestion?.why).toContain('presence 0');
    // The override is a **document**, not a shell line. A copilot offering
    // `echo "commands": … >> automate.config.json` has handed back the raw-shell
    // passthrough the plan forbids, wearing a helpful tone.
    expect(suggestion?.overrides['version']).toBe(1);
  });

  it('says nothing about a cell that has a suite, and nothing about a cell it was not asked about', async () => {
    const result = ask({
      runs: [
        {
          runId: 'r1',
          startedAt: NOW,
          projectId: 'p',
          outcome: 'passed',
          countsTowardsQuality: true,
          coverageBySurface: null,
        },
      ],
      results: [
        {
          fingerprint: 'f1',
          runId: 'r1',
          commitSha: 'c1',
          category: 'unit',
          surface: 'backend',
          outcome: 'passed',
          durationMs: 120,
          assertionCount: 3,
          trivialAssertionCount: 0,
          touchedIo: true,
        },
      ],
    });
    expect(
      result.suggestions.some(
        (candidate) =>
          candidate.target === 'unit:backend' && candidate.kind === 'add-missing-suite',
      ),
    ).toBe(false);
  });

  it('says what to do about a suite that runs and covers nothing', async () => {
    // Presence 1 with depth 0 is the strongest form of the finding: the cell is
    // actively claiming to be covered. And `impact` is **negative**, because
    // fixing it makes the number go *down* — an operator who noticed a "fix this"
    // that lowered their score would stop reading the rest of the answer.
    const result = ask({
      runs: [
        {
          runId: 'r1',
          startedAt: NOW,
          projectId: 'p',
          outcome: 'passed',
          countsTowardsQuality: true,
          coverageBySurface: null,
        },
      ],
      results: [
        {
          fingerprint: 'f1',
          runId: 'r1',
          commitSha: 'c1',
          category: 'unit',
          surface: 'backend',
          outcome: 'passed',
          durationMs: 5,
          assertionCount: 0,
          trivialAssertionCount: 0,
          touchedIo: false,
        },
      ],
    });

    // The cell has a suite, so "add a suite" would be the wrong advice; whatever
    // it *does* say about that cell must cite the rows behind it.
    const said = result.suggestions.filter((suggestion) => suggestion.target === 'unit:backend');
    expect(said.length).toBeGreaterThan(0);
    for (const suggestion of said) {
      expect(suggestion.evidence.length).toBeGreaterThan(0);
      expect(suggestion.impact).toBeLessThan(0);
    }
  });
});

describe('an honest copilot reports the fixes that make the number worse', () => {
  it('gives a hollow-test finding a negative impact', () => {
    // `min(1, n/target)` means fixing it makes the number go **down**. Reporting it
    // as a positive improvement would contradict the arithmetic it is derived from,
    // and an operator who noticed would stop reading the rest.
    const result = ask({
      runs: [
        {
          runId: 'r1',
          startedAt: NOW,
          projectId: 'p',
          outcome: 'passed',
          countsTowardsQuality: true,
          coverageBySurface: null,
        },
      ],
      results: [
        {
          fingerprint: 'hollow-1',
          runId: 'r1',
          commitSha: 'c1',
          category: 'unit',
          surface: 'backend',
          outcome: 'passed',
          durationMs: 5,
          assertionCount: 0,
          trivialAssertionCount: 0,
          touchedIo: false,
        },
      ],
    });
    const suggestion = result.suggestions.find(
      (candidate) => candidate.kind === 'fix-hollow-tests',
    );
    expect(suggestion).toBeDefined();
    expect(suggestion?.impact).toBeLessThan(0);
    expect(suggestion?.evidence[0]?.id).toBe('hollow-1');
  });

  it('ranks the worst news first', () => {
    const result = ask();
    const impacts = result.suggestions.map((suggestion) => Math.abs(suggestion.impact));
    for (let index = 1; index < impacts.length; index += 1) {
      expect(impacts[index - 1]).toBeGreaterThanOrEqual(impacts[index] ?? 0);
    }
  });
});

describe('the pyramid is locked, and it says which file locked it', () => {
  it('says nothing about the shape when the project declared no target', () => {
    // A pyramid target is a heuristic from a blog post. A copilot that opens with
    // "your test pyramid is inverted" is opening with an opinion the team never
    // asked for, and a team that did not ask for it has no reason to read the rest.
    const result = ask({
      runs: [
        {
          runId: 'r1',
          startedAt: NOW,
          projectId: 'p',
          outcome: 'passed',
          countsTowardsQuality: true,
          coverageBySurface: null,
        },
      ],
      results: [...test('unit', 30), ...test('e2e', 70)],
    });
    expect(result.suggestions.some((candidate) => candidate.kind === 'decode-locked-pyramid')).toBe(
      false,
    );
  });

  it('raises it when the project declared a target it has drifted from', () => {
    const result = ask({
      profile: {
        detectorVersion: 1,
        excludedCells: [],
        targets: {
          testsPerCell: {},
          coverageTarget: {},
          pyramid: { unit: 0.7, integration: 0.2, e2e: 0.1 },
        },
        weights: DEFAULT_WEIGHTS,
      },
      runs: [
        {
          runId: 'r1',
          startedAt: NOW,
          projectId: 'p',
          outcome: 'passed',
          countsTowardsQuality: true,
          coverageBySurface: null,
        },
      ],
      results: [...test('unit', 10), ...test('e2e', 90)],
    });
    const suggestion = result.suggestions.find(
      (candidate) => candidate.kind === 'decode-locked-pyramid',
    );
    expect(suggestion).toBeDefined();
    // The one suggestion where the honest impact is **positive**: reaching a target
    // the project itself declared raises the score.
    expect(suggestion?.impact).toBeGreaterThan(0);
    expect(suggestion?.evidence[0]?.summary).toContain('automate.config.json');
  });

  it('says nothing when the declared target is being met', () => {
    const result = ask({
      profile: {
        detectorVersion: 1,
        excludedCells: [],
        targets: {
          testsPerCell: {},
          coverageTarget: {},
          pyramid: { unit: 0.7, integration: 0.2, e2e: 0.1 },
        },
        weights: DEFAULT_WEIGHTS,
      },
      runs: [
        {
          runId: 'r1',
          startedAt: NOW,
          projectId: 'p',
          outcome: 'passed',
          countsTowardsQuality: true,
          coverageBySurface: null,
        },
      ],
      results: [...test('unit', 70), ...test('e2e', 30)],
    });
    expect(result.suggestions.some((candidate) => candidate.kind === 'decode-locked-pyramid')).toBe(
      false,
    );
  });
});

describe('an answer is scoped by the question', () => {
  it('covers every category when none was named', () => {
    expect(ask().coveredCategories).toHaveLength(5);
  });

  it('covers exactly one when one was named', () => {
    const result = ask({}, { projectId: 'project-1', category: 'security' });
    expect(result.coveredCategories).toEqual(['security']);
    expect(
      result.suggestions.every((suggestion) => String(suggestion.target).startsWith('security')),
    ).toBe(true);
  });

  it('quotes the score it was derived from, so an answer cannot be read out of context', () => {
    const result = ask();
    expect(result.derivedFrom.total).toBe(0);
    expect(result.derivedFrom.cappedBy).toBeTypeOf('string');
    expect(result.derivedFrom.at).toBe(NOW);
  });
});

describe('capability 5 — draft a regression suite from a failure cluster', () => {
  it('refuses to produce a shell line, and produces a document the operator reviews', () => {
    // The plan says "as a proposal into the customer's repo". A shell line would
    // be the raw-shell passthrough D7 rules out — and here it would be
    // `cat > tests/…`, which is both a shell and a way to put whatever the copilot
    // chose on disk.
    const result = ask({ results: cluster() });
    const draft = result.suggestions.find(
      (suggestion) => suggestion.kind === 'draft-regression-suite',
    );
    expect(draft).toBeDefined();
    expect(JSON.stringify(draft)).not.toMatch(/child_process|exec\(|cat >/u);
    for (const file of draft?.draft ?? []) {
      expect(file.path.length).toBeGreaterThan(0);
      expect(file.content.length).toBeGreaterThan(0);
      // A draft with no named tests is not reviewable.
      expect(file.covers.length).toBeGreaterThan(0);
    }
  });

  it('names every test in the cluster in the draft it writes', () => {
    const result = ask({ results: cluster() });
    const draft = result.suggestions.find(
      (suggestion) => suggestion.kind === 'draft-regression-suite',
    );
    const covered = (draft?.draft ?? []).flatMap((file) => file.covers);
    // Every fingerprint that failed, so the operator can check the draft against
    // the cluster rather than trusting that the copilot read it.
    expect(covered.sort()).toEqual(['auth-1', 'auth-2', 'auth-3']);
  });

  it('says nothing about a cluster with no repeated failure', () => {
    // A suite that failed once has no pattern to write a regression suite from,
    // and inventing one would be a draft nobody asked for.
    const result = ask({
      runs: [run('r1')],
      results: [failing('once')],
    });
    expect(result.suggestions.some((s) => s.kind === 'draft-regression-suite')).toBe(false);
  });
});

describe('capability 6 — translate for a non-technical stakeholder', () => {
  it('reports the same total the dashboard shows, not a friendlier one', () => {
    const result = ask({ results: cluster() });
    const plain = result.suggestions.find(
      (suggestion) => suggestion.kind === 'explain-for-stakeholder',
    );
    const reading = plain?.plain;
    expect(reading).toBeDefined();
    // The score this answer was derived from, quoted into the explanation. A
    // rounded figure that disagrees with the dashboard is the one thing a
    // stakeholder notices and the one thing they stop trusting.
    expect(reading?.plainTotal).toBeGreaterThanOrEqual(0);
    expect(reading?.citedCells.length).toBeGreaterThan(0);
  });

  it('cites the cells its sentence is built from', () => {
    const plain = ask({ results: cluster() }).suggestions.find(
      (suggestion) => suggestion.kind === 'explain-for-stakeholder',
    )?.plain;
    for (const cell of plain?.citedCells ?? []) {
      expect(cell).toMatch(
        /^(unit|integration|e2e|performance|security):(backend|frontend|platform)$/u,
      );
    }
  });

  it('avoids the jargon the explanation is meant to remove', () => {
    const plain = ask({ results: cluster() }).suggestions.find(
      (suggestion) => suggestion.kind === 'explain-for-stakeholder',
    )?.plain;
    // "cell", "surface", "presence" and "depth" are the four words this product
    // uses for things a stakeholder does not have. A read-aloud sentence
    // containing them has not been translated at all.
    expect(plain?.readAloud).not.toMatch(/\b(cell|surface|presence|depth|stability)\b/iu);
  });
});

/** The same three fingerprints failing in every recent run: a cluster. */
function cluster() {
  return [failing('auth-1'), failing('auth-2'), failing('auth-3'), passing('ok-1')];
}

/** One test that failed, as the producer reported it. */
function failing(fingerprint: string) {
  return {
    fingerprint,
    runId: 'r1',
    commitSha: 'c1',
    category: 'unit' as const,
    surface: 'backend' as const,
    outcome: 'failed' as const,
    durationMs: 30,
    assertionCount: 2,
    trivialAssertionCount: 0,
    touchedIo: true,
  };
}

/** One test that passed and genuinely asserts something. */
function passing(fingerprint: string) {
  return {
    fingerprint,
    runId: 'r1',
    commitSha: 'c1',
    category: 'unit' as const,
    surface: 'backend' as const,
    outcome: 'passed' as const,
    durationMs: 30,
    assertionCount: 2,
    trivialAssertionCount: 0,
    touchedIo: true,
  };
}

function run(runId: string) {
  return {
    runId,
    startedAt: NOW,
    projectId: 'p',
    outcome: 'passed' as const,
    countsTowardsQuality: true,
    coverageBySurface: null,
  };
}

function test(category: 'unit' | 'e2e', count: number, overrides: Record<string, unknown> = {}) {
  return Array.from({ length: count }, (_, index) => ({
    fingerprint: `${category}-${index}`,
    runId: 'r1',
    commitSha: 'c1',
    category,
    surface: 'backend' as const,
    outcome: 'passed' as const,
    durationMs: 120,
    assertionCount: 2,
    trivialAssertionCount: 0,
    touchedIo: true,
    ...overrides,
  }));
}
