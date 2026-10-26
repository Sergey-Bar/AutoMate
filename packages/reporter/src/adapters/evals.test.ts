import { createHash } from 'node:crypto';
import { DimensionMetricSchema } from '@automate/shared-contracts';
import { describe, expect, it } from 'vitest';
import {
  EVAL_REPORT_FORMATS,
  MAX_EVAL_CASES,
  evalMetrics,
  parseEvalReport,
  type EvalReportFormat,
  type EvalRun,
} from './evals.js';
import { HealthReportError, MAX_HEALTH_REPORT_BYTES } from './sarif.js';

const bytes = (document: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(document));
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function errorCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HealthReportError ? error.code : 'not-a-health-error';
  }
}

/**
 * One three-case suite, written the way each tool writes it.
 *
 * `paris` runs twice (passes, then fails), `berlin` once (passes), `rome` once and errors.
 * Latency, tokens and cost are given the same values in every tool so the whole case list can
 * be compared, not only the parts that happen to line up.
 */
const QUESTIONS = {
  paris: 'What is the capital of France?',
  berlin: 'What is the capital of Germany?',
  rome: 'What is the capital of Italy?',
} as const;

const FAILURE_REASON: Readonly<Record<'pass' | 'fail' | 'error', number>> = {
  pass: 0,
  fail: 1,
  error: 2,
};

/** The fields promptfoo writes only for a graded (non-error) row, keyed by where they go. */
function promptfooGraded(passed: boolean) {
  const score = passed ? 1 : 0;
  return {
    response: { output: 'x', tokenUsage: { prompt: 10, completion: 2, total: 12 } },
    timing: { latencyMs: 250, cost: 0.001 },
    gradingResult: {
      pass: passed,
      score,
      reason: '',
      componentResults: [
        {
          pass: passed,
          score,
          reason: '',
          assertion: { type: 'equals', metric: 'match' },
        },
      ],
    },
    namedScores: { match: score },
  };
}

function promptfooRow(
  caseId: keyof typeof QUESTIONS,
  outcome: 'pass' | 'fail' | 'error',
  repeatIndex: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const passed = outcome === 'pass';
  const graded = outcome === 'error' ? null : promptfooGraded(passed);
  return {
    id: `row-${caseId}-${String(repeatIndex)}`,
    promptIdx: 0,
    testIdx: Object.keys(QUESTIONS).indexOf(caseId),
    testCase: {
      description: caseId,
      vars: { question: QUESTIONS[caseId] },
      metadata: { id: caseId },
    },
    promptId: 'prompt-hash',
    provider: { id: 'openai:gpt-4o', label: '' },
    prompt: { raw: QUESTIONS[caseId], label: 'capital' },
    vars: { question: QUESTIONS[caseId] },
    ...(graded === null ? {} : { response: graded.response }),
    error: graded === null ? 'rate limited' : null,
    failureReason: FAILURE_REASON[outcome],
    success: passed,
    score: passed ? 1 : 0,
    ...(graded === null ? {} : graded.timing),
    gradingResult: graded === null ? null : graded.gradingResult,
    namedScores: graded === null ? {} : graded.namedScores,
    repeatIndex,
    ...extra,
  };
}

const PROMPTFOO = {
  evalId: 'eval-2026-10-25',
  results: {
    version: 3,
    timestamp: '2026-10-25T10:00:00.000Z',
    prompts: [{ raw: '{{question}}', label: 'capital', provider: 'openai:gpt-4o' }],
    results: [
      promptfooRow('paris', 'pass', 0),
      promptfooRow('paris', 'fail', 1),
      promptfooRow('berlin', 'pass', 0),
      promptfooRow('rome', 'error', 0),
    ],
    stats: { successes: 2, failures: 1, errors: 1 },
  },
  config: { description: 'capitals' },
  shareableUrl: null,
  metadata: { promptfooVersion: '0.120.1', nodeVersion: 'v24.0.0' },
};

function inspectSample(
  caseId: keyof typeof QUESTIONS,
  outcome: 'pass' | 'fail' | 'error',
  epoch: number,
): Record<string, unknown> {
  const graded = outcome !== 'error';
  return {
    id: caseId,
    epoch,
    input: QUESTIONS[caseId],
    target: 'x',
    description: caseId,
    scores: graded ? { match: { value: outcome === 'pass' ? 'C' : 'I', answer: 'x' } } : {},
    model_usage: graded
      ? {
          'openai/gpt-4o': {
            input_tokens: 10,
            output_tokens: 2,
            total_tokens: 12,
            total_cost: 0.001,
          },
        }
      : {},
    ...(graded ? { total_time: 0.25 } : {}),
    ...(graded ? {} : { error: { message: 'rate limited', traceback: '' } }),
  };
}

const INSPECT = {
  version: 2,
  status: 'success',
  eval: {
    task: 'capitals',
    model: 'openai/gpt-4o',
    packages: { inspect_ai: '0.3.140' },
    config: { epochs: 2 },
  },
  results: {
    total_samples: 4,
    scores: [{ name: 'match', metrics: { accuracy: { name: 'accuracy', value: 0.66 } } }],
  },
  samples: [
    inspectSample('paris', 'pass', 1),
    inspectSample('paris', 'fail', 2),
    inspectSample('berlin', 'pass', 1),
    inspectSample('rome', 'error', 1),
  ],
};

describe('one suite, two tools, one canonical run', () => {
  const promptfoo = parseEvalReport('promptfoo-json', bytes(PROMPTFOO));
  const inspect = parseEvalReport('inspect-eval-json', bytes(INSPECT));

  it('normalises promptfoo and Inspect to equal cases', () => {
    // Tool-specific fields, by design not compared: `tool`. Everything else is equal here
    // because both tools were told the same thing. Where tools differ in general — a label
    // drawn from a different field, or a hashed id when a tool gives none — the fixture
    // gives both tools the same declared id and description.
    expect(promptfoo.cases).toEqual(inspect.cases);
    expect(promptfoo.cases.map((row) => row.caseId)).toEqual(['paris', 'berlin', 'rome']);
    expect(promptfoo.totals).toEqual(inspect.totals);
    expect(promptfoo.configHash).toBe(inspect.configHash);
    expect({
      suite: promptfoo.suite,
      model: promptfoo.model,
      provider: promptfoo.provider,
    }).toEqual({
      suite: 'capitals',
      model: 'gpt-4o',
      provider: 'openai',
    });
    expect({ suite: inspect.suite, model: inspect.model, provider: inspect.provider }).toEqual({
      suite: 'capitals',
      model: 'gpt-4o',
      provider: 'openai',
    });
    expect(promptfoo.tool).toEqual({ name: 'promptfoo', version: '0.120.1' });
    expect(inspect.tool).toEqual({ name: 'inspect-ai', version: '0.3.140' });
  });

  it('keeps repeats and epochs as attempts of one case', () => {
    const paris = promptfoo.cases[0];
    expect(paris?.attempts.map((attempt) => [attempt.epoch, attempt.passed])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(paris?.attempts[0]).toEqual({
      epoch: 1,
      passed: true,
      error: null,
      scores: [{ metric: 'match', score: 1, threshold: null, passed: true }],
      latencyMs: 250,
      tokensInput: 10,
      tokensOutput: 2,
      costUsd: 0.001,
    });
    expect(promptfoo.cases[2]?.attempts).toEqual([
      {
        epoch: 1,
        passed: null,
        error: 'rate limited',
        scores: [],
        latencyMs: null,
        tokensInput: null,
        tokensOutput: null,
        costUsd: null,
      },
    ]);
    expect(promptfoo.totals).toEqual({
      cases: 3,
      attempts: 4,
      passed: 2,
      failed: 1,
      errors: 1,
      tokensInput: 30,
      tokensOutput: 6,
      costUsd: 0.003,
      meanLatencyMs: 250,
    });
    expect(promptfoo.truncated).toBe(false);
  });

  it('hashes prompts and stores none of them unless asked', () => {
    expect(promptfoo.cases[0]?.promptHash).toBe(sha256(QUESTIONS.paris));
    expect(promptfoo.cases.every((row) => row.prompt === null)).toBe(true);
    expect(inspect.cases.every((row) => row.prompt === null)).toBe(true);
    const stored = parseEvalReport('promptfoo-json', bytes(PROMPTFOO), { storePrompts: true });
    expect(stored.cases.map((row) => row.prompt)).toEqual(Object.values(QUESTIONS));
    const storedInspect = parseEvalReport('inspect-eval-json', bytes(INSPECT), {
      storePrompts: true,
    });
    expect(storedInspect.cases).toEqual(stored.cases);
    // Storing prompts changes what is kept, never the identity of the configuration.
    expect(stored.configHash).toBe(promptfoo.configHash);
  });

  it('changes the config hash when the model, the suite or a prompt changes', () => {
    const other = parseEvalReport(
      'inspect-eval-json',
      bytes({ ...INSPECT, eval: { ...INSPECT.eval, model: 'openai/gpt-5' } }),
    );
    expect(other.configHash).not.toBe(inspect.configHash);
    const renamed = parseEvalReport(
      'inspect-eval-json',
      bytes({ ...INSPECT, eval: { ...INSPECT.eval, task: 'cities' } }),
    );
    expect(renamed.configHash).not.toBe(inspect.configHash);
    const reworded = parseEvalReport(
      'inspect-eval-json',
      bytes({
        ...INSPECT,
        samples: [{ ...inspectSample('paris', 'pass', 1), input: 'Capital of France?' }],
      }),
    );
    expect(reworded.configHash).not.toBe(inspect.configHash);
  });
});

describe('refusals', () => {
  it.each(EVAL_REPORT_FORMATS)(
    'refuses %s that is too large, not JSON, or not an object',
    (format) => {
      expect(
        errorCode(() => parseEvalReport(format, new Uint8Array(MAX_HEALTH_REPORT_BYTES + 1))),
      ).toBe('too_large');
      expect(errorCode(() => parseEvalReport(format, new TextEncoder().encode('{')))).toBe(
        'malformed',
      );
      expect(errorCode(() => parseEvalReport(format, bytes([1, 2])))).toBe('malformed');
    },
  );

  it('refuses a document with nowhere for the cases to be', () => {
    expect(errorCode(() => parseEvalReport('promptfoo-json', bytes({ results: {} })))).toBe(
      'malformed',
    );
    expect(errorCode(() => parseEvalReport('promptfoo-json', bytes({ evalId: 'x' })))).toBe(
      'malformed',
    );
    expect(errorCode(() => parseEvalReport('deepeval-json', bytes({ testFile: 'x' })))).toBe(
      'malformed',
    );
    expect(errorCode(() => parseEvalReport('inspect-eval-json', bytes({ samples: [] })))).toBe(
      'malformed',
    );
    // A header-only Inspect log has no samples: zero cases would read as an empty suite.
    expect(
      errorCode(() => parseEvalReport('inspect-eval-json', bytes({ eval: { task: 't' } }))),
    ).toBe('malformed');
  });

  it('accepts empty case lists as a suite that ran nothing', () => {
    const run = parseEvalReport('deepeval-json', bytes({ testCases: [] }));
    expect(run.cases).toEqual([]);
    expect(run.totals).toEqual({
      cases: 0,
      attempts: 0,
      passed: 0,
      failed: 0,
      errors: 0,
      tokensInput: null,
      tokensOutput: null,
      costUsd: null,
      meanLatencyMs: null,
    });
    expect(evalMetrics(run)).toEqual([]);
  });
});

describe('truncation', () => {
  it(`keeps the first ${String(MAX_EVAL_CASES)} cases, and still adds attempts to those`, () => {
    const testCases = Array.from({ length: MAX_EVAL_CASES + 2 }, (_, index) => ({
      name: `case ${String(index)}`,
      input: `input ${String(index)}`,
      success: true,
    }));
    testCases.push({ name: 'again', input: 'input 0', success: false });
    const run = parseEvalReport('deepeval-json', bytes({ testCases }));
    expect(run.truncated).toBe(true);
    expect(run.cases).toHaveLength(MAX_EVAL_CASES);
    expect(run.cases[0]?.attempts.map((attempt) => [attempt.epoch, attempt.passed])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(run.totals.attempts).toBe(MAX_EVAL_CASES + 1);
  });
});

describe('promptfoo', () => {
  const run = (results: unknown[], extra: Record<string, unknown> = {}) =>
    parseEvalReport('promptfoo-json', bytes({ results: { version: 3, results }, ...extra }));

  it('hashes the inputs when a test declares no id, so the row uuid never becomes the identity', () => {
    const withoutId = (seed: string) => ({
      ...promptfooRow('paris', 'pass', 0),
      id: seed,
      testCase: { description: 'paris', vars: { question: QUESTIONS.paris } },
    });
    const first = run([withoutId('uuid-1')]);
    const second = run([withoutId('uuid-2')]);
    expect(first.cases[0]?.caseId).toBe(second.cases[0]?.caseId);
    expect(first.cases[0]?.caseId).toMatch(/^[0-9a-f]{64}$/u);
    const changed = run([{ ...withoutId('uuid-1'), testCase: { vars: { question: 'other' } } }]);
    expect(changed.cases[0]?.caseId).not.toBe(first.cases[0]?.caseId);
    // A test with no description is labelled by its identity.
    expect(changed.cases[0]?.label).toBe(changed.cases[0]?.caseId);
    expect(first.suite).toBe('promptfoo');
    expect(first.tool.version).toBeNull();
  });

  it('accepts a numeric declared id, and hashes one longer than an id should be', () => {
    const numbered = run([
      { ...promptfooRow('paris', 'pass', 0), testCase: { metadata: { id: 7 } } },
    ]);
    expect(numbered.cases[0]?.caseId).toBe('7');
    const long = 'x'.repeat(400);
    const hashed = run([
      { ...promptfooRow('paris', 'pass', 0), testCase: { metadata: { id: long } } },
    ]);
    expect(hashed.cases[0]?.caseId).toBe(sha256(long));
  });

  it('separates the same test run against two providers or two prompts', () => {
    const second = promptfooRow('paris', 'fail', 0, {
      provider: { id: 'anthropic:messages:claude-sonnet-4' },
      prompt: { raw: 'Answer: {{question}}', label: 'terse' },
    });
    const result = run([promptfooRow('paris', 'pass', 0), second]);
    expect(result.cases.map((row) => row.caseId)).toEqual([
      'paris @ openai:gpt-4o # capital',
      'paris @ anthropic:messages:claude-sonnet-4 # terse',
    ]);
    expect(result.cases[1]?.label).toBe('paris @ anthropic:messages:claude-sonnet-4 # terse');
    expect(result.model).toBeNull();
    expect(result.provider).toBeNull();
  });

  it('reads a provider written as a string, strips the API style from the model, and keys prompts by id', () => {
    const result = run([
      {
        ...promptfooRow('paris', 'pass', 0),
        provider: 'openai:chat:gpt-4o-mini',
        prompt: { raw: 'p' },
        promptId: 'abc',
      },
      {
        ...promptfooRow('berlin', 'pass', 0),
        provider: 'openai:chat:gpt-4o-mini',
        prompt: {},
        promptId: undefined,
        promptIdx: 1,
      },
    ]);
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.provider).toBe('openai');
    expect(result.cases.map((row) => row.caseId)).toEqual(['paris # abc', 'berlin # 1']);
    expect(result.cases[1]?.promptHash).toBeNull();
  });

  it('names a provider with no prefix as a model, and an absent provider as no model', () => {
    expect(run([{ ...promptfooRow('paris', 'pass', 0), provider: { id: 'echo' } }]).model).toBe(
      'echo',
    );
    const unknown = run([{ ...promptfooRow('paris', 'pass', 0), provider: undefined }]);
    expect(unknown.model).toBeNull();
    expect(unknown.provider).toBeNull();
  });

  it('falls back to named scores, then to the grading result, and reads thresholds', () => {
    const named = run([
      {
        ...promptfooRow('paris', 'pass', 0),
        gradingResult: { pass: true, score: 0.8 },
        namedScores: { relevance: 0.8, broken: 'x' },
      },
    ]);
    expect(named.cases[0]?.attempts[0]?.scores).toEqual([
      { metric: 'relevance', score: 0.8, threshold: null, passed: null },
    ]);
    const graded = run([
      {
        ...promptfooRow('paris', 'pass', 0),
        gradingResult: { pass: false, score: 0.4 },
        namedScores: undefined,
        testCase: { metadata: { id: 'paris' }, threshold: 0.5 },
      },
    ]);
    expect(graded.cases[0]?.attempts[0]?.scores).toEqual([
      { metric: 'score', score: 0.4, threshold: 0.5, passed: false },
    ]);
    const components = run([
      {
        ...promptfooRow('paris', 'pass', 0),
        gradingResult: {
          componentResults: [
            { pass: true, score: 0.9, assertion: { type: 'llm-rubric', threshold: 0.7 } },
            { pass: 'yes', assertion: {} },
            'not a result',
          ],
        },
      },
    ]);
    expect(components.cases[0]?.attempts[0]?.scores).toEqual([
      { metric: 'llm-rubric', score: 0.9, threshold: 0.7, passed: true },
      { metric: 'assertion', score: null, threshold: null, passed: null },
    ]);
    const none = run([
      { ...promptfooRow('paris', 'pass', 0), gradingResult: null, namedScores: {} },
    ]);
    expect(none.cases[0]?.attempts[0]?.scores).toEqual([]);
  });

  it('reads an error from older exports that have no failureReason, but not an assertion reason', () => {
    const legacyError = run([
      { ...promptfooRow('paris', 'error', 0), failureReason: undefined, success: false },
    ]);
    expect(legacyError.cases[0]?.attempts[0]?.error).toBe('rate limited');
    const legacyAssertion = run([
      { ...promptfooRow('paris', 'fail', 0), failureReason: undefined, error: 'Expected Paris' },
    ]);
    expect(legacyAssertion.cases[0]?.attempts[0]).toMatchObject({ error: null, passed: false });
    const bareError = run([{ ...promptfooRow('paris', 'error', 0), error: undefined }]);
    expect(bareError.cases[0]?.attempts[0]?.error).toBe('error');
    const noVerdict = run([{ ...promptfooRow('paris', 'pass', 0), success: undefined }]);
    expect(noVerdict.cases[0]?.attempts[0]?.passed).toBeNull();
  });

  it('reads row-level token usage and response cost, and ignores negative or absent numbers', () => {
    const result = run([
      {
        ...promptfooRow('paris', 'pass', 0),
        response: { cost: 0.5 },
        cost: undefined,
        tokenUsage: { prompt: 3, completion: -1 },
        latencyMs: -5,
        repeatIndex: undefined,
      },
      { ...promptfooRow('paris', 'pass', 0), repeatIndex: 'x' },
    ]);
    expect(result.cases[0]?.attempts[0]).toMatchObject({
      epoch: 1,
      tokensInput: 3,
      tokensOutput: null,
      costUsd: 0.5,
      latencyMs: null,
    });
    expect(result.cases[0]?.attempts[1]?.epoch).toBe(2);
  });

  it('reads a bare summary as well as an output file, and skips rows that are not objects', () => {
    const result = parseEvalReport(
      'promptfoo-json',
      bytes({ version: 2, results: [promptfooRow('paris', 'pass', 0), 4] }),
    );
    expect(result.cases).toHaveLength(1);
  });

  it('caps a long label and a long metric name', () => {
    const result = run([
      {
        ...promptfooRow('paris', 'pass', 0),
        testCase: { description: 'd'.repeat(900), metadata: { id: 'paris' } },
        namedScores: { ['m'.repeat(300)]: 1 },
        gradingResult: null,
      },
    ]);
    expect(result.cases[0]?.label).toHaveLength(300);
    expect(result.cases[0]?.attempts[0]?.scores[0]?.metric).toHaveLength(100);
  });
});

describe('DeepEval', () => {
  it('reads camelCase test cases with their metrics, model and identifier', () => {
    const run = parseEvalReport(
      'deepeval-json',
      bytes({
        identifier: 'support-bot',
        testFile: 'test_bot.py',
        hyperparameters: { model: 'gpt-4o', temperature: 0 },
        testCases: [
          {
            name: 'refund',
            input: 'Can I get a refund?',
            actualOutput: 'Yes, within 30 days.',
            expectedOutput: 'Refunds within 30 days.',
            success: true,
            metricsData: [
              { name: 'Answer Relevancy', score: 0.92, threshold: 0.7, success: true },
              { name: 'Faithfulness', score: 0.8, threshold: 0.7, success: true, reason: 'ok' },
            ],
            inputTokenCount: 12,
            outputTokenCount: 8,
            tokenCost: 0.0004,
            completionTime: 1.5,
          },
          {
            name: 'judge-failed',
            input: 'Hello?',
            success: false,
            metricsData: [
              {
                name: 'Answer Relevancy',
                score: null,
                threshold: 0.7,
                success: false,
                error: 'judge timed out',
              },
              'not a metric',
            ],
          },
        ],
      }),
    );
    expect(run.tool).toEqual({ name: 'deepeval', version: null });
    expect(run.suite).toBe('support-bot');
    expect(run.model).toBe('gpt-4o');
    expect(run.provider).toBeNull();
    expect(run.cases[0]).toEqual({
      caseId: sha256(
        JSON.stringify({
          context: null,
          expectedOutput: 'Refunds within 30 days.',
          input: 'Can I get a refund?',
          retrievalContext: null,
        }),
      ),
      label: 'refund',
      promptHash: sha256('Can I get a refund?'),
      prompt: null,
      attempts: [
        {
          epoch: 1,
          passed: true,
          error: null,
          scores: [
            { metric: 'Answer Relevancy', score: 0.92, threshold: 0.7, passed: true },
            { metric: 'Faithfulness', score: 0.8, threshold: 0.7, passed: true },
          ],
          latencyMs: 1500,
          tokensInput: 12,
          tokensOutput: 8,
          costUsd: 0.0004,
        },
      ],
    });
    expect(run.cases[1]?.attempts[0]).toMatchObject({
      passed: null,
      error: 'judge timed out',
      scores: [{ metric: 'Answer Relevancy', score: null, threshold: 0.7, passed: null }],
    });
  });

  it('reads snake_case fields, conversational cases, and falls back through suite names', () => {
    const run = parseEvalReport(
      'deepeval-json',
      bytes({
        test_file: 'test_chat.py',
        test_cases: [
          {
            input: 'Hi',
            success: true,
            metrics_data: [{ name: 'Toxicity', score: 0, threshold: 0.5, success: true }],
            input_token_count: 1,
            output_token_count: 2,
            token_cost: 0.1,
            completion_time: 0.5,
          },
        ],
        conversational_test_cases: [
          {
            name: 'onboarding',
            success: false,
            scenario: 'A new user asks for help',
            turns: [
              { role: 'user', content: 'Help', order: 0 },
              { role: 'assistant', content: 'Sure', order: 1 },
            ],
            metricsData: [
              { name: 'Knowledge Retention', score: 0.3, threshold: 0.5, success: false },
            ],
          },
          {
            success: true,
            turns: [{ role: 'user', content: 'Hello' }, 'not a turn'],
            metricsData: [],
          },
          { success: true },
        ],
      }),
      { storePrompts: true },
    );
    expect(run.suite).toBe('test_chat.py');
    expect(run.model).toBeNull();
    expect(run.cases).toHaveLength(4);
    expect(run.cases[0]?.attempts[0]).toMatchObject({
      tokensInput: 1,
      tokensOutput: 2,
      costUsd: 0.1,
      latencyMs: 500,
    });
    expect(run.cases[0]?.label).toBe(run.cases[0]?.caseId);
    expect(run.cases[0]?.prompt).toBe('Hi');
    expect(run.cases[1]?.label).toBe('onboarding');
    expect(run.cases[1]?.prompt).toBe('A new user asks for help');
    expect(run.cases[1]?.attempts[0]).toMatchObject({
      passed: false,
      latencyMs: null,
      tokensInput: null,
    });
    expect(run.cases[2]?.prompt).toBe(JSON.stringify([{ content: 'Hello', role: 'user' }]));
    expect(run.cases[3]?.prompt).toBeNull();
    expect(run.cases[3]?.promptHash).toBeNull();
  });

  it('names the suite by dataset, then by tool, and skips cases that are not objects', () => {
    expect(
      parseEvalReport('deepeval-json', bytes({ datasetAlias: 'golden', testCases: [] })).suite,
    ).toBe('golden');
    const bare = parseEvalReport('deepeval-json', bytes({ conversationalTestCases: [7] }));
    expect(bare.suite).toBe('deepeval');
    expect(bare.cases).toEqual([]);
  });
});

describe('Inspect', () => {
  const log = (
    samples: unknown[],
    spec: Record<string, unknown> = { task: 'gsm8k', model: 'mockllm/model' },
  ) => parseEvalReport('inspect-eval-json', bytes({ eval: spec, samples }));

  it('reads every documented score value', () => {
    const values: [unknown, number | null, boolean | null][] = [
      ['C', 1, true],
      ['I', 0, false],
      ['P', 0.5, false],
      ['N', 0, false],
      ['yes', 1, true],
      ['False', 0, false],
      [true, 1, true],
      [false, 0, false],
      [0.7, 0.7, null],
      ['0.25', 0.25, null],
      ['maybe', null, null],
      [['a'], null, null],
      [null, null, null],
    ];
    for (const [value, score, passed] of values) {
      const run = log([{ id: 1, epoch: 1, input: 'q', scores: { s: { value } } }]);
      expect(run.cases[0]?.attempts[0]?.scores).toEqual([
        { metric: 's', score, threshold: null, passed },
      ]);
    }
  });

  it('expands a dictionary score into one metric per key', () => {
    const run = log([
      {
        id: 'a',
        epoch: 1,
        input: 'q',
        scores: { judge: { value: { accuracy: 'C', style: 0.4 } } },
      },
    ]);
    expect(run.cases[0]?.attempts[0]?.scores).toEqual([
      { metric: 'judge/accuracy', score: 1, threshold: null, passed: true },
      { metric: 'judge/style', score: 0.4, threshold: null, passed: null },
    ]);
    // Only decided scores decide the attempt.
    expect(run.cases[0]?.attempts[0]?.passed).toBe(true);
  });

  it('fails an attempt when any decided score fails, and leaves it undecided with none', () => {
    const run = log([
      { id: 'a', epoch: 1, input: 'q', scores: { x: { value: 'C' }, y: { value: 'I' } } },
      { id: 'b', epoch: 1, input: 'q', scores: { x: { value: 0.3 } } },
      { id: 'c', epoch: 1, input: 'q', scores: { x: 'not a score' } },
    ]);
    expect(run.cases.map((row) => row.attempts[0]?.passed)).toEqual([false, null, null]);
    expect(run.cases[2]?.attempts[0]?.scores).toEqual([
      { metric: 'x', score: null, threshold: null, passed: null },
    ]);
  });

  it('reads the deprecated single score, an error string, chat input and a missing id', () => {
    const run = log(
      [
        {
          id: 3,
          epoch: 1,
          input: [{ role: 'user', content: 'Add 2 and 2', id: 'm1' }],
          score: { value: 'C' },
        },
        { epoch: 0, input: 'no id', target: '4', error: 'sandbox died', scores: null },
        { id: 'z', input: 'no epoch', scores: {} },
        'not a sample',
      ],
      { task: 'math', model: 'local-model' },
    );
    expect(run.provider).toBeNull();
    expect(run.model).toBe('local-model');
    expect(run.cases[0]).toMatchObject({
      caseId: '3',
      label: '3',
      promptHash: sha256(JSON.stringify([{ content: 'Add 2 and 2', role: 'user' }])),
    });
    expect(run.cases[0]?.attempts[0]?.scores).toEqual([
      { metric: 'score', score: 1, threshold: null, passed: true },
    ]);
    expect(run.cases[1]?.caseId).toBe(sha256(JSON.stringify({ input: 'no id', target: '4' })));
    expect(run.cases[1]?.attempts[0]).toMatchObject({
      epoch: 1,
      error: 'sandbox died',
      passed: null,
    });
    expect(run.cases[2]?.attempts[0]?.epoch).toBe(1);
  });

  it('sums usage across models, orders epochs, and tolerates a sparse spec', () => {
    const run = parseEvalReport(
      'inspect-eval-json',
      bytes({
        eval: {},
        samples: [
          {
            id: 'a',
            epoch: 2,
            input: 'q',
            scores: {},
            model_usage: {
              one: { input_tokens: 5, output_tokens: 1 },
              two: { input_tokens: 5, output_tokens: 'x' },
              three: 'not usage',
            },
          },
          { id: 'a', epoch: 1, input: 'q', scores: {}, input_tokens: 9 },
        ],
      }),
    );
    expect(run.suite).toBe('inspect');
    expect(run.model).toBeNull();
    expect(run.tool.version).toBeNull();
    expect(run.cases[0]?.attempts.map((attempt) => attempt.epoch)).toEqual([1, 2]);
    expect(run.cases[0]?.attempts[1]).toMatchObject({
      tokensInput: 10,
      tokensOutput: 1,
      costUsd: null,
    });
    expect(run.cases[0]?.attempts[0]).toMatchObject({ tokensInput: null, tokensOutput: null });
  });

  it('stores a chat prompt only when asked, and cuts a huge one', () => {
    const huge = 'q'.repeat(30_000);
    const run = log([{ id: 'a', epoch: 1, input: huge, scores: {} }], { task: 't', model: 'm/x' });
    expect(run.cases[0]?.prompt).toBeNull();
    const stored = parseEvalReport(
      'inspect-eval-json',
      bytes({ eval: { task: 't' }, samples: [{ id: 'a', epoch: 1, input: huge, scores: {} }] }),
      { storePrompts: true },
    );
    expect(stored.cases[0]?.prompt).toHaveLength(20_000);
    expect(stored.cases[0]?.promptHash).toBe(sha256(huge));
    const other = log([{ id: 'a', epoch: 1, input: 7, scores: {} }]);
    expect(other.cases[0]?.promptHash).toBeNull();
  });
});

describe('evalMetrics', () => {
  const run = parseEvalReport('promptfoo-json', bytes(PROMPTFOO));

  it('reports the decided pass rate and each metric in [0, 1], all valid DimensionMetrics', () => {
    const metrics = evalMetrics(run);
    for (const metric of metrics) DimensionMetricSchema.parse(metric);
    expect(metrics).toEqual([
      {
        dimension: 'agent-quality',
        metric: 'eval-pass-rate',
        tool: { name: 'promptfoo', version: '0.120.1' },
        score: (2 / 3) * 100,
        summary: '2 of 3 decided eval attempts passed in capitals (1 errored).',
      },
      {
        dimension: 'agent-quality',
        metric: 'eval-score match',
        tool: { name: 'promptfoo', version: '0.120.1' },
        score: (2 / 3) * 100,
        summary: 'Mean match 0.667 over 3 scored attempts in capitals.',
      },
    ]);
  });

  it('says nothing about errors when there were none', () => {
    const clean = parseEvalReport(
      'deepeval-json',
      bytes({ testCases: [{ name: 'a', input: 'q', success: true }] }),
    );
    expect(evalMetrics(clean)).toEqual([
      {
        dimension: 'agent-quality',
        metric: 'eval-pass-rate',
        tool: { name: 'deepeval', version: null },
        score: 100,
        summary: '1 of 1 decided eval attempts passed in deepeval.',
      },
    ]);
  });

  it('leaves out a metric scored outside [0, 1], and the pass rate when nothing was decided', () => {
    const scored: EvalRun = parseEvalReport(
      'inspect-eval-json',
      bytes({
        eval: { task: 't' },
        samples: [
          { id: 'a', epoch: 1, input: 'q', scores: { tokens: { value: 340 }, f1: { value: 0.5 } } },
          { id: 'b', epoch: 1, input: 'q', scores: { tokens: { value: 0.2 } } },
        ],
      }),
    );
    const metrics = evalMetrics(scored);
    expect(metrics.map((metric) => metric.metric)).toEqual(['eval-score f1']);
    expect(metrics[0]?.score).toBe(50);
  });
});

describe('fields a tool may leave out', () => {
  it('keys prompts, inputs, providers and turns that are missing', () => {
    const promptfoo = parseEvalReport(
      'promptfoo-json',
      bytes({
        results: {
          results: [
            { success: true, vars: { q: 1 }, provider: 'a:x', prompt: { label: 'one' } },
            { success: true, prompt: {} },
          ],
        },
      }),
    );
    expect(promptfoo.cases.map((row) => row.caseId)).toEqual([
      `${sha256(JSON.stringify({ description: null, vars: { q: 1 } }))} @ a:x # one`,
      `${sha256(JSON.stringify({ description: null, vars: null }))} @ unknown # 0`,
    ]);
    const deepeval = parseEvalReport(
      'deepeval-json',
      bytes({
        testCases: [{ success: true, metricsData: [{ score: 0.5 }, { name: 'Bias', score: 0.1 }] }],
        conversationalTestCases: [{ success: true, turns: [{}] }],
      }),
      { storePrompts: true },
    );
    expect(deepeval.cases[0]?.caseId).toBe(
      sha256(
        JSON.stringify({
          context: null,
          expectedOutput: null,
          input: null,
          retrievalContext: null,
        }),
      ),
    );
    expect(deepeval.cases[0]?.attempts[0]?.scores.map((entry) => entry.metric)).toEqual([
      'metric',
      'Bias',
    ]);
    expect(deepeval.cases[1]?.prompt).toBe(JSON.stringify([{ content: null, role: null }]));
    expect(evalMetrics(deepeval).map((metric) => metric.metric)).toEqual([
      'eval-pass-rate',
      'eval-score Bias',
      'eval-score metric',
    ]);
    const inspect = parseEvalReport(
      'inspect-eval-json',
      bytes({ eval: {}, samples: [{ scores: { s: { value: '  ' } } }] }),
    );
    expect(inspect.cases[0]?.caseId).toBe(sha256(JSON.stringify({ input: null, target: null })));
    expect(inspect.cases[0]?.attempts[0]?.scores[0]?.score).toBeNull();
  });

  it('leaves unscored entries out of the metric means', () => {
    const run = parseEvalReport(
      'deepeval-json',
      bytes({
        testCases: [
          {
            input: 'a',
            success: true,
            metricsData: [{ name: 'Bias', score: null, success: true }],
          },
          {
            input: 'b',
            success: true,
            metricsData: [
              { name: 'Bias', score: 0.2, success: true },
              { name: 'Toxicity', score: 0, success: true },
            ],
          },
        ],
      }),
    );
    expect(evalMetrics(run).slice(1)).toMatchObject([
      { metric: 'eval-score Bias', score: 20 },
      { metric: 'eval-score Toxicity', score: 0 },
    ]);
  });
});

describe('the format list', () => {
  it('names the three formats the adapter reads', () => {
    const formats: readonly EvalReportFormat[] = EVAL_REPORT_FORMATS;
    expect(formats).toEqual(['promptfoo-json', 'deepeval-json', 'inspect-eval-json']);
  });
});
