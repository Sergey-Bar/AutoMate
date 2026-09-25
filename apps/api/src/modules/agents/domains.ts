/**
 * domains.ts — Agent domain type definitions and NotImplemented handler
 *
 * Defines the 5 PRD-aligned agent domains and the typed response shapes
 * used across all agent routes.
 *
 * PRD domains: browser, api, load, security, mobile
 */
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// AgentDomain
// ---------------------------------------------------------------------------

export type AgentDomain = 'browser' | 'api' | 'load' | 'security' | 'mobile';

export const AGENT_DOMAINS: readonly AgentDomain[] = [
  'browser',
  'api',
  'load',
  'security',
  'mobile',
];

// ---------------------------------------------------------------------------
// AgentResult — unified response shape for all agent endpoints
// ---------------------------------------------------------------------------

export interface AgentResult {
  domain: AgentDomain;
  status: 'completed' | 'queued' | 'not_implemented';
  result?: unknown;
  error?: string;
}

export interface AgentRunRequest {
  objective: string;
  target?: string;
  constraints?: string[];
}

export interface AgentExecutionArtifact {
  runId: string;
  objective: string;
  target: string | null;
  plan: string[];
  output: string;
  generatedAt: string;
}

const DOMAIN_OUTPUTS: Record<Exclude<AgentDomain, 'browser'>, (request: AgentRunRequest) => AgentExecutionArtifact> = {
  api: (request) => ({
    runId: randomUUID(),
    objective: request.objective,
    target: request.target ?? null,
    plan: [
      'Validate API contract shape and required fields.',
      'Generate smoke request matrix for success and failure paths.',
      'Emit runnable HTTP checklist for CI verification.',
    ],
    output: [
      '### API Agent Execution',
      `Objective: ${request.objective}`,
      `Target: ${request.target ?? 'unspecified'}`,
      '',
      'Suggested smoke calls:',
      '- GET /health expects 200 and status=ok',
      '- POST endpoint with invalid payload expects 400',
      '- Auth-guarded endpoint without token expects 401',
    ].join('\n'),
    generatedAt: new Date().toISOString(),
  }),
  load: (request) => ({
    runId: randomUUID(),
    objective: request.objective,
    target: request.target ?? null,
    plan: [
      'Define baseline scenario profile for k6 execution.',
      'Create staged load curve and SLA thresholds.',
      'Return ready-to-run command and pass/fail criteria.',
    ],
    output: [
      '### Load Agent Execution',
      `Objective: ${request.objective}`,
      `Target: ${request.target ?? 'unspecified'}`,
      '',
      'k6 baseline:',
      '- vus: 10, duration: 60s',
      '- threshold: p(95)<500ms, error_rate<1%',
      '- command: k6 run perf/automate-smoke.js',
    ].join('\n'),
    generatedAt: new Date().toISOString(),
  }),
  security: (request) => ({
    runId: randomUUID(),
    objective: request.objective,
    target: request.target ?? null,
    plan: [
      'Build security checklist aligned to OWASP risks.',
      'Queue auth, injection, and secret-exposure probes.',
      'Return remediation-oriented findings template.',
    ],
    output: [
      '### Security Agent Execution',
      `Objective: ${request.objective}`,
      `Target: ${request.target ?? 'unspecified'}`,
      '',
      'Audit checklist:',
      '- Verify input validation at all API boundaries',
      '- Verify auth guards on protected endpoints',
      '- Verify no sensitive values are exposed in logs',
    ].join('\n'),
    generatedAt: new Date().toISOString(),
  }),
  mobile: (request) => ({
    runId: randomUUID(),
    objective: request.objective,
    target: request.target ?? null,
    plan: [
      'Define device matrix for Android/iOS coverage.',
      'Generate baseline interaction checklist for core user paths.',
      'Return execution notes for Appium session setup.',
    ],
    output: [
      '### Mobile Agent Execution',
      `Objective: ${request.objective}`,
      `Target: ${request.target ?? 'unspecified'}`,
      '',
      'Execution prep:',
      '- Ensure Appium server is running',
      '- Validate device availability and orientation',
      '- Execute smoke flow: launch -> auth -> primary action',
    ].join('\n'),
    generatedAt: new Date().toISOString(),
  }),
};

export function parseAgentRunRequest(raw: unknown): AgentRunRequest | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const objective = record['objective'];
  if (typeof objective !== 'string' || objective.trim().length === 0) {
    return null;
  }

  const target = typeof record['target'] === 'string' && record['target'].trim().length > 0
    ? record['target'].trim()
    : undefined;

  const constraints = Array.isArray(record['constraints'])
    ? record['constraints'].filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : undefined;

  return {
    objective: objective.trim(),
    target,
    constraints,
  };
}

export function runDomainAgent(
  domain: Exclude<AgentDomain, 'browser'>,
  request: AgentRunRequest,
): AgentResult {
  return {
    domain,
    status: 'completed',
    result: DOMAIN_OUTPUTS[domain](request),
  };
}
