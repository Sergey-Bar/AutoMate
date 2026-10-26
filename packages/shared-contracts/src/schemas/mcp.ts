import { z } from 'zod/v4';
import { AgentRuntimeReportSchema, ProjectEvalsSchema } from './agent-quality.js';
import { HealthFindingSchema, HealthGradeSchema } from './health.js';
import { DiffCoverageRecordSchema } from './supply-chain.js';

/**
 * The read-only MCP server (`/api/v1/mcp`, and the stdio proxy in front of it).
 *
 * Every tool answers with an existing contract, parsed before it is serialised; the two
 * shapes below exist because their routes answered without a named contract until the MCP
 * server needed one to parse against.
 */

/** Every tool the server lists. All of them read; none of them writes. */
export const MCP_TOOL_NAMES = [
  'list_projects',
  'get_health',
  'list_findings',
  'get_gate',
  'get_delivery',
  'get_agent_quality',
  'get_ai_code',
  'get_supply_chain',
  'get_test_effectiveness',
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/** `GET /api/v1/projects/:id/health/gate?branch=&commit=` */
export const HealthGateResponseSchema = z.object({
  branch: z.string().min(1),
  verdict: z.enum(['passed', 'failed']),
  reasons: z.array(z.string().min(1)).readonly(),
  newFindings: z.object({
    critical: z.number().int().min(0),
    high: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
  grade: HealthGradeSchema,
  /** The findings the branch has that the default branch does not. */
  added: z.array(HealthFindingSchema).readonly(),
  diffCoverage: DiffCoverageRecordSchema.nullable(),
});
export type HealthGateResponse = z.infer<typeof HealthGateResponseSchema>;

/** The `get_agent_quality` tool: the eval suites on a branch and the runtime over a window. */
export const AgentQualitySnapshotSchema = z.object({
  evals: ProjectEvalsSchema,
  runtime: AgentRuntimeReportSchema,
});
export type AgentQualitySnapshot = z.infer<typeof AgentQualitySnapshotSchema>;
