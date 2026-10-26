import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { and, asc, eq } from 'drizzle-orm';
import { evalDatasets, type EvalDatasetRow } from '@automate/db';
import type { AiGateway, CompletionInput } from '@automate/automation';
import {
  EvalDatasetCaseSchema,
  type AutomateEvalRun,
  type EvalAttemptRecord,
  type EvalCaseRecord,
  type EvalCheck,
  type EvalDataset,
  type EvalDatasetBody,
  type EvalDatasetCase,
  type EvalDatasetRunStarted,
  type HealthUploadResult,
} from '@automate/shared-contracts';
import { z } from 'zod/v4';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { branchFor, projectRow } from './health-findings.js';
import type { EvalOptions } from './eval-service.js';
import type { UploadInput } from './repo-health-service.js';

/**
 * The built-in eval runner: a project's datasets, run through the configured AI gateway, and
 * stored as eval runs **through the same door as an upload**.
 *
 * ## Where it runs
 *
 * In the API, beside chat — not as a runner job. The runner's job modes spawn a command in a
 * checkout and upload what it wrote; an eval run needs neither a checkout nor a binary, and
 * it needs the model credential, which only the API holds (`KILO_API_KEY`, `OLLAMA_BASE_URL`).
 * Sending that credential to a runner would put it in a second place for no gain. A run is
 * started by the route and executes in the background, because N cases × R repeats of model
 * calls outlives the request deadline; its result appears as an eval run.
 *
 * ## One writer
 *
 * The finished run is written as an `automate-eval-json` document and handed to
 * `ingestHealthReport`, so it is stored by `storeEvalRun`, graded through `evalMetrics`, and
 * compared by `compareEvalRuns` exactly as an uploaded promptfoo run is.
 *
 * ## Checks are deterministic; a judge is opt-in
 *
 * `contains`, `regex` and `json` (required keys and their JSON types) decide each attempt. A
 * regex is refused when it could backtrack catastrophically — nested or alternated
 * quantified groups, back-references — and every match runs on at most
 * {@link MAX_CHECKED_OUTPUT_CHARS} characters under a {@link REGEX_TIMEOUT_MS} timeout as the
 * backstop. An LLM judge runs only when the dataset configures one; it is off by default.
 *
 * ## No gateway, no run
 *
 * With no model provider configured the run is refused with `NOT_CONFIGURED` before anything
 * is stored: a run that could not ask a model must never look like a pass.
 */
export interface EvalRunnerOptions extends EvalOptions {
  /** The configured gateway, or `null` when no model provider is configured. */
  gateway: AiGateway | null;
  /** The gateway's provider name for the stored run (`kilo`, `ollama`). */
  provider: string | null;
  /** The health upload door, with its hooks. */
  ingest: (input: UploadInput) => Promise<HealthUploadResult>;
  /** How long one completion may take. */
  completionTimeoutMs?: number;
}

export const EVAL_RUNNER_TOOL = { name: 'automate-eval-runner', version: '1' } as const;
/** Cases × repeats of one dataset. A run past this would outspend any reasonable budget. */
export const MAX_RUN_ATTEMPTS = 1000;
export const MAX_CHECKED_OUTPUT_CHARS = 20_000;
export const REGEX_TIMEOUT_MS = 250;
const DEFAULT_COMPLETION_TIMEOUT_MS = 60_000;
const MAX_DATASETS = 200;

// ─── Datasets ────────────────────────────────────────────────────────────────

/**
 * Why a regex could backtrack catastrophically, or `null` when it is safe to run.
 *
 * A quantified group that itself contains a quantifier or an alternation is the classic
 * exponential shape (`(a+)+`, `(a|aa)*`); a back-reference makes matching NP-hard in general.
 * Conservative by design: a refused pattern can be rewritten, a hung check cannot.
 */
export function unsafeRegexReason(pattern: string): string | null {
  if (/\\(?:[1-9]|k<)/u.test(pattern)) return 'back-references are not allowed';
  const tokens = regexTokens(pattern);
  const outer: boolean[] = [];
  let risky = false;
  for (const [index, token] of tokens.entries()) {
    if (token === 'open') {
      outer.push(risky);
      risky = false;
    } else if (token === 'close') {
      const inner: boolean = risky;
      if (inner && tokens[index + 1] === 'repeat') {
        return 'a repeated group may not contain a quantifier or an alternation';
      }
      risky = (outer.pop() ?? false) || inner;
    } else if (token !== 'atom') {
      risky = true;
    }
  }
  return null;
}

type RegexToken = 'open' | 'close' | 'alt' | 'repeat' | 'optional' | 'atom';

function regexTokens(pattern: string): RegexToken[] {
  const tokens: RegexToken[] = [];
  let index = 0;
  while (index < pattern.length) {
    const [token, next] = regexTokenAt(pattern, index);
    tokens.push(token);
    index = next;
  }
  return tokens;
}

/** The token at `index` and where the next one starts. */
function regexTokenAt(pattern: string, index: number): [RegexToken, number] {
  const char = pattern[index];
  if (char === '\\') return ['atom', index + 2];
  if (char === '[') return ['atom', classEnd(pattern, index) + 1];
  if (char === '(') return ['open', index + 1 + groupPrefixLength(pattern, index + 1)];
  if (char === ')') return ['close', index + 1];
  if (char === '|') return ['alt', index + 1];
  if (char === '?') return ['optional', index + 1];
  if (char === '*' || char === '+') return ['repeat', index + 1];
  const close = pattern.indexOf('}', index);
  if (char === '{' && close > index && /^\{\d+,?\d*\}$/u.test(pattern.slice(index, close + 1))) {
    return ['repeat', close + 1];
  }
  return ['atom', index + 1];
}

/** `?:`, `?=`, `?!`, `?<=`, `?<!` or `?<name>` after an opening parenthesis. */
function groupPrefixLength(pattern: string, index: number): number {
  if (pattern[index] !== '?') return 0;
  if (pattern[index + 1] !== '<' || '=!'.includes(pattern[index + 2] ?? '')) {
    return pattern[index + 1] === '<' ? 3 : 2;
  }
  const close = pattern.indexOf('>', index);
  return close < 0 ? 2 : close - index + 1;
}

function classEnd(pattern: string, start: number): number {
  let index = start + 1;
  while (index < pattern.length && pattern[index] !== ']') {
    index += pattern[index] === '\\' ? 2 : 1;
  }
  return index;
}

/** A regex test on bounded input under a timeout. `null` when the match timed out or failed. */
export function regexMatches(
  pattern: string,
  flags: string,
  text: string,
  timeoutMs = REGEX_TIMEOUT_MS,
): boolean | null {
  const context = createContext({ pattern, flags, text: text.slice(0, MAX_CHECKED_OUTPUT_CHARS) });
  try {
    return runInContext('new RegExp(pattern, flags).test(text)', context, {
      timeout: timeoutMs,
    }) as boolean;
  } catch {
    return null;
  }
}

function checkDatasetCases(cases: readonly EvalDatasetCase[], repeats: number): void {
  if (cases.length * repeats > MAX_RUN_ATTEMPTS) {
    throw new DomainError(
      ErrorCode.INVALID_REQUEST,
      `A dataset runs at most ${String(MAX_RUN_ATTEMPTS)} attempts (cases × repeats)`,
    );
  }
  const ids = new Set<string>();
  for (const row of cases) {
    if (ids.has(row.id))
      throw new DomainError(ErrorCode.INVALID_REQUEST, `Duplicate case id ${row.id}`);
    ids.add(row.id);
    for (const check of row.checks) {
      const reason = check.type === 'regex' ? unsafeRegexReason(check.pattern) : null;
      if (reason !== null) {
        throw new DomainError(ErrorCode.INVALID_REQUEST, `Case ${row.id}: unsafe regex, ${reason}`);
      }
    }
  }
}

const CasesSchema = z.array(EvalDatasetCaseSchema);

function datasetOf(row: EvalDatasetRow): EvalDataset {
  const cases = CasesSchema.safeParse(row.cases);
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    model: row.model,
    repeats: row.repeats,
    judge: row.judge ?? null,
    cases: cases.success ? cases.data : [],
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Creates a dataset, or replaces the project's dataset of the same name. */
export async function upsertEvalDataset(
  options: EvalOptions,
  projectId: string,
  body: EvalDatasetBody,
  actor: string,
): Promise<{ dataset: EvalDataset; created: boolean }> {
  const project = await projectRow(options, projectId);
  checkDatasetCases(body.cases, body.repeats);
  const now = options.now?.() ?? new Date();
  const values = {
    model: body.model,
    repeats: body.repeats,
    judge: body.judge ?? null,
    cases: body.cases,
    updatedBy: actor,
    updatedAt: now,
  };
  const existing = await datasetRow(options, project.id, { name: body.name });
  const [row] = await options.db
    .insert(evalDatasets)
    .values({ workspaceId: options.workspaceId, projectId: project.id, name: body.name, ...values })
    .onConflictDoUpdate({
      target: [evalDatasets.workspaceId, evalDatasets.projectId, evalDatasets.name],
      set: values,
    })
    .returning();
  return { dataset: datasetOf(row as EvalDatasetRow), created: existing === undefined };
}

async function datasetRow(
  options: EvalOptions,
  projectId: string,
  by: { id: string } | { name: string },
): Promise<EvalDatasetRow | undefined> {
  const [row] = await options.db
    .select()
    .from(evalDatasets)
    .where(
      and(
        eq(evalDatasets.workspaceId, options.workspaceId),
        eq(evalDatasets.projectId, projectId),
        'id' in by ? eq(evalDatasets.id, by.id) : eq(evalDatasets.name, by.name),
      ),
    )
    .limit(1);
  return row;
}

export async function listEvalDatasets(
  options: EvalOptions,
  projectId: string,
): Promise<{ projectId: string; datasets: EvalDataset[] }> {
  const project = await projectRow(options, projectId);
  const rows = await options.db
    .select()
    .from(evalDatasets)
    .where(
      and(
        eq(evalDatasets.workspaceId, options.workspaceId),
        eq(evalDatasets.projectId, project.id),
      ),
    )
    .orderBy(asc(evalDatasets.name))
    .limit(MAX_DATASETS);
  return { projectId: project.id, datasets: rows.map(datasetOf) };
}

// ─── Checks ──────────────────────────────────────────────────────────────────

const JSON_TYPES: Record<string, (value: unknown) => boolean> = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number',
  boolean: (value) => typeof value === 'boolean',
  object: (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  array: (value) => Array.isArray(value),
  null: (value) => value === null,
};

/** The output as a JSON object: the whole text, or the first fenced ```json block in it. */
function jsonObjectOf(output: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*\n([\s\S]{0,20000}?)\n```/u.exec(output);
  try {
    const parsed: unknown = JSON.parse((fenced?.[1] ?? output).trim());
    return JSON_TYPES['object']?.(parsed) === true ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Whether one check passes; `null` when it could not be decided (a regex that timed out). */
export function runCheck(check: EvalCheck, output: string): boolean | null {
  const text = output.slice(0, MAX_CHECKED_OUTPUT_CHARS);
  switch (check.type) {
    case 'contains':
      return check.caseSensitive === true
        ? text.includes(check.value)
        : text.toLowerCase().includes(check.value.toLowerCase());
    case 'regex':
      return unsafeRegexReason(check.pattern) === null
        ? regexMatches(check.pattern, check.flags ?? '', text)
        : null;
    case 'json': {
      const object = jsonObjectOf(text);
      if (object === null) return false;
      return check.required.every(
        (field) => field.key in object && JSON_TYPES[field.type]?.(object[field.key]) === true,
      );
    }
  }
}

// ─── Running ─────────────────────────────────────────────────────────────────

interface Completion {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

async function complete(
  gateway: AiGateway,
  input: Omit<CompletionInput, 'signal'>,
  timeoutMs: number,
): Promise<Completion> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('completion timed out')), timeoutMs);
  const started = Date.now();
  let text = '';
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  try {
    for await (const chunk of gateway.streamCompletion({ ...input, signal: controller.signal })) {
      if (chunk.type === 'text') text += chunk.text;
      if (chunk.type === 'usage') {
        inputTokens = chunk.usage.inputTokens ?? inputTokens;
        outputTokens = chunk.usage.outputTokens ?? outputTokens;
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { text, inputTokens, outputTokens, latencyMs: Date.now() - started };
}

const JUDGE_SYSTEM =
  'You grade an AI answer against a rubric. Reply with PASS or FAIL on the first line, then one sentence of reason.';

async function judged(
  gateway: AiGateway,
  judge: { model: string; rubric: string },
  row: EvalDatasetCase,
  output: string,
  timeoutMs: number,
): Promise<boolean> {
  const verdict = await complete(
    gateway,
    {
      model: judge.model,
      messages: [
        { role: 'system', content: JUDGE_SYSTEM },
        {
          role: 'user',
          content: `Rubric:\n${judge.rubric}\n\nInput:\n${row.input}\n\nAnswer:\n${output.slice(0, MAX_CHECKED_OUTPUT_CHARS)}`,
        },
      ],
    },
    timeoutMs,
  );
  return /^\W*PASS\b/iu.test(verdict.text);
}

interface AttemptContext {
  gateway: AiGateway;
  dataset: EvalDataset;
  timeoutMs: number;
}

function messagesOf(row: EvalDatasetCase): CompletionInput['messages'] {
  return [
    ...(row.system === undefined ? [] : [{ role: 'system' as const, content: row.system }]),
    { role: 'user' as const, content: row.input },
  ];
}

function checkScore(results: readonly (boolean | null)[]): {
  score: number;
  passed: boolean | null;
} {
  const passedCount = results.filter((result) => result === true).length;
  const undecided = results.some((result) => result === null);
  return {
    score: results.length === 0 ? 0 : passedCount / results.length,
    passed: undecided ? null : passedCount === results.length,
  };
}

async function attemptOf(
  context: AttemptContext,
  row: EvalDatasetCase,
  epoch: number,
): Promise<EvalAttemptRecord> {
  const base = { epoch, latencyMs: null, tokensInput: null, tokensOutput: null, costUsd: null };
  let answer: Completion;
  try {
    answer = await complete(
      context.gateway,
      { model: context.dataset.model, messages: messagesOf(row) },
      context.timeoutMs,
    );
  } catch (error) {
    return { ...base, passed: null, error: errorText(error), scores: [] };
  }
  const checks = checkScore(row.checks.map((check) => runCheck(check, answer.text)));
  const scores = [{ metric: 'checks', score: checks.score, threshold: 1, passed: checks.passed }];
  let passed = checks.passed;
  let error: string | null = null;
  const judge = context.dataset.judge;
  if (judge !== null && passed === true) {
    try {
      const verdict = await judged(context.gateway, judge, row, answer.text, context.timeoutMs);
      scores.push({ metric: 'judge', score: verdict ? 1 : 0, threshold: 1, passed: verdict });
      passed = verdict;
    } catch (cause) {
      passed = null;
      error = `judge: ${errorText(cause)}`;
    }
  }
  return {
    ...base,
    passed,
    error,
    scores,
    latencyMs: answer.latencyMs,
    tokensInput: answer.inputTokens,
    tokensOutput: answer.outputTokens,
  };
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : 'the provider call failed').slice(0, 500);
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function totalsOf(cases: readonly EvalCaseRecord[]): AutomateEvalRun['totals'] {
  const attempts = cases.flatMap((row) => row.attempts);
  const sum = (values: Array<number | null>) => {
    const known = values.filter((value): value is number => value !== null);
    return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
  };
  const latencies = attempts.map((attempt) => attempt.latencyMs).filter((value) => value !== null);
  return {
    cases: cases.length,
    attempts: attempts.length,
    passed: attempts.filter((attempt) => attempt.passed === true).length,
    failed: attempts.filter((attempt) => attempt.passed === false).length,
    errors: attempts.filter((attempt) => attempt.error !== null).length,
    tokensInput: sum(attempts.map((attempt) => attempt.tokensInput)),
    tokensOutput: sum(attempts.map((attempt) => attempt.tokensOutput)),
    costUsd: null,
    meanLatencyMs: latencies.length === 0 ? null : (sum(latencies) ?? 0) / latencies.length,
  };
}

/** Every case × repeat, sequentially, as one run in Automate's own eval shape. */
export async function executeDataset(
  gateway: AiGateway,
  dataset: EvalDataset,
  provider: string | null,
  timeoutMs = DEFAULT_COMPLETION_TIMEOUT_MS,
): Promise<AutomateEvalRun> {
  const context: AttemptContext = { gateway, dataset, timeoutMs };
  const cases: EvalCaseRecord[] = [];
  for (const row of dataset.cases) {
    const attempts: EvalAttemptRecord[] = [];
    for (let epoch = 1; epoch <= dataset.repeats; epoch += 1) {
      attempts.push(await attemptOf(context, row, epoch));
    }
    cases.push({
      caseId: row.id,
      label: row.id,
      promptHash: sha256(`${row.system ?? ''}\n${row.input}`),
      prompt: row.input,
      attempts,
    });
  }
  return {
    tool: EVAL_RUNNER_TOOL,
    suite: dataset.name,
    model: dataset.model,
    provider,
    configHash: sha256(
      JSON.stringify({
        name: dataset.name,
        model: dataset.model,
        repeats: dataset.repeats,
        judge: dataset.judge,
        cases: dataset.cases,
      }),
    ),
    cases,
    totals: totalsOf(cases),
    truncated: false,
  };
}

export interface PreparedRun {
  started: EvalDatasetRunStarted;
  /** Runs every attempt and stores the run through the upload door; releases the dataset. */
  execute: () => Promise<HealthUploadResult>;
  /** Frees the dataset without running it. Idempotent; `execute` does it on its own. */
  release: () => void;
}

/** Datasets with a run in flight on this process: one at a time each. */
const running = new Set<string>();

/**
 * Checks a run can start — a gateway is configured, the dataset is the project's, it is not
 * already running — claims the dataset, and returns it ready to execute. The claim is taken
 * in the same synchronous step as the check, so two requests cannot both pass it; a caller
 * that does not go on to `execute` must `release`. Refusals throw here, synchronously with
 * the request, so nothing is started that could not finish. The claim is per process: two
 * API processes can each run the same dataset once.
 */
export async function prepareDatasetRun(
  options: EvalRunnerOptions,
  projectId: string,
  datasetId: string,
  target: { branch?: string | undefined; commit?: string | undefined },
): Promise<PreparedRun> {
  const project = await projectRow(options, projectId);
  const gateway = options.gateway;
  if (gateway === null) {
    throw new DomainError(
      ErrorCode.NOT_CONFIGURED,
      'No model provider is configured, so no eval can run. Set KILO_GATEWAY_URL and KILO_API_KEY, or OLLAMA_BASE_URL.',
      { callerSafe: true },
    );
  }
  const row = /^[0-9a-f-]{36}$/iu.test(datasetId)
    ? await datasetRow(options, project.id, { id: datasetId })
    : undefined;
  if (row === undefined) throw new DomainError(ErrorCode.NOT_FOUND, `No eval dataset ${datasetId}`);
  if (running.has(row.id)) {
    throw new DomainError(ErrorCode.CONFLICT, 'This dataset is already running');
  }
  const dataset = datasetOf(row);
  const branch = branchFor(project, target.branch);
  // Claimed with no await since the check above, so no second request can slip between.
  running.add(row.id);
  const release = () => void running.delete(row.id);
  return {
    started: {
      datasetId: dataset.id,
      suite: dataset.name,
      branch,
      attempts: dataset.cases.length * dataset.repeats,
      status: 'started',
    },
    release,
    execute: async () => {
      try {
        const run = await executeDataset(
          gateway,
          dataset,
          options.provider,
          options.completionTimeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS,
        );
        return await options.ingest({
          projectId: project.id,
          format: 'automate-eval-json',
          bytes: new TextEncoder().encode(JSON.stringify(run)),
          branch,
          commitSha: target.commit,
          source: 'runner',
        });
      } finally {
        release();
      }
    },
  };
}
