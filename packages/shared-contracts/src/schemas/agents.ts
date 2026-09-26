/**
 * Agents domain schemas — Zod v4
 *
 * Contracts for the Automate AI Agent Framework (Product 3).
 * Covers the 5 agent domains (browser, api, load, security, mobile),
 * agent request/result, and the NotImplemented sentinel type.
 *
 * Agent endpoints: POST /agents/{domain}/generate | /agents/{domain}/run
 * Unified result schema aligned with PRD §7.4.
 */
import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// AgentDomain
// ---------------------------------------------------------------------------

export const AgentDomainSchema = z.enum(['browser', 'api', 'load', 'security', 'mobile']);
export type AgentDomain = z.infer<typeof AgentDomainSchema>;

// ---------------------------------------------------------------------------
// AgentRequest
// ---------------------------------------------------------------------------

export const AgentRequestSchema = z.object({
  domain: AgentDomainSchema,
  action: z.enum(['generate', 'run', 'scan']),
  prompt: z.string().optional(),
  specPath: z.string().optional(),
  targetUrl: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type AgentRequest = z.infer<typeof AgentRequestSchema>;

// ---------------------------------------------------------------------------
// AgentTestItem (individual test inside a result)
// ---------------------------------------------------------------------------

export const AgentTestItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['passed', 'failed', 'skipped', 'error']),
  durationMs: z.number().int().min(0).optional(),
});
export type AgentTestItem = z.infer<typeof AgentTestItemSchema>;

// ---------------------------------------------------------------------------
// AgentArtifacts
// ---------------------------------------------------------------------------

export const AgentArtifactsSchema = z.object({
  allureResultsPath: z.string().optional(),
  screenshots: z.array(z.string()).optional(),
  rawOutputPath: z.string().optional(),
});
export type AgentArtifacts = z.infer<typeof AgentArtifactsSchema>;

// ---------------------------------------------------------------------------
// AgentResult  (PRD §7.4 unified result schema)
// ---------------------------------------------------------------------------

export const AgentResultSchema = z.object({
  runId: z.string(),
  agent: AgentDomainSchema,
  status: z.enum(['passed', 'failed', 'error']),
  startedAt: z.string(),
  durationMs: z.number().int().min(0),
  summary: z.object({
    total: z.number().int().min(0),
    passed: z.number().int().min(0),
    failed: z.number().int().min(0),
    skipped: z.number().int().min(0),
  }),
  aiNarrative: z.string().optional(),
  tests: z.array(AgentTestItemSchema).optional(),
  artifacts: AgentArtifactsSchema.optional(),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;

// ---------------------------------------------------------------------------
// AgentNotImplemented  (sentinel for unimplemented domain handlers)
// ---------------------------------------------------------------------------

export const AgentNotImplementedSchema = z.object({
  domain: AgentDomainSchema,
  implemented: z.literal(false),
  message: z.string(),
});
export type AgentNotImplemented = z.infer<typeof AgentNotImplementedSchema>;
