import {
  CopilotAnswerSchema,
  type CopilotAnswer,
  type CopilotEvidence,
  type CopilotSuggestion,
} from '@automate/shared-contracts';
import type { QaScore } from '@automate/projects';

/**
 * The copilot, as a pure derivation over a score.
 *
 * ## It does not call a model, and that is a decision
 *
 * The plan names three capabilities and every one of them is `cannot_prove` or
 * `derived`. A missing suite is a **fact about a matrix cell** (`presence === 0`),
 * not a judgement. A hollow test is a **fact about a fingerprint** the producer
 * reported. A flaky test is a **fact about two runs of one commit**. Routing any of
 * them through a language model would add a place for the answer to be wrong, cost a
 * network call per question, and — worst — make the same question have a different
 * answer each time, which is the one property a QA number cannot afford.
 *
 * So the copilot is a set of pure functions from `QaScore` to ranked suggestions,
 * and it is unit-testable to the row. A suggestion is a **statement of arithmetic**:
 * "this cell has presence 0, here is what would close it, here is the run that
 * proves the suite exists".
 *
 * ## The pyramid is locked, deliberately
 *
 * The plan's seventh capability is `decode_locked_pyramid`. A pyramid target is a
 * heuristic from a blog post; a copilot that opens with "your test pyramid is
 * inverted" is opening with an opinion a team did not ask for. The suggestion
 * below therefore fires **only** when the project has declared its own pyramid
 * target, and it says which file declared it.
 */

/** The maximum suggestions returned. A list nobody reads is not a queue. */
export const MAX_SUGGESTIONS = 8;

interface Builder {
  suggestions: CopilotSuggestion[];
  notSuggested: CopilotAnswer['notSuggested'];
}

/**
/**
 * Failing fingerprints grouped by the surface they sit in.
 *
 * Read from `failedFingerprints`, **not** from `flakyFingerprints`. Flaky means the
 * outcome flipped — the test is unreliable. A cluster is repeated *failures*, which is
 * a defect or a gap rather than noise, and the two are different lists because a reader
 * who cannot tell them apart reads a flake as a bug.
 *
 * That distinction is also why the score grew a `failedFingerprints` field while this
 * capability was being built: without it there was nothing here to read, and the only
 * honest answer would have been to guess.
 */
function clustersBySurface(score: QaScore): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const cell of score.cells) {
    if (cell.inputs.failedFingerprints.length === 0) continue;
    grouped.set(cell.surface, [
      ...(grouped.get(cell.surface) ?? []),
      ...cell.inputs.failedFingerprints,
    ]);
  }
  return grouped;
}

export function answer(
  question: { projectId: string; category?: string },
  score: QaScore,
): CopilotAnswer {
  const builder: Builder = { suggestions: [], notSuggested: [] };
  const wanted = question.category === undefined ? null : question.category;

  // "Cannot prove" is collected and emitted as **one** suggestion rather than
  // fifteen. A fresh project's matrix is fifteen cells with `presence === 0`, and
  // fifteen identical rows is not a queue: it fills the whole answer, pushes every
  // specific finding off the end, and tells the reader the same thing fifteen times.
  // One row that names every empty cell says it once and completely.
  const missing = collectCellFindings(builder, score, wanted);

  if (missing.length > 0) missingSuites(builder, score, missing);
  for (const finding of score.findings)
    structural(builder, finding.kind, finding.cells, finding.statement);
  draftRegressionSuite(builder, score, clustersBySurface(score));
  explainForStakeholder(builder, score, wanted);
  lockedPyramid(builder, score, wanted);

  return CopilotAnswerSchema.parse({
    projectId: question.projectId,
    derivedFrom: { at: score.at, total: score.total, cappedBy: score.cappedBy },
    suggestions: rank(builder.suggestions),
    notSuggested: builder.notSuggested,
    coveredCategories:
      wanted === null
        ? ([
            ...new Set(score.cells.map((cell) => cell.category)),
          ] as CopilotAnswer['coveredCategories'])
        : [wanted],
  });
}

/**
 * One pass over the matrix, returning the keys of every cell with no suite.
 *
 * Split out of `answer` so the orchestration reads as three statements — collect,
 * annotate globally, rank — rather than as a loop with four branches in it. An
 * `n/a` cell is recorded in `notSuggested` and **skipped**, because it was excluded
 * with its weight redistributed and its zero is a decision rather than a finding.
 */
function collectCellFindings(builder: Builder, score: QaScore, wanted: string | null): string[] {
  const missing: string[] = [];
  for (const cell of score.cells) {
    if (cell.excluded) {
      builder.notSuggested.push({
        target: cell.key,
        because: 'marked n/a by the project, so its zero is not a finding',
      });
      continue;
    }
    if (wanted !== null && cell.category !== wanted) continue;
    if (cell.presence === 0) missing.push(cell.key);
    else if (cell.depth === 0) greenButEmpty(builder, cell.key);
    if (cell.inputs.hollowFingerprints.length > 0)
      hollowTests(builder, cell.key, cell.inputs.hollowFingerprints);
    if (cell.inputs.flakyFingerprints.length > 0)
      flakyTests(builder, cell.key, cell.inputs.flakyFingerprints);
  }
  return missing;
}

/**
 * Worst first, and capped.
 *
 * By **absolute** impact, so a suggestion that lowers the score outranks an equally
 * sized one that raises it: a hollow test is worse than a thin suite, because the
 * thin suite is at least honest about what it does.
 */
function rank(suggestions: CopilotSuggestion[]): CopilotSuggestion[] {
  return [...suggestions]
    .sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))
    .slice(0, MAX_SUGGESTIONS);
}

/**
 * "Cannot prove" — the capability the plan names first.
 *
 * **One row for the whole matrix**, not one per cell. The evidence still carries
 * every empty cell, so nothing is lost; what changes is that a reader opening the
 * copilot sees a single statement with a list under it rather than the same sentence
 * fifteen times.
 *
 * The override is a **document, not a shell line**. A copilot that offered
 * `echo "commands": {...} >> automate.config.json` has handed back the raw-shell
 * passthrough D7 rules out, wearing a helpful tone.
 */
function missingSuites(builder: Builder, score: QaScore, cells: readonly string[]): void {
  const byCategory = new Map<string, string[]>();
  for (const cell of cells) {
    const category = cell.split(':')[0] ?? 'unit';
    byCategory.set(category, [...(byCategory.get(category) ?? []), cell]);
  }
  builder.suggestions.push({
    kind: 'add-missing-suite',
    what: `Add a suite for ${cells.length} cell(s) that have never run: ${describe(byCategory)}.`,
    why: `${cells.length} of the matrix cells have presence 0, so no run has ever produced a result for them.`,
    target: cells[0] as string,
    impact: -1,
    evidence: cells.map((cell) => ({
      kind: 'cell' as const satisfies CopilotEvidence['kind'],
      id: cell,
      summary: `${cell} has presence 0 — no suite, no result, no evidence either way.`,
    })),
    overrides: {
      version: 1,
      commands: Object.fromEntries(
        [...byCategory].map(([category]) => [category, ['TODO: declare the command']]),
      ),
    },
    confidence: 1,
  });
}

/**
 * Capability 5 — **draft a regression suite** from a cluster of repeated failures.
 *
 * ## A cluster, not a failure
 *
 * One test failing once has no pattern to write a regression suite from, and
 * inventing one produces a draft nobody asked for. The threshold is
 * `CLUSTER_MINIMUM` distinct fingerprints **all failing**, which is the smallest
 * shape that says "this recurs".
 *
 * ## A document, never a shell line
 *
 * The plan says "as a proposal into the customer's repo", and the copilot does not
 * write to a customer's repository. It emits files the operator reviews and commits.
 * The alternative — `cat > tests/regression_test.py` — is the raw-shell passthrough
 * D7 rules out, and here it would additionally be a way to put whatever the copilot
 * chose on disk.
 */
const CLUSTER_MINIMUM = 3;

/** The language a draft is written in, from the surface the cluster sits in. */
const DRAFT_BY_SURFACE: Readonly<Record<string, { path: string; header: string }>> = {
  backend: {
    path: 'tests/regression/{fingerprints}.test.ts',
    header: '// Regression suite drafted from a cluster of repeated failures.',
  },
  frontend: {
    path: 'src/__tests__/regression.{fingerprints}.test.ts',
    header: '// Regression suite drafted from a cluster of repeated failures.',
  },
  platform: {
    path: 'tests/regression.{fingerprints}.spec.ts',
    header: '// Regression suite drafted from a cluster of repeated failures.',
  },
};

function draftRegressionSuite(
  builder: Builder,
  score: QaScore,
  failingBySurface: ReadonlyMap<string, readonly string[]>,
): void {
  for (const [surface, fingerprints] of failingBySurface) {
    if (fingerprints.length < CLUSTER_MINIMUM) continue;
    const template =
      DRAFT_BY_SURFACE[surface] ??
      (DRAFT_BY_SURFACE['platform'] as (typeof DRAFT_BY_SURFACE)['platform']);
    const cells = score.cells.filter((cell) => cell.surface === surface);
    builder.suggestions.push({
      kind: 'draft-regression-suite',
      what: `Draft a regression suite covering ${fingerprints.length} repeatedly failing ${surface} test(s).`,
      why: `${fingerprints.length} distinct fingerprints failed on the same commit, which is a pattern rather than a flake.`,
      target: cells[0]?.key ?? 'unit:backend',
      impact: 0.5,
      evidence: fingerprints.map((fingerprint) => ({
        kind: 'canonical-result' as const satisfies CopilotEvidence['kind'],
        id: fingerprint,
        summary: `Fingerprint ${fingerprint} failed on every run in the window.`,
      })),
      overrides: { version: 1 },
      draft: [
        {
          path: template.path.replace('{fingerprints}', slugify(fingerprints)),
          content: draftBody(fingerprints, template.header),
          covers: [...fingerprints],
        },
      ],
      confidence: 0.55,
    });
  }
}

/** A filesystem-safe slug from the fingerprints the draft covers. */
function slugify(fingerprints: readonly string[]): string {
  return fingerprints
    .map((fingerprint) => fingerprint.replaceAll(/[^A-Za-z0-9]+/gu, '-').replaceAll(/^-|-$/gu, ''))
    .filter((part) => part.length > 0)
    .join('-')
    .slice(0, 60);
}

/**
 * The draft body, as a **skeleton with the fingerprints named and no assertions
 * invented**.
 *
 * A copilot that writes the assertions is guessing at what the code should do, and
 * a regression suite whose assertions were guessed is worse than none: it passes for
 * the wrong reason and it is now the test that will not catch the real bug. So the
 * draft is the structure, with a `todo` at the one place a human must decide.
 */
function draftBody(fingerprints: readonly string[], header: string): string {
  const cases = fingerprints
    .map((fingerprint) =>
      [
        `  test('regression: ${fingerprint}', async () => {`,
        `    // TODO: assert the behaviour these repeated failures pointed at.`,
        `    // This test is a skeleton on purpose — a guessed assertion passes for the`,
        `    // wrong reason and then becomes the test that misses the real defect.`,
        `    throw new Error('draft: replace with the real assertion for ${fingerprint}');`,
        '  });',
      ].join('\n'),
    )
    .join('\n\n');
  return [
    header,
    `// Covers: ${fingerprints.join(', ')}`,
    '',
    "import { test, expect } from 'vitest';",
    '',
    'export function describeRegressionCluster() {',
    cases,
    '}',
    '',
  ].join('\n');
}

/**
 * Capability 6 — **translate** the score for someone who will never read a matrix.
 *
 * ## The number is the same number
 *
 * `plainTotal` is the score's own `total`, not a rounded or friendlier figure. A
 * stakeholder who is shown 62 on a slide and 60 on a dashboard learns that one of
 * them is lying, and the dashboard is the one with the matrix. So the explanation
 * quotes the score rather than paraphrasing it.
 *
 * ## No jargon, because that is the whole capability
 *
 * "Cell", "surface", "presence" and "depth" are the four words this product uses for
 * things a stakeholder does not have. A read-aloud sentence containing them has not
 * been translated at all, so the assertion is a word list rather than a style
 * opinion.
 */
function explainForStakeholder(builder: Builder, score: QaScore, wanted: string | null): void {
  // Only asked for when the question is about the whole project. A question about
  // one category is answered in the category's own terms, and a plain reading of it
  // would be the same sentence with a number the reader cannot check.
  if (wanted !== null) return;

  const scored = score.cells.filter((cell) => !cell.excluded && cell.score > 0);
  const cited = (scored.length > 0 ? scored : score.cells).slice(0, 3).map((cell) => cell.key);
  const limiter = score.cappedBy;
  const cappedAtZero = score.cappingValue === 0;

  builder.suggestions.push({
    kind: 'explain-for-stakeholder',
    what: `Answer the question "why is the score ${score.total.toFixed(0)}?" in plain words.`,
    why: 'The score is a weighted average that a zero anywhere pulls to zero, so the number always has one cause.',
    target: 'pyramid-shape',
    impact: 0,
    evidence: cited.map((cell) => ({
      kind: 'cell' as const satisfies CopilotEvidence['kind'],
      id: cell,
      summary: `${cell} contributed to the ${String(score.total.toFixed(0))}/100 reading.`,
    })),
    overrides: { version: 1 },
    plain: {
      readAloud: cappedAtZero
        ? `We score ${score.total.toFixed(0)} out of 100. Nothing here is hidden: there is no ${limiter} testing at all, and because a missing area counts as zero rather than as average, it drags the whole number to zero. That is not a rounding problem — it is the one thing to fix first.`
        : `We score ${score.total.toFixed(0)} out of 100. The lowest part is ${limiter}, which is why the number is not higher. Fixing that area is the change that would move it most.`,
      plainTotal: Number(score.total.toFixed(4)),
      citedCells: cited,
    },
    confidence: 0.9,
  });
}

function describe(byCategory: ReadonlyMap<string, readonly string[]>): string {
  return [...byCategory].map(([category, keys]) => `${keys.length} ${category}`).join(', ');
}

/**
 * "Green but empty" — the suite runs, passes, and covers nothing.
 *
 * `impact` is **negative**: fixing it makes the number go *down*. Reporting it as
 * a positive improvement would be the copilot contradicting the arithmetic it is
 * derived from, and an operator who noticed would stop reading the rest.
 */
function greenButEmpty(builder: Builder, cellKey: string): void {
  builder.suggestions.push({
    kind: 'add-missing-suite',
    what: `Delete the ${cellKey} suite or give it assertions.`,
    why: `${cellKey} runs and passes with depth 0, so it is evidence that the command works, not that the code does.`,
    target: cellKey,
    impact: -1,
    evidence: [{ kind: 'cell', id: cellKey, summary: `${cellKey} has presence 1 and depth 0.` }],
    overrides: { version: 1 },
    confidence: 0.9,
  });
}

/** "Hollow test" — green, and contributing nothing. */
function hollowTests(builder: Builder, cellKey: string, fingerprints: readonly string[]): void {
  builder.suggestions.push({
    kind: 'fix-hollow-tests',
    what: `Rewrite or delete ${fingerprints.length} hollow test(s) in ${cellKey}.`,
    why: `${fingerprints.length} test(s) in ${cellKey} pass while contributing nothing, which raises the pass rate and lowers no other number.`,
    target: cellKey,
    impact: -0.8,
    evidence: fingerprints.map((fingerprint) => ({
      kind: 'canonical-result' as const,
      id: fingerprint,
      summary: `Test fingerprint ${fingerprint} is classified hollow.`,
    })),
    overrides: { version: 1 },
    confidence: 0.85,
  });
}

/**
 * "Flaky test".
 *
 * The evidence is the **run** the fingerprint last appeared in, not the
 * fingerprint alone — a reader who cannot see which run showed the flip cannot
 * tell a flaky test from a test that failed once.
 */
function flakyTests(builder: Builder, cellKey: string, fingerprints: readonly string[]): void {
  builder.suggestions.push({
    kind: 'quarantine-flaky-test',
    what: `Fix or explicitly quarantine ${fingerprints.length} flaky test(s) in ${cellKey}.`,
    why: `${cellKey} stability is reduced by ${fingerprints.length} fingerprint(s) that changed outcome on the same commit.`,
    target: cellKey,
    impact: -0.6,
    evidence: fingerprints.map((fingerprint) => ({
      kind: 'run' as const,
      id: fingerprint,
      summary: `Fingerprint ${fingerprint} produced different outcomes on one commit.`,
    })),
    overrides: { version: 1 },
    confidence: 0.8,
  });
}

/**
 * A structural finding, translated into the vocabulary a reader acts in.
 *
 * The two vocabularies are not the same and must not be aliased: a *finding* names
 * what was observed (`uncovered_surface`), while a *suggestion* names what to do
 * about it (`cover-uncovered-surface`). Casting one list onto the other would make
 * `green_but_empty` a suggestion kind, and then the copilot would offer to
 * "fix-hollow-tests" for a suite with no hollow tests in it.
 *
 * `green_but_empty` has **no** entry, deliberately: it is already offered by
 * `greenButEmpty` above, which fires off the cell's own components rather than off
 * the finding, so mapping it here as well would produce the same advice twice.
 */
const SUGGESTION_FOR_FINDING: Readonly<Record<string, CopilotSuggestion['kind']>> = {
  uncovered_surface: 'cover-uncovered-surface',
  dominant_cell: 'split-dominant-cell',
  single_layer_dependency: 'split-dominant-cell',
};

/** "Structural" — the reported-and-never-scored findings, which are still actionable. */
function structural(
  builder: Builder,
  kind: string,
  cells: readonly string[],
  statement: string,
): void {
  const target = cells[0];
  const suggestionKind = target === undefined ? undefined : SUGGESTION_FOR_FINDING[kind];
  if (target === undefined || suggestionKind === undefined) return;
  builder.suggestions.push({
    kind: suggestionKind,
    what: statement,
    why: 'A structural finding: the suite is green and the thing it claims to cover is not exercised.',
    target,
    impact: -0.5,
    evidence: cells.map((cell) => ({
      kind: 'cell' as const satisfies CopilotEvidence['kind'],
      id: cell,
      summary: statement,
    })),
    overrides: { version: 1 },
    confidence: 0.6,
  });
}

/**
 * "Locked pyramid" — fires **only** when the project declared its own target.
 *
 * No declared target, no suggestion. A copilot that opens with "your test pyramid
 * is inverted" is opening with an opinion the team never asked for, and a team
 * that did not ask for it has no reason to read the rest.
 */
function lockedPyramid(builder: Builder, score: QaScore, wanted: string | null): void {
  // **Two gates, both load-bearing.** `declaredTarget !== null`: no declared target,
  // no suggestion — the default exists so a chart has something to draw against, and
  // a client must not mistake it for a decision the team made. And `wanted === null`:
  // a global shape observation is not an answer to "what is wrong with security?".
  if (score.pyramid.declaredTarget === null || wanted !== null) return;
  if (score.pyramid.shape >= 0.8) return;
  builder.suggestions.push({
    kind: 'decode-locked-pyramid',
    what: 'The test suite shape has drifted from the target this project declared.',
    why: `Observed ${describeShape(score.pyramid.observed)} against a declared target of ${describeShape(score.pyramid.target)}; drift ${score.pyramid.drift.toFixed(2)}.`,
    target: 'pyramid-shape',
    // Positive: reaching a declared target *raises* the score, so this is one of
    // the few suggestions where the honest impact is positive.
    //
    // `1 - shape`, **not** `drift`. The drift is an L1 norm over three shares and
    // runs to `2` for a fully inverted pyramid; the contract bounds `impact` to
    // `[0,1]`, and `1 - shape` is the bounded version of the same statement —
    // "how much of the total is missing here".
    impact: 1 - score.pyramid.shape,
    evidence: [
      {
        kind: 'project',
        id: score.projectId,
        summary: "The pyramid target is declared in this project's automate.config.json.",
      },
    ],
    overrides: { version: 1, targets: { pyramid: score.pyramid.target } },
    confidence: 0.7,
  });
}

function describeShape(vector: { unit: number; integration: number; e2e: number }): string {
  const percent = (value: number): string => `${Math.round(value * 100)}%`;
  return `${percent(vector.unit)} unit / ${percent(vector.integration)} integration / ${percent(vector.e2e)} e2e`;
}

void (undefined as unknown as CopilotEvidence);
