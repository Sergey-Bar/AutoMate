import { createHash } from 'node:crypto';
import { db } from '../db/client.js';
import { locatorSuggestions } from '../db/schema.js';
import { getAiProvider } from './ai-provider-registry.js';

export interface LocatorSuggestion {
  id: string;
  resultId: string;
  originalSelector: string;
  suggestedSelector: string;
  confidence: number;
  rationale: string;
  status: 'pending' | 'accepted' | 'dismissed';
  createdAt: string;
}

export interface SelectorContext {
  originalSelector: string;
  errorMessage: string | null;
  pageContent?: string;
  historicalSelectors?: string[];
}

export const CONFIDENCE_THRESHOLD = 0.7;

export const WEIGHTS = {
  attributeTokenOverlap: 0.4,
  selectorStructureSimilarity: 0.3,
  historicalStabilitySignal: 0.2,
  errorContextMatch: 0.1,
} as const;

const TOKEN_SPLIT_PATTERN = /[[.#\]\s>~+"'=:/()]+/g;

const STRUCTURE_TOKEN_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ['hasTag', /(^|[\s>+~])([a-z][\w-]*)/i],
  ['hasClass', /\./],
  ['hasId', /#/],
  ['hasAttribute', /\[[^\]]+\]/],
  ['hasNthChild', /:nth-child\(/i],
  ['hasPseudo', /:[a-z-]+(\(|$)/i],
  ['hasCombinatorChild', />/],
  ['hasCombinatorAdjacent', /\+/],
  ['hasCombinatorSibling', /~/],
  ['hasDescendant', /\s+/],
  ['hasTextEngine', /\btext\s*=/i],
  ['hasRoleEngine', /\brole\s*=/i],
  ['hasDataTestId', /data-testid/i],
  ['hasAriaLabel', /aria-label/i],
];

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}

function tokenizeSelector(selector: string): string[] {
  return selector
    .toLowerCase()
    .split(TOKEN_SPLIT_PATTERN)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function uniqueTokens(selector: string): Set<string> {
  return new Set(tokenizeSelector(selector));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 1;
  }

  const intersectionCount = [...a].filter((token) => b.has(token)).length;
  const unionCount = new Set([...a, ...b]).size;

  if (unionCount === 0) {
    return 0;
  }

  return intersectionCount / unionCount;
}

function extractKeywordCandidates(selector: string): string[] {
  const tokens = tokenizeSelector(selector).filter(
    (token) => token !== 'data-testid' && token !== 'aria-label' && token !== 'nth-child',
  );

  return [...new Set(tokens)].sort();
}

function extractCoreSubject(selector: string): string {
  const segments = selector
    .split(/[>~+]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const deepest = segments.length > 0 ? segments[segments.length - 1] : selector;
  return (deepest ?? selector).replace(/:nth-child\([^)]*\)/gi, '').trim() || selector;
}

function dedupeAndSort(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function formatRationale(components: {
  attributeTokenOverlap: number;
  selectorStructureSimilarity: number;
  historicalStabilitySignal: number;
  errorContextMatch: number;
  confidence: number;
}): string {
  return [
    `attributeTokenOverlap=${components.attributeTokenOverlap.toFixed(3)}×${WEIGHTS.attributeTokenOverlap.toFixed(2)}`,
    `selectorStructureSimilarity=${components.selectorStructureSimilarity.toFixed(3)}×${WEIGHTS.selectorStructureSimilarity.toFixed(2)}`,
    `historicalStabilitySignal=${components.historicalStabilitySignal.toFixed(3)}×${WEIGHTS.historicalStabilitySignal.toFixed(2)}`,
    `errorContextMatch=${components.errorContextMatch.toFixed(3)}×${WEIGHTS.errorContextMatch.toFixed(2)}`,
    `confidence=${components.confidence.toFixed(3)}`,
  ].join('; ');
}

function buildDeterministicSuggestionId(resultId: string, originalSelector: string, candidate: string): string {
  return createHash('sha256')
    .update(`${resultId}::${originalSelector}::${candidate}`)
    .digest('hex')
    .slice(0, 24);
}

function buildDeterministicCreatedAt(resultId: string, originalSelector: string, candidate: string): string {
  const hash = createHash('sha256')
    .update(`createdAt::${resultId}::${originalSelector}::${candidate}`)
    .digest('hex');
  const seconds = parseInt(hash.slice(0, 8), 16) % 4_102_444_800;
  return new Date(seconds * 1_000).toISOString();
}

export function computeAttributeTokenOverlap(original: string, candidate: string): number {
  return roundScore(jaccardSimilarity(uniqueTokens(original), uniqueTokens(candidate)));
}

export function computeSelectorStructureSimilarity(original: string, candidate: string): number {
  let matches = 0;

  for (const [, pattern] of STRUCTURE_TOKEN_PATTERNS) {
    const originalHasPattern = pattern.test(original);
    const candidateHasPattern = pattern.test(candidate);
    if (originalHasPattern === candidateHasPattern) {
      matches += 1;
    }
  }

  return roundScore(matches / STRUCTURE_TOKEN_PATTERNS.length);
}

export function computeHistoricalStabilitySignal(
  candidate: string,
  historicalSelectors: string[],
): number {
  if (historicalSelectors.length === 0) {
    return 0.5;
  }

  if (historicalSelectors.includes(candidate)) {
    return 1;
  }

  const candidateTokens = uniqueTokens(candidate);
  const overlaps = historicalSelectors.map((historical) =>
    jaccardSimilarity(candidateTokens, uniqueTokens(historical)),
  );

  const bestOverlap = Math.max(0, ...overlaps);
  return roundScore(bestOverlap);
}

export function computeErrorContextMatch(candidate: string, errorMessage: string | null): number {
  if (!errorMessage) {
    return 0.5;
  }

  const errorTokens = new Set(tokenizeSelector(errorMessage));
  if (errorTokens.size === 0) {
    return 0.5;
  }

  const candidateTokens = uniqueTokens(candidate);
  if (candidateTokens.size === 0) {
    return 0.5;
  }
  const overlapCount = [...candidateTokens].filter((token) => errorTokens.has(token)).length;

  return roundScore(overlapCount / candidateTokens.size);
}

export function computeConfidence(original: string, candidate: string, context: SelectorContext): number {
  const attributeTokenOverlap = computeAttributeTokenOverlap(original, candidate);
  const selectorStructureSimilarity = computeSelectorStructureSimilarity(original, candidate);
  const historicalStabilitySignal = computeHistoricalStabilitySignal(
    candidate,
    context.historicalSelectors ?? [],
  );
  const errorContextMatch = computeErrorContextMatch(candidate, context.errorMessage);

  const confidence =
    WEIGHTS.attributeTokenOverlap * attributeTokenOverlap +
    WEIGHTS.selectorStructureSimilarity * selectorStructureSimilarity +
    WEIGHTS.historicalStabilitySignal * historicalStabilitySignal +
    WEIGHTS.errorContextMatch * errorContextMatch;

  return roundScore(confidence);
}

export function generateAlternatives(context: SelectorContext): string[] {
  const original = context.originalSelector.trim();
  const keywords = extractKeywordCandidates(original);
  const primaryKeyword = keywords[0] ?? 'target';
  const historical = context.historicalSelectors ?? [];
  const alternatives: string[] = [];

  if (original.includes('.')) {
    alternatives.push(`[data-testid="${primaryKeyword}"]`);
    alternatives.push(`[aria-label="${primaryKeyword}"]`);
  }

  if (/:nth-child\(/i.test(original)) {
    alternatives.push(`text=${primaryKeyword}`);
  }

  if (/[>~+]/.test(original)) {
    alternatives.push(extractCoreSubject(original));
  }

  alternatives.push(...historical);

  return dedupeAndSort(alternatives);
}

// ── Selector failure detection ────────────────────────────────────────────────

const SELECTOR_FAILURE_PATTERNS: ReadonlyArray<RegExp> = [
  /locator\.(click|fill|check|uncheck|hover|press|type|tap|dblclick|selectOption|waitFor)/i,
  /waitForSelector/i,
  /getByRole/i,
  /getByText/i,
  /getByLabel/i,
  /getByPlaceholder/i,
  /getByTestId/i,
  /Timeout.*waiting.*selector/i,
  /strict mode violation/i,
  /No elements found/i,
  /locator.*expected to be visible/i,
];

export function isSelectorFailure(errorMessage: string | null): boolean {
  if (!errorMessage) return false;
  return SELECTOR_FAILURE_PATTERNS.some((pattern) => pattern.test(errorMessage));
}

// ── AI-assisted selector suggestion ──────────────────────────────────────────

export async function aiSuggestSelector(
  context: SelectorContext,
): Promise<LocatorSuggestion | null> {
  try {
    const { adapter, config } = await getAiProvider();
    const prompt =
      `The selector \`${context.originalSelector}\` no longer matches an element. ` +
      `Error: ${context.errorMessage ?? 'unknown'}. ` +
      `Suggest an accessibility-first replacement selector. ` +
      `Respond with JSON only: { "selector": string, "rationale": string }`;

    const text = await adapter.createCompletion(prompt, config);

    // Strip markdown code fences if present
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(stripped) as Record<string, unknown>;

    if (typeof parsed['selector'] !== 'string' || typeof parsed['rationale'] !== 'string') {
      return null;
    }

    const suggestedSelector = parsed['selector'];
    const rationale = parsed['rationale'];

    if (!suggestedSelector) return null;

    const id = createHash('sha256')
      .update(`ai::${context.originalSelector}::${suggestedSelector}`)
      .digest('hex')
      .slice(0, 24);

    const confidence = computeConfidence(context.originalSelector, suggestedSelector, context);

    return {
      id,
      resultId: 'ai-suggestion',
      originalSelector: context.originalSelector,
      suggestedSelector,
      confidence,
      rationale,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ── Persist suggestions to DB ─────────────────────────────────────────────────

export async function analyzeAndPersist(
  testId: string,
  runId: string,
  resultId: string,
  context: SelectorContext,
): Promise<void> {
  // 1. Heuristic analysis
  const heuristic = analyzeSelector(resultId, context);

  // 2. AI strategy if no high-confidence heuristics
  const hasHighConfidenceHeuristic = heuristic.some((s) => s.confidence > 0.8);

  let aiSuggestion: LocatorSuggestion | null = null;
  if (!hasHighConfidenceHeuristic) {
    try {
      aiSuggestion = await aiSuggestSelector(context);
    } catch {
      // AI failure is non-fatal — skip gracefully
    }
  }

  // 3. Combine, deduplicate by suggestedSelector, take top 3 by confidence
  const all = [...heuristic, ...(aiSuggestion !== null ? [aiSuggestion] : [])];
  const seen = new Set<string>();
  const unique = all.filter((s) => {
    if (seen.has(s.suggestedSelector)) return false;
    seen.add(s.suggestedSelector);
    return true;
  });
  const top3 = unique
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  // 4. Persist
  for (const suggestion of top3) {
    await db
      .insert(locatorSuggestions)
      .values({
        id: suggestion.id,
        testId,
        runId,
        originalSelector: suggestion.originalSelector,
        suggestedSelector: suggestion.suggestedSelector,
        confidence: suggestion.confidence,
        rationale: suggestion.rationale,
        status: 'pending',
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing();
  }
}

// ── Selector analysis (heuristic) ─────────────────────────────────────────────

export function analyzeSelector(
  resultId: string,
  context: SelectorContext,
  threshold: number = CONFIDENCE_THRESHOLD,
): LocatorSuggestion[] {
  const alternatives = generateAlternatives(context);

  const suggestions = alternatives
    .map((candidate) => {
      const attributeTokenOverlap = computeAttributeTokenOverlap(context.originalSelector, candidate);
      const selectorStructureSimilarity = computeSelectorStructureSimilarity(
        context.originalSelector,
        candidate,
      );
      const historicalStabilitySignal = computeHistoricalStabilitySignal(
        candidate,
        context.historicalSelectors ?? [],
      );
      const errorContextMatch = computeErrorContextMatch(candidate, context.errorMessage);
      const confidence = computeConfidence(context.originalSelector, candidate, context);

      return {
        id: buildDeterministicSuggestionId(resultId, context.originalSelector, candidate),
        resultId,
        originalSelector: context.originalSelector,
        suggestedSelector: candidate,
        confidence,
        rationale: formatRationale({
          attributeTokenOverlap,
          selectorStructureSimilarity,
          historicalStabilitySignal,
          errorContextMatch,
          confidence,
        }),
        status: 'pending' as const,
        createdAt: buildDeterministicCreatedAt(resultId, context.originalSelector, candidate),
      };
    })
    .filter((suggestion) => suggestion.confidence >= threshold)
    .sort((a, b) => {
      if (b.confidence === a.confidence) {
        return a.suggestedSelector.localeCompare(b.suggestedSelector);
      }
      return b.confidence - a.confidence;
    });

  return suggestions;
}
