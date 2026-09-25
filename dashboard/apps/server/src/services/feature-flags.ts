/**
 * feature-flags.ts — Server-side feature flag registry
 *
 * Flags are defined with MVP-first defaults. Override via env vars:
 *   FEATURE_AUTO_QUARANTINE=true  →  enables post-MVP auto-quarantine
 *
 * Convention: flag name "auto-quarantine" → env var "FEATURE_AUTO_QUARANTINE"
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

export type FeatureFlagName =
  | 'live-run-monitoring'
  | 'test-explorer'
  | 'analytics-dashboard'
  | 'artifact-viewers'
  | 'run-comparison'
  | 'integration-hooks'
  | 'command-palette'
  | 'quality-gate'
  // Unified platform integration — post-MVP, default OFF
  | 'external-trigger'
  | 'result-callback'
  // post-MVP intelligence/workflow features — default OFF
  | 'auto-quarantine'
  | 'nl-query'
  | 'error-clustering'
  | 'impact-analysis'
  | 'ai-explain'
  | 'scheduled-runs'
  | 'codegen-launcher'
  | 'pr-comparison'
  | 'baseline-management'
  | 'known-failure-tracking'
  | 'terminal-runner'
  // post-MVP intelligence features — default OFF
  | 'mcp-server'
  | 'mcp-gateway'
  | 'mcp-playwright'
  | 'failure-taxonomy'
  | 'predictive-test-selection'
  | 'role-based-views'
  | 'locator-intelligence'
  | 'test-generation'
  // post-MVP OSS integrations — default OFF
  | 'screenshot-diff'
  | 'looks-same-diff'
  | 'spec-aware-triage'
  | 'frequent-failures'
  | 'checks-annotations'
  // post-MVP enterprise features — default OFF
  | 'rbac'
  | 'cross-run-clusters'
  | 'risk-scoring'
  | 'audit-trail'
  | 'per-workspace-gates'
  | 'quarantine-approval'
  | 'roi-metrics'
  | 'sso'
  // Unified auth gateway — default OFF
  | 'unified-auth'
  // AI-only QA platform features — post-MVP, default OFF
  | 'agent-tracking'
  | 'ai-test-gen-v2'
  | 'agent-repair'
  | 'multi-agent-awareness';

/** Default flag states — MVP workflow is ON, everything post-MVP is OFF */
const FLAG_DEFAULTS: Record<FeatureFlagName, boolean> = {
  'live-run-monitoring': true,
  'test-explorer': true,
  'analytics-dashboard': true,
  'artifact-viewers': true,
  'run-comparison': false,
  'integration-hooks': false,
  'command-palette': false,
  'quality-gate': true,
  // Unified platform integration — post-MVP, default OFF
  'external-trigger': false,
  'result-callback': false,
  // Post-MVP workflow/intelligence features — available by opt-in only
  'auto-quarantine': false,
  'nl-query': false,
  'error-clustering': false,
  'impact-analysis': false,
  'ai-explain': false,
  'scheduled-runs': false,
  'codegen-launcher': false,
  'pr-comparison': false,
  'baseline-management': false,
  'known-failure-tracking': false,
  'terminal-runner': false,
  // Post-MVP intelligence features — available by opt-in only
  'mcp-server': false,
  'mcp-gateway': false,
  'mcp-playwright': false,
  'failure-taxonomy': true,
  'predictive-test-selection': true,
  'role-based-views': false,
  'locator-intelligence': true,
  'test-generation': false,
  // Post-MVP OSS integrations — available by opt-in only
  'screenshot-diff': false,
  'looks-same-diff': false,
  'spec-aware-triage': false,
  'frequent-failures': false,
  'checks-annotations': false,
  // Post-MVP enterprise features — available by opt-in only
  'rbac': false,
  'cross-run-clusters': false,
  'risk-scoring': false,
  'audit-trail': false,
  'per-workspace-gates': false,
  'quarantine-approval': false,
  'roi-metrics': false,
  'sso': false,
  // Unified auth gateway — default OFF
  'unified-auth': false,
  // v1 AI-Only QA Platform — default OFF (experimental)
  'agent-tracking': false,
  'ai-test-gen-v2': false,
  'agent-repair': false,
  'multi-agent-awareness': false,
};

function flagToEnvVar(flag: FeatureFlagName): string {
  return `FEATURE_${flag.toUpperCase().replace(/-/g, '_')}`;
}

function resolveFlag(flag: FeatureFlagName): boolean {
  const envVal = process.env[flagToEnvVar(flag)];
  if (envVal === 'true' || envVal === '1') return true;
  if (envVal === 'false' || envVal === '0') return false;
  return FLAG_DEFAULTS[flag];
}

/** Get all feature flags with their resolved values */
export function getFeatureFlags(): Record<FeatureFlagName, boolean> {
  const result = {} as Record<FeatureFlagName, boolean>;
  for (const flag of Object.keys(FLAG_DEFAULTS) as FeatureFlagName[]) {
    result[flag] = resolveFlag(flag);
  }
  return result;
}

/** Check if a specific feature is enabled */
export function isEnabled(flag: FeatureFlagName): boolean {
  if (!(flag in FLAG_DEFAULTS)) return false;
  return resolveFlag(flag);
}

/** Fastify preHandler hook that returns 404 when a feature is disabled */
export function requireFeature(flag: FeatureFlagName) {
  return async (_req: FastifyRequest, reply: FastifyReply) => {
    if (process.env.NODE_ENV === 'test') return;
    if (!isEnabled(flag)) {
      return reply.status(404).send({ error: `Feature '${flag}' is not enabled` });
    }
  };
}
