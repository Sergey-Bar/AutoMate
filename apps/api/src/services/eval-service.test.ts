import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { MAX_HEALTH_REPORT_BYTES } from '@automate/reporter';
import { ProjectEvalsSchema, EvalRunDetailSchema } from '@automate/shared-contracts';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { agentProject, encode, evalRun } from '../test-support/agent-fixtures.js';
import {
  EVAL_RUNS_RETAINED,
  MAX_STORED_ATTEMPTS,
  evalGateReading,
  evalRunDetail,
  evalSeed,
  projectEvals,
  storeEvalRun,
} from './eval-service.js';
import { healthGate, ingestHealthReport, projectHealth } from './repo-health-service.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-10-26T00:00:00.000Z');

async function setup(agents: Record<string, unknown> = {}, weights = true) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const projectId = await agentProject(db, {
    agents,
    ...(weights ? { weights: { 'agent-quality': 10 } } : {}),
  });
  const options = { db: db as never, workspaceId: 'ws-1', now: () => NOW };
  const health = {
    ...options,
    evalGateReading: (id: string, branch: string, commit?: string) =>
      evalGateReading(options, id, branch, commit),
  };
  const upload = (
    branch: string,
    run: unknown,
    format = 'automate-eval-json' as const,
    commitSha?: string,
  ) =>
    ingestHealthReport(health, {
      projectId,
      format,
      bytes: encode(run),
      branch,
      ...(commitSha === undefined ? {} : { commitSha }),
      source: 'ci',
    });
  return { db, projectId, options, health, upload };
}

const MAIN = { paris: 9, berlin: 9, rome: 9 };
const REGRESSED = { paris: 2, berlin: 3, rome: 1 };

describe('eval ingestion', () => {
  it('stores an uploaded run and its cases, keeps no prompt by default, and feeds agent-quality', async () => {
    const { db, projectId, options, upload } = await setup();
    const result = await upload('main', evalRun('support', MAIN));
    expect(result.toolKey).toBe('automate-eval-json:support');
    expect(result.metrics).toBeGreaterThan(0);
    const [run] = await db.select().from(schema.evalRuns);
    expect(run).toMatchObject({ suite: 'support', branch: 'main', source: 'ci', truncated: false });
    const cases = await db.select().from(schema.evalCases);
    expect(cases).toHaveLength(3);
    expect(cases.every((row) => row.prompt === null && row.promptHash !== null)).toBe(true);
    const health = await projectHealth(options, projectId, 'main');
    const quality = health.grade.dimensions.find((entry) => entry.dimension === 'agent-quality');
    expect(quality?.measured).toBe(true);
    expect(quality?.score).toBe(90);
  });

  it('keeps the prompt text only when the policy says storePrompts', async () => {
    const { db, upload } = await setup({ storePrompts: true });
    await upload('main', evalRun('support', { paris: 1 }, 1));
    const [row] = await db.select().from(schema.evalCases);
    expect(row?.prompt).toBe('the prompt for paris');
  });

  it('drops the prompt when the health policy does not parse, rather than reading it loosely', async () => {
    const { db, close } = await migratedDatabase();
    closers.push(close);
    // `storePrompts` is there, but beside a policy the schema refuses: no part of it applies.
    const projectId = await agentProject(db, {
      agents: { storePrompts: true },
      weights: { 'agent-quality': 'heavy' },
    });
    const options = { db: db as never, workspaceId: 'ws-1', now: () => NOW };
    await ingestHealthReport(options, {
      projectId,
      format: 'automate-eval-json',
      bytes: encode(evalRun('support', { paris: 1 }, 1)),
      branch: 'main',
      source: 'ci',
    });
    const [row] = await db.select().from(schema.evalCases);
    expect(row?.prompt).toBeNull();
  });

  it('refuses an eval run over the upload limit before parsing it', async () => {
    const { projectId, options, upload } = await setup();
    const bytes = new Uint8Array(MAX_HEALTH_REPORT_BYTES + 1).fill(0x20);
    await expect(
      ingestHealthReport(options, {
        projectId,
        format: 'automate-eval-json',
        bytes,
        branch: 'main',
        source: 'ci',
      }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(upload('main', [])).rejects.toMatchObject({ code: 'INVALID_REQUEST_BODY' });
  });

  it('reads a promptfoo export through the same door', async () => {
    const { db, upload } = await setup();
    const row = (id: string, pass: boolean) => ({
      id: `r-${id}`,
      testIdx: 0,
      testCase: { description: id, vars: { q: id }, metadata: { id } },
      provider: { id: 'openai:gpt-4o', label: '' },
      prompt: { raw: `q ${id}`, label: 'p' },
      response: { output: 'x', tokenUsage: { prompt: 1, completion: 1, total: 2 } },
      success: pass,
      score: pass ? 1 : 0,
      latencyMs: 10,
      gradingResult: { pass, score: pass ? 1 : 0, reason: '' },
      namedScores: {},
      failureReason: pass ? 0 : 1,
      error: null,
    });
    await upload(
      'main',
      {
        evalId: 'e1',
        results: { version: 3, results: [row('a', true), row('b', false)] },
        config: { description: 'capitals' },
        metadata: { promptfooVersion: '0.120.1' },
      },
      'promptfoo-json' as never,
    );
    const [run] = await db.select().from(schema.evalRuns);
    expect(run).toMatchObject({ format: 'promptfoo-json', toolName: 'promptfoo' });
    expect(await db.select().from(schema.evalCases)).toHaveLength(2);
  });

  it('refuses a document that is not an eval run, and stores nothing', async () => {
    const { db, upload } = await setup();
    await expect(upload('main', { suite: 'x' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST_BODY',
    });
    const { health, projectId } = await setup();
    await expect(
      ingestHealthReport(health, {
        projectId,
        format: 'automate-eval-json',
        bytes: new TextEncoder().encode('{not json'),
        source: 'ci',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST_BODY' });
    expect(await db.select().from(schema.evalRuns)).toEqual([]);
  });

  it('cuts a case to the stored attempt bound and says so', async () => {
    const { db, upload } = await setup();
    await upload('main', evalRun('long', { paris: 50 }, MAX_STORED_ATTEMPTS + 5));
    const [run] = await db.select().from(schema.evalRuns);
    const [row] = await db.select().from(schema.evalCases);
    expect(run?.truncated).toBe(true);
    expect((row?.attempts as unknown[]).length).toBe(MAX_STORED_ATTEMPTS);
  });

  it(`keeps the newest ${String(EVAL_RUNS_RETAINED)} runs of a project`, async () => {
    const { db, projectId, options } = await setup();
    const run = evalRun('tiny', { a: 1 }, 1);
    for (let index = 0; index <= EVAL_RUNS_RETAINED; index += 1) {
      await storeEvalRun(options, {
        projectId,
        branch: 'main',
        commit: undefined,
        format: 'automate-eval-json',
        source: 'ci',
        run: { ...run, suite: `s${String(index)}` },
        now: NOW,
      });
    }
    const rows = await db.select({ suite: schema.evalRuns.suite }).from(schema.evalRuns);
    expect(rows).toHaveLength(EVAL_RUNS_RETAINED);
    expect(rows.map((row) => row.suite)).not.toContain('s0');
  }, 120_000);
});

describe('eval regression', () => {
  it('compares the newest run of a suite on a branch with the default branch', async () => {
    const { projectId, options, upload } = await setup();
    await upload('main', evalRun('support', { paris: 1, berlin: 1, rome: 1 }));
    await upload('main', evalRun('support', MAIN));
    await upload('feature', evalRun('support', REGRESSED));
    await upload('feature', evalRun('other', MAIN));
    const evals = ProjectEvalsSchema.parse(await projectEvals(options, projectId, 'feature'));
    expect(evals.defaultBranch).toBe('main');
    expect(evals.runs).toHaveLength(2);
    const support = evals.suites.find((suite) => suite.suite === 'support');
    expect(support?.baseline?.totals.passed).toBe(27);
    expect(support?.comparison?.verdict).toBe('fail');
    expect(support?.comparison?.regressions.some((change) => change.significant)).toBe(true);
    expect(support?.scorecard.dimension).toBe('agent-quality');
    // A suite with no baseline on the default branch has no comparison, never a pass.
    const other = evals.suites.find((suite) => suite.suite === 'other');
    expect(other?.comparison).toBeNull();
    expect(other?.scorecard.status).toBe('insufficient');
    // The same two runs compare to the same answer every time.
    expect(await projectEvals(options, projectId, 'feature')).toEqual(evals);
  });

  it('has no comparison on the default branch itself', async () => {
    const { projectId, options, upload } = await setup();
    await upload('main', evalRun('support', MAIN));
    const evals = await projectEvals(options, projectId);
    expect(evals.branch).toBe('main');
    expect(evals.suites[0]?.baseline).toBeNull();
    expect(evals.suites[0]?.comparison).toBeNull();
  });

  it('derives the bootstrap seed from the two run ids, in order', () => {
    expect(evalSeed('a', 'b')).toBe(evalSeed('a', 'b'));
    expect(evalSeed('a', 'b')).not.toBe(evalSeed('b', 'a'));
    expect(Number.isInteger(evalSeed('a', 'b'))).toBe(true);
  });

  it('fails the pull-request gate on a regression only under gateOnEvals', async () => {
    for (const gateOnEvals of [true, false]) {
      const { projectId, health, upload } = await setup({ gateOnEvals });
      await upload('main', evalRun('support', MAIN));
      await upload('feature', evalRun('support', REGRESSED));
      const gate = await healthGate(health, projectId, 'feature');
      expect(gate.evals?.gateOnEvals).toBe(gateOnEvals);
      expect(gate.evals?.suites[0]).toMatchObject({ suite: 'support', verdict: 'fail' });
      const reasons = gate.verdict.reasons.filter((reason) => reason.startsWith('Evals (support)'));
      expect(reasons.length > 0).toBe(gateOnEvals);
    }
  });

  it('passes the gate when the branch holds steady', async () => {
    const { projectId, health, upload } = await setup({ gateOnEvals: true });
    await upload('main', evalRun('support', MAIN));
    await upload('feature', evalRun('support', MAIN));
    const gate = await healthGate(health, projectId, 'feature');
    expect(gate.evals?.suites[0]?.verdict).toBe('pass');
    expect(gate.verdict.reasons.some((reason) => reason.startsWith('Evals'))).toBe(false);
  });

  it('fails a gated branch that never ran the default branch\u2019s suites', async () => {
    const { projectId, health, upload } = await setup({ gateOnEvals: true });
    await upload('main', evalRun('support', MAIN));
    const gate = await healthGate(health, projectId, 'feature');
    expect(gate.verdict.verdict).toBe('failed');
    expect(gate.evals?.suites).toMatchObject([{ suite: 'support', verdict: 'missing' }]);
    expect(gate.verdict.reasons).toContain(
      'Evals (support): the suite runs on the default branch but did not run on this branch; the policy gates on evals',
    );
  });

  it('fails a gated suite with no baseline, one deleted on the branch, and an insufficient one', async () => {
    const { projectId, health, upload } = await setup({ gateOnEvals: true, minEvalAttempts: 1000 });
    await upload('main', evalRun('support', MAIN));
    await upload('main', evalRun('router', MAIN));
    await upload('feature', evalRun('support', MAIN));
    await upload('feature', evalRun('summariser', MAIN));
    const gate = await healthGate(health, projectId, 'feature');
    const verdicts = Object.fromEntries(
      (gate.evals?.suites ?? []).map((suite) => [suite.suite, suite.verdict]),
    );
    expect(verdicts).toEqual({
      support: 'insufficient',
      summariser: 'no-baseline',
      router: 'missing',
    });
    expect(gate.verdict.verdict).toBe('failed');
    expect(gate.verdict.reasons).toContain(
      'Evals (summariser): the default branch has no run of this suite to compare against; the policy gates on evals',
    );
    expect(gate.verdict.reasons.filter((reason) => reason.startsWith('Evals ('))).toHaveLength(3);
  });

  it('fails gated evals that nothing measured, and reports-only evals never fail', async () => {
    const gated = await setup({ gateOnEvals: true });
    const verdict = (await healthGate(gated.health, gated.projectId, 'feature')).verdict;
    expect(verdict.reasons).toContain(
      'Evals were not measured: no eval run on this branch or the default branch; the policy gates on evals',
    );
    const reported = await setup({ gateOnEvals: false });
    await reported.upload('main', evalRun('support', MAIN));
    const gate = await healthGate(reported.health, reported.projectId, 'feature');
    expect(gate.verdict.reasons.some((reason) => reason.startsWith('Evals'))).toBe(false);
  });

  it('gates on the named commit\u2019s run when there is one, and says when it fell back', async () => {
    const { projectId, health, upload } = await setup({ gateOnEvals: true });
    await upload('main', evalRun('support', MAIN));
    await upload('feature', evalRun('support', REGRESSED), 'automate-eval-json', 'aaaaaaa1');
    await upload('feature', evalRun('support', MAIN), 'automate-eval-json', 'bbbbbbb2');
    const atOld = await healthGate(health, projectId, 'feature', 'aaaaaaa1');
    expect(atOld.evals?.suites[0]).toMatchObject({ verdict: 'fail', commitSha: 'aaaaaaa1' });
    expect(atOld.evals?.suites[0]?.fellBack).toBe(false);
    const elsewhere = await healthGate(health, projectId, 'feature', 'ccccccc3');
    expect(elsewhere.evals?.suites[0]).toMatchObject({
      verdict: 'pass',
      commitSha: 'bbbbbbb2',
      fellBack: true,
    });
    expect(elsewhere.evals?.commit).toBe('ccccccc3');
  });
});

describe('eval run detail', () => {
  it('returns a run with its cases, and another project\u2019s run as not found', async () => {
    const { db, projectId, options, upload } = await setup();
    await upload('main', evalRun('support', MAIN));
    const [run] = await db.select().from(schema.evalRuns);
    const detail = EvalRunDetailSchema.parse(await evalRunDetail(options, projectId, run!.id));
    expect(detail.cases.map((row) => row.caseId)).toEqual(['paris', 'berlin', 'rome']);
    const otherProject = await agentProject(db as MigratedDb);
    await expect(evalRunDetail(options, otherProject, run!.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(evalRunDetail(options, projectId, 'not-a-uuid')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('workspace isolation', () => {
  it('is another workspace\u2019s project, as far as another workspace can tell, not found', async () => {
    const { db, projectId, upload } = await setup();
    await upload('main', evalRun('support', MAIN));
    const [run] = await db.select().from(schema.evalRuns);
    const other = { db: db as never, workspaceId: 'ws-2', now: () => NOW };
    await expect(projectEvals(other, projectId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(evalRunDetail(other, projectId, run!.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(evalGateReading(other, projectId, 'main')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      ingestHealthReport(other, {
        projectId,
        format: 'automate-eval-json',
        bytes: encode(evalRun('x', { a: 1 }, 1)),
        source: 'ci',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await db.select().from(schema.evalRuns)).toHaveLength(1);
  });
});
