import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import * as schema from '@automate/db';
import { instrumentedGateway, type CompletionInput } from '@automate/automation';
import {
  TestProposalListSchema,
  TestProposalSchema,
  type TestProposalBody,
} from '@automate/shared-contracts';
import { createErrorBoundary } from '../errors/boundary.js';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import type { CallerResolver } from '../http/roles.js';
import { createTestProposalRoutes } from '../routes/test-proposals.js';
import type { Caller } from './access-service.js';
import { TEST_PROPOSAL_AGENT_NAME, recordSelfSpan } from './genai-span-service.js';
import { ingestHealthReport } from './repo-health-service.js';
import {
  MAX_PROPOSAL_PATCH,
  TEST_PROPOSAL_RETENTION,
  extractCodeBlock,
  frameworkFor,
  listTestProposals,
  newFilePatch,
  proposeTest,
  suggestedTestPath,
  type TestProposalOptions,
} from './test-proposal-service.js';
import { agentProject, stubGateway } from '../test-support/agent-fixtures.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const ANSWER = [
  'This test pins the boundary the mutant changed.',
  '',
  '```ts',
  "import { expect, it } from 'vitest';",
  "import { clamp } from './math.js';",
  '',
  "it('keeps the upper bound', () => {",
  '  expect(clamp(11, 0, 10)).toBe(10);',
  '});',
  '```',
  '',
  'It fails if `>` becomes `>=`.',
].join('\n');

async function mutant(
  db: MigratedDb,
  workspaceId: string,
  projectId: string,
  ruleId = 'stryker/surviving-mutant',
) {
  const [row] = await db
    .insert(schema.healthFindings)
    .values({
      workspaceId,
      projectId,
      branch: 'main',
      fingerprint: `fp-${String(Math.random()).slice(2, 10)}`,
      toolKey: 'stryker',
      tool: 'stryker',
      ruleId,
      kind: 'quality',
      severity: 'medium',
      dimension: 'testing',
      path: 'src/math.ts',
      line: 7,
      message: '3 mutants survived in clamp',
    })
    .returning({ id: schema.healthFindings.id });
  return (row as { id: string }).id;
}

async function setup(answer: (input: CompletionInput) => string | Error = () => ANSWER) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const projectId = await agentProject(db);
  const calls: CompletionInput[] = [];
  let tick = 0;
  const options: TestProposalOptions = {
    db: db as never,
    workspaceId: 'ws-1',
    gateway: stubGateway(answer, calls),
    provider: 'ollama',
    now: () => new Date(Date.UTC(2026, 9, 26, 12, 0, tick++)),
  };
  return { db, options, projectId, calls };
}

async function refusal(promise: Promise<unknown>): Promise<DomainError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(DomainError);
  return error as DomainError;
}

const LCOV = ['SF:src/a.ts', 'DA:1,1', 'DA:2,3', 'DA:3,0', 'DA:4,0', 'end_of_record', ''].join(
  '\n',
);
const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,4 @@',
  ' one',
  '+two',
  '+three',
  ' four',
  '',
].join('\n');
const COMMIT = 'abc1234def';

describe('the pure parts', () => {
  it('extracts the first fenced block and keeps the prose as the rationale', () => {
    expect(extractCodeBlock(ANSWER)).toEqual({
      code: [
        "import { expect, it } from 'vitest';",
        "import { clamp } from './math.js';",
        '',
        "it('keeps the upper bound', () => {",
        '  expect(clamp(11, 0, 10)).toBe(10);',
        '});',
      ].join('\n'),
      rationale: 'This test pins the boundary the mutant changed.\n\nIt fails if `>` becomes `>=`.',
    });
    expect(extractCodeBlock('no code here')).toBeNull();
    expect(extractCodeBlock('```ts\n   \n```')).toBeNull();
    expect(extractCodeBlock('```ts\nunterminated')).toBeNull();
  });

  it('names a new file beside the source that cannot overwrite an existing test', () => {
    expect(suggestedTestPath('src/math.ts')).toBe('src/math.proposed.test.ts');
    expect(suggestedTestPath('pkg/util.py')).toBe('pkg/test_util_proposed.py');
    expect(suggestedTestPath('cmd/main.go')).toBe('cmd/main_proposed_test.go');
    expect(suggestedTestPath('src/Thing.java')).toBe('src/ThingProposedTest.java');
    expect(suggestedTestPath('Makefile')).toBe('Makefile.proposed.test');
    expect(frameworkFor('a.py')).toBe('pytest');
    expect(frameworkFor('a.rb')).toBe('the project test framework');
    expect(frameworkFor('a.ts', 'jest')).toBe('jest');
  });

  it('writes a unified diff that only creates the file', () => {
    expect(newFilePatch('src/a.test.ts', 'one\r\ntwo\n')).toBe(
      [
        'diff --git a/src/a.test.ts b/src/a.test.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/src/a.test.ts',
        '@@ -0,0 +1,2 @@',
        '+one',
        '+two',
        '',
      ].join('\n'),
    );
  });
});

describe('proposing a test', () => {
  it('builds the prompt from a surviving mutant and stores a patch, never applying it', async () => {
    const { db, options, projectId, calls } = await setup();
    const findingId = await mutant(db, 'ws-1', projectId);
    const body: TestProposalBody = {
      kind: 'surviving-mutant',
      findingId,
      sourceSnippet: 'export const clamp = (v, lo, hi) => (v > hi ? hi : v < lo ? lo : v);',
    };
    const proposal = TestProposalSchema.parse(
      await proposeTest(options, projectId, body, 'token:op'),
    );
    expect(proposal).toMatchObject({
      kind: 'surviving-mutant',
      findingId,
      path: 'src/math.ts',
      testFramework: 'vitest',
      suggestedPath: 'src/math.proposed.test.ts',
      model: 'model-a',
      provider: 'ollama',
      tokens: { input: 7, output: 3 },
      createdBy: 'token:op',
    });
    expect(proposal.patch.startsWith('diff --git a/src/math.proposed.test.ts')).toBe(true);
    expect(proposal.patch).toContain('+  expect(clamp(11, 0, 10)).toBe(10);');
    const prompt = calls[0]?.messages.map((message) => message.content).join('\n') ?? '';
    expect(prompt).toContain('3 mutants survived in clamp');
    expect(prompt).toContain('First surviving mutant at line 7.');
    expect(prompt).toContain('export const clamp');
    expect(prompt).toContain('`src/math.proposed.test.ts`');
    expect(await db.select().from(schema.testProposals)).toHaveLength(1);
  });

  it('builds the prompt from a commit’s uncovered changed lines', async () => {
    const { options, projectId, calls } = await setup();
    const upload = (format: 'lcov' | 'git-diff', text: string) =>
      ingestHealthReport(options, {
        projectId,
        format,
        bytes: new TextEncoder().encode(text),
        branch: 'feature',
        commitSha: COMMIT,
        source: 'ci',
      });
    await upload('lcov', LCOV);
    await upload('git-diff', DIFF);
    const proposal = await proposeTest(
      options,
      projectId,
      {
        kind: 'uncovered-lines',
        commit: COMMIT.toUpperCase(),
        path: 'src/a.ts',
        testFramework: 'jest',
      },
      'a',
    );
    expect(proposal).toMatchObject({
      kind: 'uncovered-lines',
      commit: COMMIT,
      testFramework: 'jest',
    });
    const prompt = calls[0]?.messages.map((message) => message.content).join('\n') ?? '';
    expect(prompt).toContain('ran in no test: 3');
    expect(prompt).toContain('No source was supplied');
    const missing = await refusal(
      proposeTest(
        options,
        projectId,
        { kind: 'uncovered-lines', commit: COMMIT, path: 'src/b.ts' },
        'a',
      ),
    );
    expect(missing.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('is NOT_CONFIGURED without a gateway, before reading or storing anything', async () => {
    const { db, options, projectId } = await setup();
    const findingId = await mutant(db, 'ws-1', projectId);
    const error = await refusal(
      proposeTest(
        { ...options, gateway: null },
        projectId,
        { kind: 'surviving-mutant', findingId },
        'a',
      ),
    );
    expect(error.code).toBe(ErrorCode.NOT_CONFIGURED);
    expect(await db.select().from(schema.testProposals)).toHaveLength(0);
  });

  it('refuses a finding that is not a surviving mutant, an answer with no code, and a failing provider', async () => {
    const { db, options, projectId } = await setup(() => 'I would test the boundary.');
    const other = await mutant(db, 'ws-1', projectId, 'semgrep/xss');
    expect(
      (
        await refusal(
          proposeTest(options, projectId, { kind: 'surviving-mutant', findingId: other }, 'a'),
        )
      ).code,
    ).toBe(ErrorCode.INVALID_REQUEST_BODY);
    const findingId = await mutant(db, 'ws-1', projectId);
    expect(
      (await refusal(proposeTest(options, projectId, { kind: 'surviving-mutant', findingId }, 'a')))
        .code,
    ).toBe(ErrorCode.MODEL_OUTPUT_UNUSABLE);
    const failing = { ...options, gateway: stubGateway(() => new Error('provider down')) };
    expect(
      (await refusal(proposeTest(failing, projectId, { kind: 'surviving-mutant', findingId }, 'a')))
        .code,
    ).toBe(ErrorCode.DEPENDENCY_UNAVAILABLE);
    expect(await db.select().from(schema.testProposals)).toHaveLength(0);
  });

  it('refuses a test whose patch would be over the stored bound', async () => {
    // Short lines: under the code limit, over the patch limit once each gains a `+`.
    const lines = Array.from({ length: 30_000 }, () => 'x').join('\n');
    const { db, options, projectId } = await setup(() => `\`\`\`ts\n${lines}\n\`\`\``);
    const findingId = await mutant(db, 'ws-1', projectId);
    expect(newFilePatch('src/math.proposed.test.ts', lines).length).toBeGreaterThan(
      MAX_PROPOSAL_PATCH,
    );
    const error = await refusal(
      proposeTest(options, projectId, { kind: 'surviving-mutant', findingId }, 'a'),
    );
    expect(error.code).toBe(ErrorCode.MODEL_OUTPUT_UNUSABLE);
  });

  it(`keeps the newest ${String(TEST_PROPOSAL_RETENTION)} per project`, async () => {
    const { db, options, projectId } = await setup();
    const findingId = await mutant(db, 'ws-1', projectId);
    for (let index = 0; index < TEST_PROPOSAL_RETENTION + 2; index += 1) {
      await proposeTest(
        options,
        projectId,
        { kind: 'surviving-mutant', findingId },
        `a${String(index)}`,
      );
    }
    const listed = await listTestProposals(options, projectId);
    expect(listed).toHaveLength(TEST_PROPOSAL_RETENTION);
    expect(listed[0]?.createdBy).toBe(`a${String(TEST_PROPOSAL_RETENTION + 1)}`);
    expect(await db.select().from(schema.testProposals)).toHaveLength(TEST_PROPOSAL_RETENTION);
  });

  it('keeps another workspace out of the finding and the list', async () => {
    const { db, options, projectId } = await setup();
    const findingId = await mutant(db, 'ws-1', projectId);
    await proposeTest(options, projectId, { kind: 'surviving-mutant', findingId }, 'a');
    const other = { ...options, workspaceId: 'ws-2' };
    expect((await refusal(listTestProposals(other, projectId))).code).toBe(ErrorCode.NOT_FOUND);
    const [foreign] = await db
      .insert(schema.projects)
      .values({ workspaceId: 'ws-2', name: 'x', slug: 'x', defaultBranch: 'main', profile: {} })
      .returning({ id: schema.projects.id });
    const foreignId = (foreign as { id: string }).id;
    expect(
      (await refusal(proposeTest(other, foreignId, { kind: 'surviving-mutant', findingId }, 'a')))
        .code,
    ).toBe(ErrorCode.NOT_FOUND);
    expect(await listTestProposals(other, foreignId)).toEqual([]);
  });

  it('records one GenAI span per proposal through the instrumented gateway, without content', async () => {
    const { db, options, projectId } = await setup();
    const findingId = await mutant(db, 'ws-1', projectId);
    const recorded: Array<Promise<void>> = [];
    const gateway = instrumentedGateway(
      options.gateway as NonNullable<TestProposalOptions['gateway']>,
      {
        record: (span) => {
          const pending = recordSelfSpan(options, span, TEST_PROPOSAL_AGENT_NAME);
          recorded.push(pending);
          return pending;
        },
      },
      { provider: 'ollama' },
    );
    await proposeTest(
      { ...options, gateway },
      projectId,
      { kind: 'surviving-mutant', findingId },
      'a',
    );
    await Promise.all(recorded);
    const spans = await db
      .select()
      .from(schema.genaiSpans)
      .where(eq(schema.genaiSpans.agentName, TEST_PROPOSAL_AGENT_NAME));
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      source: 'self',
      provider: 'ollama',
      requestModel: 'model-a',
      inputTokens: 7,
      outputTokens: 3,
      status: 'ok',
      content: null,
    });
  });
});

describe('the test proposal routes', () => {
  it('lets an operator propose and a viewer list, audits the proposal without the patch', async () => {
    const { db, options, projectId } = await setup();
    const findingId = await mutant(db, 'ws-1', projectId);
    const tokens: Record<string, Caller> = {
      amt_viewer: { actor: 'token:viewer', role: 'viewer', uploaderFor: null },
      amt_operator: { actor: 'token:operator', role: 'operator', uploaderFor: null },
    };
    const access: CallerResolver = {
      mode: 'enforced',
      authenticateToken: async (token) => tokens[token] ?? null,
      hasSession: async () => false,
    };
    const { onError } = createErrorBoundary({
      log: () => undefined,
      reportError: () => undefined,
      requestId: () => 'NO_REQUEST',
    });
    const app = new Hono()
      .onError(onError)
      .route('/', createTestProposalRoutes({ ...options, access }));
    const path = `/api/v1/projects/${projectId}/health/test-proposals`;
    const post = (token: string | undefined, body: unknown) =>
      app.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(body),
      });
    expect((await post('amt_viewer', { kind: 'surviving-mutant', findingId })).status).toBe(403);
    expect((await post('amt_operator', { kind: 'surviving-mutant', findingId: 'x' })).status).toBe(
      400,
    );
    expect(
      (
        await post('amt_operator', {
          kind: 'surviving-mutant',
          findingId,
          sourceSnippet: 'x'.repeat(20_001),
        })
      ).status,
    ).toBe(400);
    const created = await post('amt_operator', { kind: 'surviving-mutant', findingId });
    expect(created.status).toBe(201);
    const list = await app.request(path, { headers: { authorization: 'Bearer amt_viewer' } });
    expect(TestProposalListSchema.parse(await list.json()).proposals).toHaveLength(1);
    const trail = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, 'test-proposal.create'));
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ actorId: 'token:operator', resourceType: 'test_proposal' });
    expect(JSON.stringify(trail)).not.toContain('clamp(11');
  });
});
