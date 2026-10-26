import { z } from 'zod/v4';
import {
  AgentQualitySnapshotSchema,
  AiCodeReportSchema,
  DeliveryReportSchema,
  FINDING_SEVERITIES,
  FINDING_STATES,
  HEALTH_DIMENSIONS,
  HealthFindingsPageSchema,
  HealthGateResponseSchema,
  PortfolioSchema,
  ProjectHealthSchema,
  ScorecardSchema,
  type McpToolName,
  type Scorecard,
} from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { aiCodeReport } from '../services/ai-code-service.js';
import { deliveryReport } from '../services/delivery-service.js';
import { projectEvals } from '../services/eval-service.js';
import { projectAgentRuntime } from '../services/genai-span-service.js';
import {
  healthGate,
  listFindings,
  portfolio,
  projectHealth,
  type RepoHealthOptions,
} from '../services/repo-health-service.js';
import {
  supplyChainScorecardFor,
  testEffectivenessScorecardFor,
  type ScorecardOptions,
} from '../services/scorecard-service.js';

/**
 * The read-only tools the MCP server lists, each one a service the dashboard already reads.
 *
 * ## What a tool may see
 *
 * `scope.health` is bound to the caller's workspace by the composition root — the same
 * options every health route reads — so a tool can only answer about that workspace's
 * projects, and another workspace's project id is "no such project". A caller pinned to one
 * project (`pinned`) is refused every other project before any read, and `list_projects`
 * lists only its own.
 *
 * ## What a tool answers
 *
 * Every answer is parsed against its contract before it leaves, then serialised as JSON text
 * beside a one-line summary an assistant can quote. Nothing here writes: a tool that changed
 * state would make every connected editor a writer, and the role a viewer token carries says
 * it is not one.
 */
export interface McpScope {
  health: RepoHealthOptions;
  history?: ScorecardOptions['history'];
  /** Set for a caller pinned to one project: the only project it may read. */
  pinned: string | null;
}

export interface ToolAnswer {
  summary: string;
  /** Already parsed against the tool's contract. */
  value: unknown;
}

export interface McpTool {
  name: McpToolName;
  title: string;
  description: string;
  input: z.ZodRawShape;
  run(scope: McpScope, args: unknown): Promise<ToolAnswer>;
}

const ProjectId = z.string().uuid().describe('The project id, from list_projects.');
const Branch = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .optional()
  .describe("A branch; the project's default branch when omitted.");
const Days = (fallback: number) =>
  z.number().int().min(1).max(365).default(fallback).describe('The window, in days.');

/** The project a tool may read: refused before any read when the caller is pinned elsewhere. */
function allowed(scope: McpScope, projectId: string): string {
  if (scope.pinned !== null && scope.pinned !== projectId) {
    throw new DomainError(ErrorCode.FORBIDDEN, 'This token is pinned to another project');
  }
  return projectId;
}

function scorecardSummary(card: Scorecard): string {
  const score = card.score === null ? 'no score' : `${card.score.toFixed(0)} / 100`;
  const capped = card.cappedBy === null ? '' : `, limited by ${card.cappedBy}`;
  const why = card.reasons.length === 0 ? '' : ` — ${card.reasons[0] ?? ''}`;
  return `${card.title}: ${card.status}, ${score}${capped}${why}`;
}

/** A tool over one project: the input always carries `projectId`, checked against the pin. */
function projectTool<S extends z.ZodRawShape & { projectId: typeof ProjectId }>(
  spec: Omit<McpTool, 'input' | 'run'> & {
    input: S;
    answer: (scope: McpScope, args: z.infer<z.ZodObject<S>>) => Promise<ToolAnswer>;
  },
): McpTool {
  const schema = z.object(spec.input);
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    input: spec.input,
    run: async (scope, args) => {
      const parsed = schema.parse(args);
      allowed(scope, (parsed as { projectId: string }).projectId);
      return spec.answer(scope, parsed);
    },
  };
}

const listProjects: McpTool = {
  name: 'list_projects',
  title: 'List projects',
  description:
    'Every project this token can read, with its grade, what limits it, and its weakest dimension. Start here to find a project id.',
  input: {},
  run: async (scope) => {
    const all = await portfolio(scope.health);
    const value = PortfolioSchema.parse({
      projects: all.projects.filter(
        (project) => scope.pinned === null || project.projectId === scope.pinned,
      ),
    });
    return { summary: `${String(value.projects.length)} project(s).`, value };
  },
};

const getHealth = projectTool({
  name: 'get_health',
  title: 'Repository health',
  description:
    'The grade of one project on a branch: the score and letter, what limits it, all twelve dimensions, the three hard gates, and what to fix next.',
  input: { projectId: ProjectId, branch: Branch },
  answer: async (scope, args) => {
    const value = ProjectHealthSchema.parse(
      await projectHealth(scope.health, args.projectId, args.branch),
    );
    const { grade } = value;
    const letter = grade.letter ?? 'incomplete';
    const score = grade.score === null ? '' : ` (${grade.score.toFixed(0)} / 100)`;
    return {
      summary: `${value.name} on ${value.branch}: ${letter}${score} — ${grade.limiter ?? grade.incompleteReason ?? 'no limiter'}`,
      value,
    };
  },
});

const listFindingsTool = projectTool({
  name: 'list_findings',
  title: 'List findings',
  description:
    'Findings of one project on a branch, most severe first, filterable by dimension, severity, state, tool and text.',
  input: {
    projectId: ProjectId,
    branch: Branch,
    dimension: z.enum(HEALTH_DIMENSIONS).optional(),
    severity: z.enum(FINDING_SEVERITIES).optional(),
    state: z.enum(FINDING_STATES).optional(),
    tool: z.string().min(1).max(100).optional(),
    q: z.string().max(200).optional().describe('Text the message or path contains.'),
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0),
  },
  answer: async (scope, args) => {
    const { projectId, ...filters } = args;
    const value = HealthFindingsPageSchema.parse(
      await listFindings(scope.health, projectId, filters),
    );
    return {
      summary: `${String(value.total)} finding(s) match; ${String(value.findings.length)} shown from ${String(value.offset)}.`,
      value,
    };
  },
});

const getGate = projectTool({
  name: 'get_gate',
  title: 'Pull-request gate',
  description:
    'Whether a branch passes the pull-request gate: the verdict, every reason, the findings it adds over the default branch, and the diff coverage of the commit.',
  input: {
    projectId: ProjectId,
    branch: z.string().trim().min(1).max(255).describe('The branch to gate.'),
    commit: z
      .string()
      .regex(/^[0-9a-f]{7,64}$/iu)
      .optional()
      .describe('The commit whose diff coverage and eval runs the gate reads.'),
    pullRequest: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'The pull request, so the AI-governance rules are evaluated as on the gate report.',
      ),
  },
  answer: async (scope, args) => {
    const result = await healthGate(
      scope.health,
      args.projectId,
      args.branch,
      args.commit,
      args.pullRequest,
    );
    const value = HealthGateResponseSchema.parse({
      branch: result.branch,
      ...result.verdict,
      grade: result.grade,
      added: result.added,
      diffCoverage: result.diffCoverage,
    });
    const why = value.reasons.length === 0 ? '' : ` — ${value.reasons.join('; ')}`;
    return { summary: `Gate ${value.verdict} on ${value.branch}${why}`, value };
  },
});

const getDelivery = projectTool({
  name: 'get_delivery',
  title: 'Delivery performance',
  description:
    'DORA and pull-request flow for one project over a window: deployment frequency, lead time, change failure rate, recovery time, review latency and stale work.',
  input: { projectId: ProjectId, days: Days(30) },
  answer: async (scope, args) => {
    const value = DeliveryReportSchema.parse(
      await deliveryReport(scope.health, args.projectId, args.days),
    );
    return {
      summary: `${scorecardSummary(value.dora)}. ${scorecardSummary(value.flow)}.`,
      value,
    };
  },
});

const getAgentQuality = projectTool({
  name: 'get_agent_quality',
  title: 'Agent quality',
  description:
    'Eval suites on a branch against the default branch, and agent runtime (cost, tokens, tool failures) over a window.',
  input: { projectId: ProjectId, branch: Branch, days: Days(7) },
  answer: async (scope, args) => {
    const [evals, runtime] = await Promise.all([
      projectEvals(scope.health, args.projectId, args.branch),
      projectAgentRuntime(scope.health, args.projectId, args.days),
    ]);
    const value = AgentQualitySnapshotSchema.parse({ evals, runtime });
    return {
      summary: `${String(value.evals.suites.length)} eval suite(s) on ${value.evals.branch}. ${scorecardSummary(value.runtime.scorecard)}.`,
      value,
    };
  },
});

const getAiCode = projectTool({
  name: 'get_ai_code',
  title: 'AI-written code',
  description:
    'How much merged change was agent-authored or AI-assisted, and whether it fares worse than human change, over a window. Never names a person.',
  input: { projectId: ProjectId, days: Days(90) },
  answer: async (scope, args) => {
    const value = AiCodeReportSchema.parse(
      await aiCodeReport(scope.health, args.projectId, args.days),
    );
    return { summary: `${scorecardSummary(value.scorecard)}.`, value };
  },
});

const getSupplyChain = projectTool({
  name: 'get_supply_chain',
  title: 'Supply chain',
  description:
    'The supply-chain scorecard: SLSA build level, licence violations, fixable critical vulnerabilities, open vulnerable components, VEX coverage and SBOM age.',
  input: { projectId: ProjectId, branch: Branch },
  answer: async (scope, args) => {
    const value = ScorecardSchema.parse(
      await supplyChainScorecardFor(scope.health, args.projectId, args.branch),
    );
    return { summary: `${scorecardSummary(value)}.`, value };
  },
});

const getTestEffectiveness = projectTool({
  name: 'get_test_effectiveness',
  title: 'Test effectiveness',
  description:
    'The test-effectiveness scorecard: mutation score, diff coverage of the latest commits, flaky tests and their cost, and distinct failure causes.',
  input: { projectId: ProjectId, branch: Branch },
  answer: async (scope, args) => {
    const value = ScorecardSchema.parse(
      await testEffectivenessScorecardFor(
        { ...scope.health, ...(scope.history === undefined ? {} : { history: scope.history }) },
        args.projectId,
        args.branch,
      ),
    );
    return { summary: `${scorecardSummary(value)}.`, value };
  },
});

export const MCP_TOOLS: readonly McpTool[] = [
  listProjects,
  getHealth,
  listFindingsTool,
  getGate,
  getDelivery,
  getAgentQuality,
  getAiCode,
  getSupplyChain,
  getTestEffectiveness,
];
