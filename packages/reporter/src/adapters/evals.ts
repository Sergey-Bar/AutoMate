import { createHash } from 'node:crypto';
import type { DimensionMetric } from '@automate/shared-contracts';
import { HealthReportError, MAX_HEALTH_REPORT_BYTES } from './sarif.js';
import { type Json, record, text, finite } from './json-fields.js';

/**
 * LLM eval reports → one canonical eval run.
 *
 * Three tools, read from the files they write:
 *
 * | Format              | Written by                                   | Cases are            |
 * | ------------------- | -------------------------------------------- | -------------------- |
 * | `promptfoo-json`    | `promptfoo eval -o results.json` (v2 and v3) | `results.results[]`  |
 * | `deepeval-json`     | DeepEval's saved `TestRun`                   | `testCases[]` + conversational |
 * | `inspect-eval-json` | Inspect AI's JSON eval log                   | `samples[]`          |
 *
 * Field names follow each tool's own model — promptfoo's `EvaluateResult` and `OutputFile`,
 * DeepEval's `TestRun` / `LLMApiTestCase` (both its camelCase aliases and the snake_case
 * field names, because which one is written depends on how the run was serialised), and
 * Inspect's `EvalLog` / `EvalSample`. Every field is read defensively: a missing or mistyped
 * one is `null`, never a guess.
 *
 * ## One case, many attempts
 *
 * A promptfoo `--repeat`, an Inspect epoch, a DeepEval case listed twice: each is another
 * attempt of one case. Pass rates, flakiness and regressions are all about a case's
 * attempts, so splitting them into separate cases would make every repeated case look
 * perfectly stable.
 *
 * ## Identity
 *
 * `caseId` is the tool's own stable id where it has one — Inspect's `sample.id`, or a
 * promptfoo test's declared `metadata.id` — and otherwise the sha256 of the case's inputs.
 * promptfoo's row `id` is deliberately **not** used: it is regenerated on every eval, so a
 * baseline and a candidate would share no case at all. When one promptfoo run crosses tests
 * with several providers or prompts, each pairing is its own case, suffixed ` @ provider`
 * and ` # prompt` for only the dimensions that actually vary.
 *
 * ## Prompts are hashed, and kept only when asked
 *
 * A prompt can carry customer data, so `prompt` is `null` unless `storePrompts` is set.
 * `promptHash` is always kept: it is what tells two runs of "the same suite" apart when a
 * prompt changed, and it is the input to `configHash` alongside the suite and the model.
 *
 * ## What "passed" means for each tool
 *
 * An attempt that errored is undecided (`passed: null`), never failed: a rate limit is not a
 * wrong answer. promptfoo's `success` and DeepEval's `success` are used as written. Inspect has
 * no per-sample verdict, so one is read from the scores: `C`, `yes`, `true` pass; `I`, `P`
 * (partial is not correct), `N`, `no`, `false` fail; a bare number has no threshold and
 * decides nothing. An attempt passes when every deciding score passes.
 *
 * ## Cost
 *
 * promptfoo's `cost` and DeepEval's `tokenCost` are the system under test's spend, not the
 * grader's (`evaluationCost` is left out). Inspect's `model_usage[*].total_cost` is summed over
 * every model the sample used, which can include a model-graded scorer; it is the only cost
 * Inspect records.
 */
export const EVAL_ADAPTER_VERSION = '1';

export const EVAL_REPORT_FORMATS = [
  'promptfoo-json',
  'deepeval-json',
  'inspect-eval-json',
] as const;
export type EvalReportFormat = (typeof EVAL_REPORT_FORMATS)[number];

/** More cases than this and the rest are dropped, with `truncated` set, so the cut is visible. */
export const MAX_EVAL_CASES = 20_000;
/** A stored prompt is cut here; the hash is always over the whole prompt. */
const MAX_PROMPT_CHARS = 20_000;
const MAX_LABEL_CHARS = 300;
const MAX_ID_CHARS = 300;
const MAX_METRIC_CHARS = 100;

export interface EvalScore {
  metric: string;
  score: number | null;
  threshold: number | null;
  passed: boolean | null;
}

export interface EvalAttempt {
  /** 1-based. The tool's epoch or repeat index where it gives one, else the order seen. */
  epoch: number;
  /** `null` when undecided: the attempt errored, or nothing in it decides pass or fail. */
  passed: boolean | null;
  error: string | null;
  scores: EvalScore[];
  latencyMs: number | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  costUsd: number | null;
}

export interface EvalCase {
  /** Stable: the tool's id, else sha256 of the case's inputs. */
  caseId: string;
  label: string;
  promptHash: string | null;
  /** Only when `storePrompts` is set; otherwise `null`. */
  prompt: string | null;
  attempts: EvalAttempt[];
}

export interface EvalTotals {
  cases: number;
  attempts: number;
  passed: number;
  failed: number;
  errors: number;
  tokensInput: number | null;
  tokensOutput: number | null;
  costUsd: number | null;
  meanLatencyMs: number | null;
}

export interface EvalRun {
  tool: { name: string; version: string | null };
  suite: string;
  model: string | null;
  provider: string | null;
  /** sha256 of the canonical description of suite, model and the set of prompt hashes. */
  configHash: string;
  cases: EvalCase[];
  totals: EvalTotals;
  truncated: boolean;
}

export interface EvalReportOptions {
  storePrompts?: boolean;
}

function records(value: unknown): Json[] {
  return Array.isArray(value)
    ? value.map(record).filter((entry): entry is Json => entry !== null)
    : [];
}

function count(value: unknown): number | null {
  const number = finite(value);
  return number !== null && number >= 0 ? number : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** An id as text: a string, or an integer some tools write instead. */
function idText(value: unknown): string | null {
  return text(value) ?? (finite(value) === null ? null : String(value));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** JSON with keys sorted at every depth, so equal inputs hash equal whatever order they came in. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    const object = record(inner);
    if (object === null) return inner;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, object[key]]),
    );
  });
}

/** An id longer than an id should be is hashed rather than cut, so two never merge. */
function boundedId(id: string): string {
  return id.length > MAX_ID_CHARS ? sha256(id) : id;
}

/** One attempt as a parser saw it, before attempts are grouped into cases. */
interface RawAttempt {
  caseId: string;
  label: string;
  promptText: string | null;
  attempt: Omit<EvalAttempt, 'epoch'> & { epoch: number | null };
}

/** What a format parser produces; the grouping, capping and totals are shared. */
interface ParsedReport {
  tool: { name: string; version: string | null };
  suite: string;
  model: string | null;
  provider: string | null;
  attempts: RawAttempt[];
}

function score(
  metric: string,
  value: number | null,
  threshold: number | null,
  passed: boolean | null,
): EvalScore {
  return { metric: metric.slice(0, MAX_METRIC_CHARS), score: value, threshold, passed };
}

/** Undecided when it errored or nothing decided; failed when any deciding score failed. */
function verdictOf(scores: readonly EvalScore[]): boolean | null {
  const decided = scores.filter((entry) => entry.passed !== null);
  if (decided.length === 0) return null;
  return decided.every((entry) => entry.passed === true);
}

function sum(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((total, value) => total + value, 0);
}

// --- promptfoo -------------------------------------------------------------------------

/** promptfoo `ResultFailureReason.ERROR`. */
const PROMPTFOO_ERROR = 2;

function promptfooProvider(row: Json): string | null {
  return text(record(row['provider'])?.['id']) ?? text(row['provider']);
}

function promptfooPromptKey(row: Json): string {
  return (
    text(record(row['prompt'])?.['label']) ??
    text(row['promptId']) ??
    String(finite(row['promptIdx']) ?? 0)
  );
}

/** `openai:chat:gpt-4o` → provider `openai`, model `gpt-4o`. */
function promptfooModel(id: string | null): { provider: string | null; model: string | null } {
  if (id === null) return { provider: null, model: null };
  const colon = id.indexOf(':');
  if (colon < 0) return { provider: null, model: id };
  return {
    provider: id.slice(0, colon),
    model: id.slice(colon + 1).replace(/^(chat|completion|responses|messages):/u, ''),
  };
}

function promptfooScores(row: Json, testCase: Json | null): EvalScore[] {
  const grading = record(row['gradingResult']);
  const components = records(grading?.['componentResults']);
  if (components.length > 0) {
    return components.map((component) => {
      const assertion = record(component['assertion']);
      return score(
        text(assertion?.['metric']) ?? text(assertion?.['type']) ?? 'assertion',
        finite(component['score']),
        finite(assertion?.['threshold']),
        bool(component['pass']),
      );
    });
  }
  const named = Object.entries(record(row['namedScores']) ?? {}).flatMap(([metric, value]) => {
    const number = finite(value);
    return number === null ? [] : [score(metric, number, null, null)];
  });
  if (named.length > 0) return named;
  if (grading === null) return [];
  return [
    score(
      'score',
      finite(grading['score']),
      finite(testCase?.['threshold']),
      bool(grading['pass']),
    ),
  ];
}

/**
 * Whether the row is an error rather than an answer. Exports since `failureReason` say so;
 * older ones put an assertion's reason in `error` too, so there an error is only an `error`
 * with no grading at all.
 */
function promptfooError(row: Json): string | null {
  const reason = row['failureReason'];
  if (reason === PROMPTFOO_ERROR) return text(row['error']) ?? 'error';
  if (reason === undefined && record(row['gradingResult']) === null && row['success'] !== true) {
    return text(row['error']);
  }
  return null;
}

function promptfooAttempt(row: Json, suffix: string): RawAttempt {
  const testCase = record(row['testCase']);
  const declared = idText(record(testCase?.['metadata'])?.['id']);
  const base =
    declared === null
      ? sha256(
          canonicalJson({
            description: testCase?.['description'] ?? null,
            vars: testCase?.['vars'] ?? row['vars'] ?? null,
          }),
        )
      : boundedId(declared);
  const response = record(row['response']);
  const usage = record(response?.['tokenUsage']) ?? record(row['tokenUsage']);
  const error = promptfooError(row);
  const repeatIndex = row['repeatIndex'];
  return {
    caseId: `${base}${suffix}`,
    label: `${text(testCase?.['description']) ?? text(row['description']) ?? base}${suffix}`,
    promptText: text(record(row['prompt'])?.['raw']),
    attempt: {
      epoch:
        typeof repeatIndex === 'number' && Number.isInteger(repeatIndex) ? repeatIndex + 1 : null,
      passed: error === null ? bool(row['success']) : null,
      error,
      scores: promptfooScores(row, testCase),
      latencyMs: count(row['latencyMs']),
      tokensInput: count(usage?.['prompt']),
      tokensOutput: count(usage?.['completion']),
      costUsd: count(row['cost']) ?? count(response?.['cost']),
    },
  };
}

function parsePromptfoo(document: Json): ParsedReport {
  // An `OutputFile` wraps the summary in `results`; a bare `EvaluateSummary` is accepted too.
  const summary = Array.isArray(document['results']) ? document : record(document['results']);
  if (summary === null || !Array.isArray(summary['results'])) {
    throw new HealthReportError('malformed', 'promptfoo report has no results.results array');
  }
  const rows = records(summary['results']);
  const providers = new Set(rows.map(promptfooProvider));
  const prompts = new Set(rows.map(promptfooPromptKey));
  const attempts = rows.map((row) => {
    const provider = providers.size > 1 ? ` @ ${promptfooProvider(row) ?? 'unknown'}` : '';
    const prompt = prompts.size > 1 ? ` # ${promptfooPromptKey(row)}` : '';
    return promptfooAttempt(row, `${provider}${prompt}`);
  });
  const only = providers.size === 1 ? ([...providers][0] ?? null) : null;
  return {
    tool: {
      name: 'promptfoo',
      version: text(record(document['metadata'])?.['promptfooVersion']),
    },
    suite: text(record(document['config'])?.['description']) ?? 'promptfoo',
    ...promptfooModel(only),
    attempts,
  };
}

// --- DeepEval --------------------------------------------------------------------------

/** DeepEval writes camelCase aliases or snake_case names depending on how it serialised. */
function field(source: Json, camel: string, snake: string): unknown {
  return source[camel] ?? source[snake];
}

function seconds(value: unknown): number | null {
  const number = count(value);
  return number === null ? null : number * 1000;
}

function deepevalVerdict(testCase: Json): Pick<EvalAttempt, 'passed' | 'error' | 'scores'> {
  const metrics = records(field(testCase, 'metricsData', 'metrics_data'));
  const scores = metrics.map((metric) =>
    score(
      text(metric['name']) ?? 'metric',
      finite(metric['score']),
      finite(metric['threshold']),
      text(metric['error']) === null ? bool(metric['success']) : null,
    ),
  );
  const error =
    metrics.map((metric) => text(metric['error'])).find((value) => value !== null) ?? null;
  return { passed: error === null ? bool(testCase['success']) : null, error, scores };
}

function turnsOf(value: unknown): { role: unknown; content: unknown }[] {
  return records(value).map((turn) => ({
    role: turn['role'] ?? null,
    content: turn['content'] ?? null,
  }));
}

function deepevalAttempt(testCase: Json): RawAttempt {
  const input = text(testCase['input']);
  const caseId = sha256(
    canonicalJson({
      input: testCase['input'] ?? null,
      expectedOutput: field(testCase, 'expectedOutput', 'expected_output') ?? null,
      context: testCase['context'] ?? null,
      retrievalContext: field(testCase, 'retrievalContext', 'retrieval_context') ?? null,
    }),
  );
  return {
    caseId,
    label: text(testCase['name']) ?? caseId,
    promptText: input,
    attempt: {
      epoch: null,
      ...deepevalVerdict(testCase),
      latencyMs: seconds(field(testCase, 'completionTime', 'completion_time')),
      tokensInput: count(field(testCase, 'inputTokenCount', 'input_token_count')),
      tokensOutput: count(field(testCase, 'outputTokenCount', 'output_token_count')),
      costUsd: count(field(testCase, 'tokenCost', 'token_cost')),
    },
  };
}

function deepevalConversation(testCase: Json): RawAttempt {
  const scenario = text(testCase['scenario']);
  const turns = turnsOf(testCase['turns']);
  const caseId = sha256(canonicalJson({ scenario, turns }));
  return {
    caseId,
    label: text(testCase['name']) ?? caseId,
    promptText: scenario ?? (turns.length > 0 ? canonicalJson(turns) : null),
    attempt: {
      epoch: null,
      ...deepevalVerdict(testCase),
      latencyMs: null,
      tokensInput: null,
      tokensOutput: null,
      costUsd: null,
    },
  };
}

function parseDeepEval(document: Json): ParsedReport {
  const single = field(document, 'testCases', 'test_cases');
  const conversational = field(document, 'conversationalTestCases', 'conversational_test_cases');
  if (!Array.isArray(single) && !Array.isArray(conversational)) {
    throw new HealthReportError('malformed', 'DeepEval report has no testCases array');
  }
  return {
    // DeepEval's saved test run records no version of DeepEval.
    tool: { name: 'deepeval', version: null },
    suite:
      text(document['identifier']) ??
      text(field(document, 'testFile', 'test_file')) ??
      text(field(document, 'datasetAlias', 'dataset_alias')) ??
      'deepeval',
    model: text(record(document['hyperparameters'])?.['model']),
    provider: null,
    attempts: [
      ...records(single).map(deepevalAttempt),
      ...records(conversational).map(deepevalConversation),
    ],
  };
}

// --- Inspect AI ------------------------------------------------------------------------

/** Inspect's `CORRECT`, `INCORRECT`, `PARTIAL`, `NOANSWER`, and the words `value_to_float` reads. */
const INSPECT_WORDS: Readonly<Record<string, { score: number; passed: boolean }>> = {
  c: { score: 1, passed: true },
  i: { score: 0, passed: false },
  p: { score: 0.5, passed: false },
  n: { score: 0, passed: false },
  yes: { score: 1, passed: true },
  true: { score: 1, passed: true },
  no: { score: 0, passed: false },
  false: { score: 0, passed: false },
};

function inspectValue(metric: string, value: unknown): EvalScore {
  if (typeof value === 'boolean') return score(metric, value ? 1 : 0, null, value);
  const number = finite(value);
  if (number !== null) return score(metric, number, null, null);
  if (typeof value === 'string') {
    const word = INSPECT_WORDS[value.trim().toLowerCase()];
    if (word !== undefined) return score(metric, word.score, null, word.passed);
    const parsed = value.trim() === '' ? Number.NaN : Number(value);
    return score(metric, Number.isFinite(parsed) ? parsed : null, null, null);
  }
  return score(metric, null, null, null);
}

function inspectScores(sample: Json): EvalScore[] {
  // `score` (singular) is the deprecated field older logs wrote.
  const scores =
    record(sample['scores']) ??
    (record(sample['score']) === null ? {} : { score: sample['score'] });
  return Object.entries(scores).flatMap(([name, raw]) => {
    const value = record(raw)?.['value'];
    const dictionary = record(value);
    if (dictionary === null) return [inspectValue(name, value)];
    return Object.entries(dictionary).map(([key, inner]) => inspectValue(`${name}/${key}`, inner));
  });
}

function inspectPrompt(input: unknown): string | null {
  if (typeof input === 'string') return text(input);
  if (!Array.isArray(input)) return null;
  return canonicalJson(turnsOf(input));
}

function inspectAttempt(sample: Json): RawAttempt {
  const id = idText(sample['id']);
  const caseId =
    id === null
      ? sha256(canonicalJson({ input: sample['input'] ?? null, target: sample['target'] ?? null }))
      : boundedId(id);
  const scores = inspectScores(sample);
  const error = text(sample['error']) ?? text(record(sample['error'])?.['message']);
  const usage = Object.values(record(sample['model_usage']) ?? {}).map(record);
  const epoch = sample['epoch'];
  return {
    caseId,
    label: text(sample['description']) ?? id ?? caseId,
    promptText: inspectPrompt(sample['input']),
    attempt: {
      epoch: typeof epoch === 'number' && Number.isInteger(epoch) && epoch >= 1 ? epoch : null,
      passed: error === null ? verdictOf(scores) : null,
      error,
      scores,
      latencyMs: seconds(sample['total_time']),
      tokensInput: sum(usage.map((entry) => count(entry?.['input_tokens']))),
      tokensOutput: sum(usage.map((entry) => count(entry?.['output_tokens']))),
      costUsd: sum(usage.map((entry) => count(entry?.['total_cost']))),
    },
  };
}

/** `openai/gpt-4o` → provider `openai`, model `gpt-4o`. */
function inspectModel(id: string | null): { provider: string | null; model: string | null } {
  if (id === null) return { provider: null, model: null };
  const slash = id.indexOf('/');
  return slash < 0
    ? { provider: null, model: id }
    : { provider: id.slice(0, slash), model: id.slice(slash + 1) };
}

function parseInspect(document: Json): ParsedReport {
  const spec = record(document['eval']);
  if (spec === null) throw new HealthReportError('malformed', 'Inspect log has no eval spec');
  if (!Array.isArray(document['samples'])) {
    throw new HealthReportError(
      'malformed',
      'Inspect log has no samples; a header-only log cannot be read as a run',
    );
  }
  return {
    tool: { name: 'inspect-ai', version: text(record(spec['packages'])?.['inspect_ai']) },
    suite: text(spec['task']) ?? 'inspect',
    ...inspectModel(text(spec['model'])),
    attempts: records(document['samples']).map(inspectAttempt),
  };
}

// --- shared ----------------------------------------------------------------------------

function decode(format: EvalReportFormat, input: Uint8Array): Json {
  if (input.byteLength > MAX_HEALTH_REPORT_BYTES) {
    throw new HealthReportError(
      'too_large',
      `${format} report is larger than ${String(MAX_HEALTH_REPORT_BYTES)} bytes`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(input));
  } catch {
    throw new HealthReportError('malformed', `${format} report is not valid JSON`);
  }
  const document = record(parsed);
  if (document === null)
    throw new HealthReportError('malformed', `${format} report is not an object`);
  return document;
}

function newCase(raw: RawAttempt, storePrompts: boolean): EvalCase {
  return {
    caseId: raw.caseId,
    label: raw.label.slice(0, MAX_LABEL_CHARS),
    promptHash: raw.promptText === null ? null : sha256(raw.promptText),
    prompt:
      storePrompts && raw.promptText !== null ? raw.promptText.slice(0, MAX_PROMPT_CHARS) : null,
    attempts: [],
  };
}

function group(
  attempts: readonly RawAttempt[],
  storePrompts: boolean,
): { cases: EvalCase[]; truncated: boolean } {
  const cases = new Map<string, EvalCase>();
  let truncated = false;
  for (const raw of attempts) {
    let target = cases.get(raw.caseId);
    if (target === undefined) {
      if (cases.size >= MAX_EVAL_CASES) {
        truncated = true;
        continue;
      }
      target = newCase(raw, storePrompts);
      cases.set(raw.caseId, target);
    }
    target.attempts.push({
      ...raw.attempt,
      epoch: raw.attempt.epoch ?? target.attempts.length + 1,
    });
  }
  for (const row of cases.values()) row.attempts.sort((left, right) => left.epoch - right.epoch);
  return { cases: [...cases.values()], truncated };
}

function totalsOf(cases: readonly EvalCase[]): EvalTotals {
  const attempts = cases.flatMap((row) => row.attempts);
  const latencies = attempts
    .map((attempt) => attempt.latencyMs)
    .filter((value): value is number => value !== null);
  return {
    cases: cases.length,
    attempts: attempts.length,
    passed: attempts.filter((attempt) => attempt.passed === true).length,
    failed: attempts.filter((attempt) => attempt.passed === false).length,
    errors: attempts.filter((attempt) => attempt.error !== null).length,
    tokensInput: sum(attempts.map((attempt) => attempt.tokensInput)),
    tokensOutput: sum(attempts.map((attempt) => attempt.tokensOutput)),
    costUsd: sum(attempts.map((attempt) => attempt.costUsd)),
    meanLatencyMs:
      latencies.length === 0
        ? null
        : latencies.reduce((total, value) => total + value, 0) / latencies.length,
  };
}

/**
 * Parse one eval tool's report.
 *
 * Refused with `HealthReportError`: larger than `MAX_HEALTH_REPORT_BYTES` (`too_large`), not
 * a JSON object, or with nowhere for cases to be (`malformed`). More than `MAX_EVAL_CASES`
 * cases is not refused — eval suites legitimately grow large — but the rest are dropped and
 * `truncated` says so; totals describe the cases kept.
 */
export function parseEvalReport(
  format: EvalReportFormat,
  input: Uint8Array,
  options: EvalReportOptions = {},
): EvalRun {
  const document = decode(format, input);
  let parsed: ParsedReport;
  switch (format) {
    case 'promptfoo-json':
      parsed = parsePromptfoo(document);
      break;
    case 'deepeval-json':
      parsed = parseDeepEval(document);
      break;
    case 'inspect-eval-json':
      parsed = parseInspect(document);
      break;
  }
  const { cases, truncated } = group(parsed.attempts, options.storePrompts === true);
  const prompts = [
    ...new Set(cases.map((row) => row.promptHash).filter((hash): hash is string => hash !== null)),
  ].sort();
  return {
    tool: { name: parsed.tool.name, version: parsed.tool.version?.slice(0, 100) ?? null },
    suite: parsed.suite.slice(0, MAX_LABEL_CHARS),
    model: parsed.model,
    provider: parsed.provider,
    configHash: sha256(canonicalJson({ suite: parsed.suite, model: parsed.model, prompts })),
    cases,
    totals: totalsOf(cases),
    truncated,
  };
}

/**
 * The run as agent-quality metrics on 0–100.
 *
 * `eval-pass-rate` is passed over decided attempts — errors and undecided attempts are left
 * out of both sides, and the summary says how many errored. Each named metric is reported
 * as its mean × 100 only when every score it has lies in [0, 1]: a metric on another scale
 * (a token count, a BLEU score ×100) has no honest mapping onto 0–100, so it is left out
 * rather than clamped.
 */
export function evalMetrics(run: EvalRun): DimensionMetric[] {
  const attempts = run.cases.flatMap((row) => row.attempts);
  return [...passRateMetric(run, attempts), ...namedScoreMetrics(run, attempts)];
}

type EvalAttemptRow = EvalCase['attempts'][number];

/** `eval-pass-rate` over decided attempts, or nothing when no attempt was decided. */
function passRateMetric(run: EvalRun, attempts: readonly EvalAttemptRow[]): DimensionMetric[] {
  const decided = attempts.filter((attempt) => attempt.passed !== null);
  if (decided.length === 0) return [];
  const passed = decided.filter((attempt) => attempt.passed === true).length;
  const errored = run.totals.errors > 0 ? ` (${String(run.totals.errors)} errored)` : '';
  return [
    {
      dimension: 'agent-quality',
      metric: 'eval-pass-rate',
      tool: run.tool,
      score: (passed / decided.length) * 100,
      summary:
        `${String(passed)} of ${String(decided.length)} decided eval attempts passed in ${run.suite}${errored}.`.slice(
          0,
          500,
        ),
    },
  ];
}

/** Every non-null score, grouped by metric name. */
function scoresByMetric(attempts: readonly EvalAttemptRow[]): Map<string, number[]> {
  const byMetric = new Map<string, number[]>();
  for (const attempt of attempts) {
    for (const entry of attempt.scores) {
      if (entry.score === null) continue;
      const values = byMetric.get(entry.metric);
      if (values === undefined) byMetric.set(entry.metric, [entry.score]);
      else values.push(entry.score);
    }
  }
  return byMetric;
}

/** One metric per named score whose every value lies in [0, 1], in name order. */
function namedScoreMetrics(run: EvalRun, attempts: readonly EvalAttemptRow[]): DimensionMetric[] {
  const named = [...scoresByMetric(attempts)].sort(([left], [right]) => (left < right ? -1 : 1));
  const metrics: DimensionMetric[] = [];
  for (const [metric, values] of named) {
    if (!values.every((value) => value >= 0 && value <= 1)) continue;
    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    metrics.push({
      dimension: 'agent-quality',
      metric: `eval-score ${metric}`.slice(0, 100),
      tool: run.tool,
      score: mean * 100,
      summary:
        `Mean ${metric} ${mean.toFixed(3)} over ${String(values.length)} scored attempts in ${run.suite}.`.slice(
          0,
          500,
        ),
    });
  }
  return metrics;
}
