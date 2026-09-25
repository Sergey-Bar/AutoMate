export const MCP_V1_TOOL_ALLOWLIST = [
  'runs.list_recent',
  'runs.get_summary_by_id',
  'tests.get_failures_by_run',
  'analytics.get_pass_rate',
  'analytics.get_duration_trend',
  'tests.get_error_clusters',
  'tests.get_predictive_candidates',
  'quarantine.list_quarantined',
  'quarantine.get_details',
  'runs.compare',
  'tests.get_flaky',
  'schedules.list',
  'schedules.get_by_id',
  'integrations.get_status',
  'runs.get_gate_status',
] as const;

const ALLOWLIST_SET = new Set<string>(MCP_V1_TOOL_ALLOWLIST);

export function isToolAllowed(toolName: string): boolean {
  return ALLOWLIST_SET.has(toolName);
}

type ToolWithName = { name: string };

export function filterAllowedTools<T extends ToolWithName>(tools: T[]): { allowed: T[]; denied: string[] } {
  const allowed: T[] = [];
  const denied: string[] = [];

  for (const tool of tools) {
    if (isToolAllowed(tool.name)) {
      allowed.push(tool);
      continue;
    }
    denied.push(tool.name);
  }

  return { allowed, denied };
}
