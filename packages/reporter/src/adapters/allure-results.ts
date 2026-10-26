import { testIdentity, type CanonicalRunResult } from '@automate/shared-contracts';
import type { ProducerAdapter } from '../adapter.js';
import { canonicalRunResult } from '../canonical-run-result.js';
import { canonicalTestStatusFrom, outcomesWithDeclaredRunStatus } from '../producer-status.js';

/**
 * Allure results (`allure-results/*-result.json`), for a team moving off Allure.
 *
 * **The document is the results, as one JSON value**: an array of result objects, `{ "results":
 * [...] }`, or a single result. Allure writes one file per result and none of them is a
 * report, so the way to send a directory is to concatenate it:
 *
 * ```sh
 * jq -s . allure-results/*-result.json > allure.json
 * ```
 *
 * **Identity** is the shared `testIdentity`, built from what Allure labels a result with:
 * `testClass` (else `package`) is the file, `parentSuite › suite › subSuite` the describe
 * path, `name` the title, and the result's non-excluded `parameters` the project — the same
 * things Allure's own `historyId` hashes, so a parametrised test is as many tests here as it
 * is there, and a history carried over keeps its shape.
 *
 * **Retries** are several results with one identity. They are one test's attempts, ordered by
 * start; the outcome is the last, and a test whose attempts disagree is flaky — the rule the
 * Playwright adapter applies, so the same retried test reads the same from either producer.
 *
 * `broken` (Allure's word for an unexpected exception, as against a failed assertion) is a
 * failure here: this product separates harness failures by where they happen, and Allure's
 * word says nothing about that. Attachments are listed by Allure as file names with no bytes,
 * so there is no evidence to carry and none is invented.
 */

const MAX_RESULTS = 50_000;
const MAX_MESSAGE = 8_192;
const UNKNOWN_FILE = 'unknown.spec.ts';

interface AllureLabel {
  name?: unknown;
  value?: unknown;
}
interface AllureParameter {
  name?: unknown;
  value?: unknown;
  excluded?: unknown;
}
interface AllureResult {
  name?: unknown;
  fullName?: unknown;
  status?: unknown;
  start?: unknown;
  stop?: unknown;
  labels?: unknown;
  parameters?: unknown;
  statusDetails?: { message?: unknown } | null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function labelsOf(result: AllureResult): Map<string, string[]> {
  const labels = new Map<string, string[]>();
  if (!Array.isArray(result.labels)) return labels;
  for (const label of result.labels as (AllureLabel | null)[]) {
    const name = text(label?.name);
    const value = text(label?.value);
    if (name !== '' && value !== '') labels.set(name, [...(labels.get(name) ?? []), value]);
  }
  return labels;
}

/** A relative path made of the label's own segments: never absolute, never `..`. */
function relativePath(value: string): string {
  const segments = value
    .replaceAll('\\', '/')
    // A drive letter makes a path local; the schema refuses it, so drop it with the root.
    .replace(/^[a-zA-Z]:/u, '')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..');
  return segments.length === 0 ? UNKNOWN_FILE : segments.join('/');
}

/** Non-excluded parameters, sorted, as `a=1, b=2` — what Allure's `historyId` is made of. */
function variantOf(result: AllureResult): string {
  if (!Array.isArray(result.parameters)) return '';
  return (result.parameters as (AllureParameter | null)[])
    .filter((parameter) => parameter?.excluded !== true && text(parameter?.name) !== '')
    .map((parameter) => `${text(parameter?.name)}=${text(parameter?.value)}`)
    .sort()
    .join(', ');
}

function isoOf(value: unknown, fallback: string): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value).toISOString()
    : fallback;
}

function resultsOf(document: string): AllureResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(document);
  } catch (cause) {
    throw new Error('Allure results are not valid JSON', { cause });
  }
  const list = Array.isArray(parsed)
    ? (parsed as unknown[])
    : typeof parsed === 'object' &&
        parsed !== null &&
        Array.isArray((parsed as AllureResult & { results?: unknown }).results)
      ? (parsed as { results: unknown[] }).results
      : typeof parsed === 'object' && parsed !== null
        ? [parsed]
        : null;
  if (list === null) throw new Error('Allure results are not a JSON object or array');
  if (list.length > MAX_RESULTS)
    throw new Error(`Allure results hold more than ${String(MAX_RESULTS)} results`);
  return list.filter(
    (item): item is AllureResult =>
      typeof item === 'object' && item !== null && text((item as AllureResult).name) !== '',
  );
}

interface Attempt {
  result: AllureResult;
  startMs: number;
}

export const allureResultsAdapter: ProducerAdapter = {
  mediaType: 'application/vnd.allure.results+json',
  parse(input, context) {
    const results = resultsOf(new TextDecoder().decode(input));
    // One entry per test, in the order its first result appeared.
    const tests = new Map<
      string,
      { file: string; describePath: string[]; title: string; variant: string; attempts: Attempt[] }
    >();
    for (const result of results) {
      const labels = labelsOf(result);
      const file = relativePath(labels.get('testClass')?.[0] ?? labels.get('package')?.[0] ?? '');
      const describePath = ['parentSuite', 'suite', 'subSuite'].flatMap(
        (name) => labels.get(name)?.[0] ?? [],
      );
      const title = text(result.name);
      const variant = variantOf(result);
      const identity = testIdentity({ file, describePath, title, project: variant });
      const entry = tests.get(identity) ?? { file, describePath, title, variant, attempts: [] };
      entry.attempts.push({
        result,
        startMs:
          typeof result.start === 'number' && Number.isFinite(result.start) ? result.start : 0,
      });
      tests.set(identity, entry);
    }
    if (tests.size === 0) throw new Error('Allure results contain no test results');

    const finalOutcomes: CanonicalRunResult['status'][] = [];
    const attempts = [...tests.entries()].flatMap(([identity, test]) => {
      const ordered = [...test.attempts].sort((left, right) => left.startMs - right.startMs);
      const statuses = ordered.map((attempt) =>
        canonicalTestStatusFrom('allure', text(attempt.result.status)),
      );
      const flaky = statuses.some((status) => status !== statuses[0]);
      finalOutcomes.push(flaky ? 'flaky' : (statuses.at(-1) ?? 'unknown'));
      return ordered.map(({ result }, index) => {
        const start = isoOf(result.start, context.startedAt);
        const stop = typeof result.stop === 'number' ? result.stop : undefined;
        const duration =
          typeof result.start === 'number' && stop !== undefined && stop >= result.start
            ? stop - result.start
            : undefined;
        const message = text(result.statusDetails?.message).slice(0, MAX_MESSAGE);
        return {
          index: index + 1,
          testId: identity,
          specPath: test.file,
          title: test.title,
          describePath: test.describePath,
          ...(test.variant === '' ? {} : { project: test.variant }),
          status: statuses[index] ?? 'unknown',
          rawStatus: text(result.status) || 'unknown',
          startedAt: start,
          finishedAt: stop === undefined ? context.finishedAt : isoOf(stop, start),
          durationMs: duration,
          error: message === '' ? undefined : { message },
          evidence: [],
          flakiness: flaky ? ('observed' as const) : ('unknown' as const),
        };
      });
    });
    return canonicalRunResult(
      {
        outcomes: outcomesWithDeclaredRunStatus(finalOutcomes, context.declaredRunStatus),
        attempts,
        reportErrors: [],
        evidence: [],
        producer: 'allure',
        verifier: 'packages/reporter allure-results',
      },
      context,
    );
  },
};
