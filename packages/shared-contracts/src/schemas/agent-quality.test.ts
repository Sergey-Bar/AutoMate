import { describe, expect, it } from 'vitest';
import {
  AgentConfigUploadBodySchema,
  AutomateEvalRunSchema,
  EvalCheckSchema,
  EvalDatasetBodySchema,
  EvalDatasetRunBodySchema,
  MAX_AGENT_CONFIG_FILES,
  MAX_EVAL_REGEX_CHARS,
  OtlpExportResponseSchema,
} from './agent-quality.js';

const run = {
  tool: { name: 'automate-eval-runner', version: '1' },
  suite: 'capitals',
  model: 'model-a',
  provider: 'ollama',
  configHash: 'abc',
  cases: [
    {
      caseId: 'paris',
      label: 'paris',
      promptHash: 'h',
      prompt: null,
      attempts: [
        {
          epoch: 1,
          passed: true,
          error: null,
          scores: [{ metric: 'checks', score: 1, threshold: 1, passed: true }],
          latencyMs: 10,
          tokensInput: 3,
          tokensOutput: 1,
          costUsd: null,
        },
      ],
    },
  ],
  totals: {
    cases: 1,
    attempts: 1,
    passed: 1,
    failed: 0,
    errors: 0,
    tokensInput: 3,
    tokensOutput: 1,
    costUsd: null,
    meanLatencyMs: 10,
  },
  truncated: false,
};

describe('the agent-quality contracts', () => {
  it('reads Automate’s own eval run shape, and refuses one with no suite', () => {
    expect(AutomateEvalRunSchema.safeParse(run).success).toBe(true);
    expect(AutomateEvalRunSchema.safeParse({ ...run, suite: '' }).success).toBe(false);
  });

  it('bounds dataset checks: a regex pattern length, its flags, and the three check types', () => {
    expect(EvalCheckSchema.safeParse({ type: 'contains', value: 'x' }).success).toBe(true);
    expect(EvalCheckSchema.safeParse({ type: 'regex', pattern: 'a', flags: 'iu' }).success).toBe(
      true,
    );
    expect(EvalCheckSchema.safeParse({ type: 'regex', pattern: 'a', flags: 'g' }).success).toBe(
      false,
    );
    expect(
      EvalCheckSchema.safeParse({ type: 'regex', pattern: 'a'.repeat(MAX_EVAL_REGEX_CHARS + 1) })
        .success,
    ).toBe(false);
    expect(
      EvalCheckSchema.safeParse({ type: 'json', required: [{ key: 'k', type: 'string' }] }).success,
    ).toBe(true);
    expect(EvalCheckSchema.safeParse({ type: 'similarity' }).success).toBe(false);
  });

  it('defaults a dataset to three repeats, with no judge, and refuses a name that is a path', () => {
    const body = {
      name: 'capitals',
      model: 'm',
      cases: [{ id: 'a', input: 'q', checks: [{ type: 'contains', value: 'x' }] }],
    };
    const parsed = EvalDatasetBodySchema.parse(body);
    expect(parsed.repeats).toBe(3);
    expect(parsed.judge).toBeUndefined();
    expect(EvalDatasetBodySchema.safeParse({ ...body, name: '../etc' }).success).toBe(false);
    expect(EvalDatasetBodySchema.safeParse({ ...body, repeats: 21 }).success).toBe(false);
    expect(EvalDatasetRunBodySchema.safeParse({}).success).toBe(true);
    expect(EvalDatasetRunBodySchema.safeParse({ commit: 'nothex' }).success).toBe(false);
  });

  it('bounds an agent-config upload by file count', () => {
    const file = { path: 'AGENTS.md', text: '# rules' };
    expect(AgentConfigUploadBodySchema.safeParse({ branch: 'main', files: [file] }).success).toBe(
      true,
    );
    expect(
      AgentConfigUploadBodySchema.safeParse({
        branch: 'main',
        files: Array.from({ length: MAX_AGENT_CONFIG_FILES + 1 }, () => file),
      }).success,
    ).toBe(false);
  });

  it('answers OTLP in the spec’s partialSuccess shape', () => {
    expect(
      OtlpExportResponseSchema.parse({ partialSuccess: { rejectedSpans: 0, errorMessage: '' } }),
    ).toEqual({ partialSuccess: { rejectedSpans: 0, errorMessage: '' } });
  });
});
