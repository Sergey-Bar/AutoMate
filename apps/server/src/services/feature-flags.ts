import type { FastifyReply, FastifyRequest } from 'fastify';

export type FeatureFlagName =
  | 'mcp-client'
  // Unified platform integration — default OFF
  | 'dashboard-connector'
  | 'unified-health'
  // v2.2+ OSS integrations — default OFF
  | 'openapi-parsing'
  | 'contract-test-gen'
  | 'ai-test-gen'
  | 'ai-test-gen-v2'
  | 'postman-import'
  // v2.3+ multi-provider support — default OFF
  | 'multi-provider'
  // v2.4+ quality gate orchestration via MCP — default OFF
  | 'quality-gate-orchestration'
  // Unified auth gateway — default OFF
  | 'unified-auth'
  // v2.5+ AI-powered triage for failed test runs — default OFF
  | 'ai-triage';

const FLAG_DEFAULTS: Record<FeatureFlagName, boolean> = {
  'mcp-client': false,
  // Unified platform integration — default OFF
  'dashboard-connector': false,
  'unified-health': false,
  // v2.2+ OSS integrations — default OFF
  'openapi-parsing': false,
  'contract-test-gen': false,
  'ai-test-gen': false,
  'ai-test-gen-v2': false,
  'postman-import': false,
  // v2.3+ multi-provider support — default OFF
  'multi-provider': false,
  // v2.4+ quality gate orchestration via MCP — default OFF
  'quality-gate-orchestration': false,
  // Unified auth gateway — default OFF
  'unified-auth': false,
  // v2.5+ AI-powered triage for failed test runs — default OFF
  'ai-triage': false,
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

export function getFeatureFlags(): Record<FeatureFlagName, boolean> {
  const result = {} as Record<FeatureFlagName, boolean>;
  for (const flag of Object.keys(FLAG_DEFAULTS) as FeatureFlagName[]) {
    result[flag] = resolveFlag(flag);
  }
  return result;
}

export function isEnabled(flag: FeatureFlagName): boolean {
  if (!(flag in FLAG_DEFAULTS)) return false;
  return resolveFlag(flag);
}

export function requireFeature(flag: FeatureFlagName) {
  return async (_req: FastifyRequest, reply: FastifyReply) => {
    // NOTE: Feature gate checks are bypassed in test environment (VITEST/VITEST_WORKER_ID set)
    // to allow testing gated routes. This means feature gates are never tested in unit tests.
    // Integration/E2E tests with a real server instance WILL enforce gates.
    if (process.env.NODE_ENV === 'test') return;
    if (!isEnabled(flag)) {
      return reply.status(404).send({ error: `Feature '${flag}' is not enabled` });
    }
  };
}
