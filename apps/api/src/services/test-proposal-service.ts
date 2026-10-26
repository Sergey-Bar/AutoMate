import { and, desc, eq, notInArray } from 'drizzle-orm';
import { healthFindings, testProposals, type TestProposalRow } from '@automate/db';
import type { AiGateway, CompletionInput } from '@automate/automation';
import type { TestProposal, TestProposalBody } from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { diffCoverageStatus } from './diff-coverage-service.js';
import { lineRanges } from './health-integrations.js';
import { projectRow, type HealthStoreOptions } from './health-findings.js';

/**
 * AI test proposals: a surviving mutant or a diff's uncovered lines, turned into a proposed
 * new test file by the configured model — and **only proposed**.
 *
 * ## Never a change
 *
 * Nothing here writes to a repository, commits, pushes or opens a pull request. The answer is
 * a unified diff that creates one new file, its rationale, and what it cost; it is stored so
 * the page can list it, and a person decides what to do with it.
 *
 * ## The evidence is the prompt
 *
 * The prompt is built from what the product recorded — the finding's rule, message, file and
 * line, or the commit's uncovered changed lines — plus the source snippet the caller sends,
 * because a project registered by URL has no checkout on this server. A model that is asked
 * for a test without the evidence writes a plausible test of nothing in particular.
 *
 * ## Measured like chat
 *
 * The gateway handed in is the composition root's instrumented one, so a completion here is a
 * GenAI span exactly as a chat completion is. No gateway, no proposal: `NOT_CONFIGURED`
 * before anything is read or stored.
 */
export interface TestProposalOptions extends HealthStoreOptions {
  /** The configured gateway, or `null` when no model provider is configured. */
  gateway: AiGateway | null;
  /** The gateway's provider name, stored with the proposal. */
  provider: string | null;
  /** The model to ask; absent, the gateway's first listed model. */
  model?: string | undefined;
  timeoutMs?: number;
  now?: () => Date;
}

/** Proposals kept per project; older ones are pruned on every write. */
export const TEST_PROPOSAL_RETENTION = 50;
/** The largest test file a proposal may carry, in characters. */
export const MAX_PROPOSED_TEST = 60_000;
/**
 * The largest patch stored, in characters: the `test_proposals_patch_check` constraint. The
 * diff adds a `+` per line and a header, so a test under {@link MAX_PROPOSED_TEST} can still
 * be over this; it is refused here as unusable rather than by the database as a 500.
 */
export const MAX_PROPOSAL_PATCH = 65_536;
const RATIONALE_MAX = 4_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MUTANT_RULE = 'stryker/surviving-mutant';
type Messages = CompletionInput['messages'];

interface Evidence {
  kind: TestProposalBody['kind'];
  path: string;
  findingId: string | null;
  commit: string | null;
  /** The lines of the prompt that state what the product recorded. */
  facts: string[];
}

const FRAMEWORK_BY_EXTENSION: Record<string, string> = {
  ts: 'vitest',
  tsx: 'vitest',
  mts: 'vitest',
  js: 'vitest',
  jsx: 'vitest',
  mjs: 'vitest',
  py: 'pytest',
  go: 'go test',
  java: 'junit',
};

function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The framework the caller named, else the one the file's extension implies. */
export function frameworkFor(path: string, requested?: string): string {
  return requested ?? FRAMEWORK_BY_EXTENSION[extensionOf(path)] ?? 'the project test framework';
}

/** Where a proposed test for `path` would go: beside it, named so it cannot overwrite one. */
export function suggestedTestPath(path: string): string {
  const slash = path.lastIndexOf('/');
  const directory = slash === -1 ? '' : path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  const extension = extensionOf(path);
  const stem = extension === '' ? name : name.slice(0, -(extension.length + 1));
  if (extension === 'py') return `${directory}test_${stem}_proposed.py`;
  if (extension === 'go') return `${directory}${stem}_proposed_test.go`;
  if (extension === 'java') return `${directory}${stem}ProposedTest.java`;
  return extension === ''
    ? `${directory}${stem}.proposed.test`
    : `${directory}${stem}.proposed.test.${extension}`;
}

/** A unified diff that creates `path` holding `content`. */
export function newFilePatch(path: string, content: string): string {
  const lines = content.replace(/\r\n/gu, '\n').replace(/\n$/u, '').split('\n');
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${String(lines.length)} @@`,
    ...lines.map((line) => `+${line}`),
    '',
  ].join('\n');
}

/**
 * The first fenced code block of a model's answer, and the prose around it as the rationale.
 * `null` when there is no complete fenced block: an answer without one is not a test file.
 */
export function extractCodeBlock(text: string): { code: string; rationale: string } | null {
  const match = /```[^\n`]*\n([\s\S]*?)```/u.exec(text);
  if (match === null) return null;
  const code = (match[1] ?? '').trimEnd();
  if (code.trim() === '') return null;
  const rationale = `${text.slice(0, match.index)}\n${text.slice(match.index + match[0].length)}`
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  return { code, rationale };
}

async function mutantEvidence(
  options: TestProposalOptions,
  projectId: string,
  findingId: string,
): Promise<Evidence> {
  const [finding] = await options.db
    .select()
    .from(healthFindings)
    .where(
      and(
        eq(healthFindings.workspaceId, options.workspaceId),
        eq(healthFindings.projectId, projectId),
        eq(healthFindings.id, findingId),
      ),
    )
    .limit(1);
  if (finding === undefined) throw new DomainError(ErrorCode.NOT_FOUND, `No finding ${findingId}`);
  if (finding.ruleId !== MUTANT_RULE || finding.path === null) {
    throw new DomainError(
      ErrorCode.INVALID_REQUEST_BODY,
      'A surviving-mutant proposal needs a stryker surviving-mutant finding with a file',
    );
  }
  return {
    kind: 'surviving-mutant',
    path: finding.path,
    findingId: finding.id,
    commit: null,
    facts: [
      `Mutation testing (${finding.tool}) left mutants alive in \`${finding.path}\`: no test failed when the code was changed.`,
      `Finding: ${finding.message}`,
      ...(finding.line === null ? [] : [`First surviving mutant at line ${String(finding.line)}.`]),
      `Branch: ${finding.branch}.`,
      'Write a test that would fail on that mutation: assert the exact behaviour the mutated expression decides.',
    ],
  };
}

async function uncoveredEvidence(
  options: TestProposalOptions,
  projectId: string,
  commit: string,
  path: string,
): Promise<Evidence> {
  const status = await diffCoverageStatus(options, projectId, commit);
  const file = status.result?.uncovered.find((entry) => entry.path === path);
  if (status.result === null || file === undefined || file.lines.length === 0) {
    throw new DomainError(
      ErrorCode.NOT_FOUND,
      `Commit ${commit} has no uncovered changed lines recorded for ${path}`,
    );
  }
  return {
    kind: 'uncovered-lines',
    path,
    findingId: null,
    commit,
    facts: [
      `Commit ${commit} changed \`${path}\`, and these changed executable lines ran in no test: ${lineRanges(file.lines).join(', ')}.`,
      `Diff coverage of the commit: ${String(status.result.covered)} of ${String(status.result.executable)} changed executable lines covered.`,
      'Write a test that executes those lines and asserts what they do.',
    ],
  };
}

function promptFor(
  evidence: Evidence,
  framework: string,
  target: string,
  snippet: string | undefined,
): Messages {
  const source =
    snippet === undefined
      ? ['No source was supplied; infer the behaviour from the evidence and name what you assumed.']
      : [`Source of \`${evidence.path}\`:`, '```', snippet.replace(/```/gu, '`\u200b``'), '```'];
  return [
    {
      role: 'system',
      content:
        'You write one new automated test file. Answer with exactly one fenced code block holding the complete file, then at most five sentences explaining what the test proves. Never modify existing files.',
    },
    {
      role: 'user',
      content: [
        `Test framework: ${framework}.`,
        `The new file will be created at \`${target}\`.`,
        '',
        ...evidence.facts,
        '',
        ...source,
      ].join('\n'),
    },
  ];
}

async function chooseModel(options: TestProposalOptions, gateway: AiGateway): Promise<string> {
  if (options.model !== undefined) return options.model;
  const models = await gateway.listModels().catch(() => []);
  const first = models[0]?.id;
  if (first === undefined) {
    throw new DomainError(ErrorCode.NOT_CONFIGURED, 'The model provider lists no model', {
      callerSafe: true,
    });
  }
  return first;
}

interface Completion {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

async function complete(
  gateway: AiGateway,
  model: string,
  messages: Messages,
  timeoutMs: number,
): Promise<Completion> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('completion timed out')), timeoutMs);
  const answer: Completion = { text: '', inputTokens: null, outputTokens: null };
  try {
    for await (const chunk of gateway.streamCompletion({
      model,
      messages,
      signal: controller.signal,
    })) {
      if (chunk.type === 'text') answer.text += chunk.text;
      if (chunk.type === 'usage') {
        answer.inputTokens = chunk.usage.inputTokens ?? answer.inputTokens;
        answer.outputTokens = chunk.usage.outputTokens ?? answer.outputTokens;
      }
    }
  } catch (cause) {
    throw new DomainError(ErrorCode.DEPENDENCY_UNAVAILABLE, 'The model provider failed', {
      callerSafe: true,
      cause,
    });
  } finally {
    clearTimeout(timer);
  }
  return answer;
}

function proposalOf(row: TestProposalRow): TestProposal {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind as TestProposal['kind'],
    findingId: row.findingId,
    commit: row.commitSha,
    path: row.path,
    testFramework: row.testFramework,
    suggestedPath: row.suggestedPath,
    patch: row.patch,
    rationale: row.rationale,
    model: row.model,
    provider: row.provider,
    tokens: { input: row.inputTokens, output: row.outputTokens },
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

async function prune(options: TestProposalOptions, projectId: string): Promise<void> {
  const scope = and(
    eq(testProposals.workspaceId, options.workspaceId),
    eq(testProposals.projectId, projectId),
  );
  const keep = options.db
    .select({ id: testProposals.id })
    .from(testProposals)
    .where(scope)
    .orderBy(desc(testProposals.createdAt), desc(testProposals.id))
    .limit(TEST_PROPOSAL_RETENTION);
  await options.db.delete(testProposals).where(and(scope, notInArray(testProposals.id, keep)));
}

/** Asks the model for a test and stores the proposal. Never applies it. */
export async function proposeTest(
  options: TestProposalOptions,
  projectId: string,
  body: TestProposalBody,
  actor: string,
): Promise<TestProposal> {
  const gateway = options.gateway;
  if (gateway === null || options.provider === null) {
    throw new DomainError(
      ErrorCode.NOT_CONFIGURED,
      'No model provider is configured, so no test can be proposed. Set KILO_GATEWAY_URL and KILO_API_KEY, or OLLAMA_BASE_URL.',
      { callerSafe: true },
    );
  }
  const project = await projectRow(options, projectId);
  const evidence =
    body.kind === 'surviving-mutant'
      ? await mutantEvidence(options, project.id, body.findingId)
      : await uncoveredEvidence(options, project.id, body.commit.toLowerCase(), body.path);
  const framework = frameworkFor(evidence.path, body.testFramework);
  const target = suggestedTestPath(evidence.path);
  const model = await chooseModel(options, gateway);
  const answer = await complete(
    gateway,
    model,
    promptFor(evidence, framework, target, body.sourceSnippet),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const extracted = extractCodeBlock(answer.text);
  const patch = extracted === null ? '' : newFilePatch(target, extracted.code);
  if (
    extracted === null ||
    extracted.code.length > MAX_PROPOSED_TEST ||
    patch.length > MAX_PROPOSAL_PATCH
  ) {
    throw new DomainError(
      ErrorCode.MODEL_OUTPUT_UNUSABLE,
      extracted === null
        ? 'The model answered without a fenced code block, so there is no test to propose'
        : 'The proposed test is larger than the proposal limit',
      { callerSafe: true, details: { model } },
    );
  }
  const [row] = await options.db
    .insert(testProposals)
    .values({
      workspaceId: options.workspaceId,
      projectId: project.id,
      kind: evidence.kind,
      findingId: evidence.findingId,
      commitSha: evidence.commit,
      path: evidence.path,
      testFramework: framework,
      suggestedPath: target,
      patch,
      rationale: extracted.rationale.slice(0, RATIONALE_MAX),
      model,
      provider: options.provider,
      inputTokens: answer.inputTokens,
      outputTokens: answer.outputTokens,
      createdBy: actor,
      createdAt: options.now?.() ?? new Date(),
    })
    .returning();
  await prune(options, project.id);
  return proposalOf(row as TestProposalRow);
}

/** The project's stored proposals, newest first. */
export async function listTestProposals(
  options: HealthStoreOptions,
  projectId: string,
  limit = TEST_PROPOSAL_RETENTION,
): Promise<TestProposal[]> {
  const project = await projectRow(options, projectId);
  const rows = await options.db
    .select()
    .from(testProposals)
    .where(
      and(
        eq(testProposals.workspaceId, options.workspaceId),
        eq(testProposals.projectId, project.id),
      ),
    )
    .orderBy(desc(testProposals.createdAt), desc(testProposals.id))
    .limit(Math.min(Math.max(limit, 1), TEST_PROPOSAL_RETENTION));
  return rows.map(proposalOf);
}
