import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import type { CompletionInput } from '@automate/automation';
import { EvalDatasetBodySchema, type EvalDatasetBody } from '@automate/shared-contracts';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { agentProject, stubGateway } from '../test-support/agent-fixtures.js';
import {
  MAX_RUN_ATTEMPTS,
  executeDataset,
  listEvalDatasets,
  prepareDatasetRun,
  regexMatches,
  runCheck,
  unsafeRegexReason,
  upsertEvalDataset,
  type EvalRunnerOptions,
} from './eval-runner.js';
import { ingestHealthReport } from './repo-health-service.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-10-26T00:00:00.000Z');

const DATASET: EvalDatasetBody = EvalDatasetBodySchema.parse({
  name: 'capitals',
  model: 'model-a',
  repeats: 2,
  cases: [
    { id: 'france', input: 'Capital of France?', checks: [{ type: 'contains', value: 'paris' }] },
    {
      id: 'json',
      input: 'Answer as JSON',
      system: 'Be terse.',
      checks: [{ type: 'json', required: [{ key: 'city', type: 'string' }] }],
    },
    { id: 'regex', input: 'Year?', checks: [{ type: 'regex', pattern: '^\\d{4}$' }] },
  ],
});

function answer(input: CompletionInput): string | Error {
  const prompt = input.messages.at(-1)?.content ?? '';
  if (prompt.startsWith('Capital')) return 'It is Paris.';
  if (prompt.startsWith('Answer')) return '```json\n{"city": "Paris"}\n```';
  if (prompt.startsWith('Year')) return '1999';
  return new Error('unexpected prompt');
}

async function setup(gatewayOverride?: EvalRunnerOptions['gateway']) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const projectId = await agentProject(db);
  const base = { db: db as never, workspaceId: 'ws-1', now: () => NOW };
  const calls: CompletionInput[] = [];
  const options: EvalRunnerOptions = {
    ...base,
    gateway: gatewayOverride === undefined ? stubGateway(answer, calls) : gatewayOverride,
    provider: 'ollama',
    ingest: (input) => ingestHealthReport(base, input),
  };
  return { db, projectId, options, calls };
}

describe('regex safety', () => {
  it.each([
    ['(a+)+$', false],
    ['(a|aa)*', false],
    ['(x*y)*', false],
    ['(\\w+\\s?)+$', false],
    ['(a)\\1', false],
    ['(?<n>a)\\k<n>', false],
    ['^\\d{4}$', true],
    ['(?:ab)+', true],
    ['[a+]+', true],
    ['a+b*c?', true],
    ['(?<year>\\d{4})-(\\d{2})', true],
    ['(?<=x)y', true],
    ['(a+)?', true],
    ['(ab){2,3}', true],
  ])('%s is %s', (pattern, safe) => {
    expect(unsafeRegexReason(pattern) === null).toBe(safe);
  });

  it('times a runaway match out rather than hanging', () => {
    expect(regexMatches('(a+)+$', '', `${'a'.repeat(32)}!`, 50)).toBeNull();
    expect(regexMatches('^a+$', '', 'aaa')).toBe(true);
    expect(regexMatches('[', '', 'x')).toBeNull();
  });
});

describe('checks', () => {
  it('decides contains, regex and json', () => {
    expect(runCheck({ type: 'contains', value: 'PARIS' }, 'paris')).toBe(true);
    expect(runCheck({ type: 'contains', value: 'PARIS', caseSensitive: true }, 'paris')).toBe(
      false,
    );
    expect(runCheck({ type: 'regex', pattern: 'p.r', flags: 'i' }, 'PAR')).toBe(true);
    expect(runCheck({ type: 'regex', pattern: '(a+)+' }, 'aaa')).toBeNull();
    const json = { type: 'json' as const, required: [{ key: 'n', type: 'number' as const }] };
    expect(runCheck(json, '{"n": 1}')).toBe(true);
    expect(runCheck(json, '{"n": "1"}')).toBe(false);
    expect(runCheck(json, '[1]')).toBe(false);
    expect(runCheck(json, 'no json here')).toBe(false);
    expect(
      runCheck(
        {
          type: 'json',
          required: [
            { key: 'v', type: 'null' },
            { key: 'a', type: 'array' },
          ],
        },
        '{"v":null,"a":[]}',
      ),
    ).toBe(true);
  });
});

describe('datasets', () => {
  it('creates, replaces by name, and lists', async () => {
    const { projectId, options } = await setup();
    const first = await upsertEvalDataset(options, projectId, DATASET, 'token:operator');
    expect(first.created).toBe(true);
    const second = await upsertEvalDataset(
      options,
      projectId,
      { ...DATASET, repeats: 3 },
      'token:operator',
    );
    expect(second).toMatchObject({ created: false, dataset: { id: first.dataset.id, repeats: 3 } });
    const listed = await listEvalDatasets(options, projectId);
    expect(listed.datasets.map((row) => row.name)).toEqual(['capitals']);
    expect(listed.datasets[0]?.cases).toHaveLength(3);
  });

  it('refuses duplicate case ids, an unsafe regex, and more attempts than a run may spend', async () => {
    const { projectId, options } = await setup();
    const one = DATASET.cases[0]!;
    await expect(
      upsertEvalDataset(options, projectId, { ...DATASET, cases: [one, one] }, 'a'),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      upsertEvalDataset(
        options,
        projectId,
        { ...DATASET, cases: [{ ...one, checks: [{ type: 'regex', pattern: '(a+)+' }] }] },
        'a',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const many = Array.from({ length: 200 }, (_, index) => ({ ...one, id: `c${String(index)}` }));
    expect(200 * 20).toBeGreaterThan(MAX_RUN_ATTEMPTS);
    await expect(
      upsertEvalDataset(options, projectId, { ...DATASET, repeats: 20, cases: many }, 'a'),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('running a dataset', () => {
  it('runs every case and repeat through the gateway and stores the run through the upload door', async () => {
    const { db, projectId, options, calls } = await setup();
    const { dataset } = await upsertEvalDataset(options, projectId, DATASET, 'a');
    const prepared = await prepareDatasetRun(options, projectId, dataset.id, { branch: 'feature' });
    expect(prepared.started).toEqual({
      datasetId: dataset.id,
      suite: 'capitals',
      branch: 'feature',
      attempts: 6,
      status: 'started',
    });
    const result = await prepared.execute();
    expect(result.toolKey).toBe('automate-eval-json:capitals');
    expect(calls).toHaveLength(6);
    expect(calls[2]?.messages[0]).toEqual({ role: 'system', content: 'Be terse.' });
    const [run] = await db.select().from(schema.evalRuns);
    expect(run).toMatchObject({
      source: 'runner',
      format: 'automate-eval-json',
      branch: 'feature',
      toolName: 'automate-eval-runner',
      provider: 'ollama',
    });
    expect(run?.totals).toMatchObject({
      attempts: 6,
      passed: 6,
      failed: 0,
      errors: 0,
      tokensInput: 42,
    });
    // No storePrompts in the policy: the runner's prompt is dropped by the same door.
    const cases = await db.select().from(schema.evalCases);
    expect(cases.every((row) => row.prompt === null)).toBe(true);
  });

  it('records a provider failure as an undecided attempt, never a pass', async () => {
    const failing = stubGateway(() => new Error('rate limited'));
    const { dataset } = {
      dataset: { ...DATASET, id: 'x', projectId: 'p', judge: null, updatedAt: NOW.toISOString() },
    };
    const run = await executeDataset(failing, dataset, 'kilo', 1000);
    expect(run.totals).toMatchObject({ passed: 0, failed: 0, errors: 6 });
    expect(run.cases[0]?.attempts[0]).toMatchObject({ passed: null, error: 'rate limited' });
  });

  it('asks the judge only when one is configured, and only after the checks pass', async () => {
    const calls: CompletionInput[] = [];
    const gateway = stubGateway(
      (input) => (input.model === 'judge-model' ? 'FAIL: wrong tone' : answer(input)),
      calls,
    );
    const dataset = {
      ...DATASET,
      repeats: 1,
      id: 'x',
      projectId: 'p',
      judge: { model: 'judge-model', rubric: 'Polite.' },
      updatedAt: NOW.toISOString(),
    };
    const run = await executeDataset(gateway, dataset, 'kilo');
    expect(calls.filter((call) => call.model === 'judge-model')).toHaveLength(3);
    expect(run.cases.every((row) => row.attempts[0]?.passed === false)).toBe(true);
    expect(run.cases[0]?.attempts[0]?.scores.map((score) => score.metric)).toEqual([
      'checks',
      'judge',
    ]);
    const brokenJudge = stubGateway((input) =>
      input.model === 'judge-model' ? new Error('down') : answer(input),
    );
    const undecided = await executeDataset(brokenJudge, dataset, 'kilo');
    expect(undecided.cases[0]?.attempts[0]).toMatchObject({ passed: null, error: 'judge: down' });
  });

  it('refuses with NOT_CONFIGURED when no model provider is configured, and stores nothing', async () => {
    const { db, projectId, options } = await setup(null);
    const { dataset } = await upsertEvalDataset(options, projectId, DATASET, 'a');
    await expect(prepareDatasetRun(options, projectId, dataset.id, {})).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
    expect(await db.select().from(schema.evalRuns)).toEqual([]);
  });

  it('refuses an unknown dataset and a second run of one in flight', async () => {
    const { projectId, options } = await setup();
    await expect(prepareDatasetRun(options, projectId, 'nope', {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      prepareDatasetRun(options, projectId, '00000000-0000-0000-0000-000000000000', {}),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const { dataset } = await upsertEvalDataset(options, projectId, DATASET, 'a');
    const first = await prepareDatasetRun(options, projectId, dataset.id, {});
    const pending = first.execute();
    await expect(prepareDatasetRun(options, projectId, dataset.id, {})).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await pending;
    const again = await prepareDatasetRun(options, projectId, dataset.id, {});
    again.release();
  });

  it('claims the dataset at prepare, before anything is awaited, and frees it on release', async () => {
    const { projectId, options } = await setup();
    const { dataset } = await upsertEvalDataset(options, projectId, DATASET, 'a');
    const first = await prepareDatasetRun(options, projectId, dataset.id, {});
    // Not yet executed: a second run is already refused.
    await expect(prepareDatasetRun(options, projectId, dataset.id, {})).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    first.release();
    first.release();
    const second = await prepareDatasetRun(options, projectId, dataset.id, {});
    await second.execute();
    const third = await prepareDatasetRun(options, projectId, dataset.id, {});
    third.release();
  });
});

describe('workspace isolation', () => {
  it('is another workspace\u2019s project, as far as another workspace can tell, not found', async () => {
    const { db, projectId, options } = await setup();
    const { dataset } = await upsertEvalDataset(options, projectId, DATASET, 'a');
    const other = { ...options, workspaceId: 'ws-2' };
    await expect(listEvalDatasets(other, projectId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(upsertEvalDataset(other, projectId, DATASET, 'a')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(prepareDatasetRun(other, projectId, dataset.id, {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await db.select().from(schema.evalDatasets)).toHaveLength(1);
  });
});
