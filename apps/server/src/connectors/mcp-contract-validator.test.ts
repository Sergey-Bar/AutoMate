import { describe, expect, it } from 'vitest';
import { validateDiscoveredToolsAgainstContract } from './mcp-contract-validator.js';

const CONTRACT_TOOL_NAMES = [
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

function buildDiscovered(toolNames: readonly string[]) {
  return toolNames.map((name) => ({ name }));
}

describe('validateDiscoveredToolsAgainstContract', () => {
  it('passes when discovered tools and version exactly match locked contract', () => {
    const result = validateDiscoveredToolsAgainstContract(buildDiscovered(CONTRACT_TOOL_NAMES), {
      discoveredContractVersion: '1.1.0',
    });

    expect(result.valid).toBe(true);
    expect(result.contractVersion).toBe('1.1.0');
    expect(result.mismatches).toEqual([]);
    expect(result.newTools).toEqual([]);
    expect(result.diagnostics).toContain('passed');
    expect(result.validatedAt.length).toBeGreaterThan(0);
  });

  it('does NOT fail validation when discovered tools include unknown names (stale snapshot — soft warning)', () => {
    const result = validateDiscoveredToolsAgainstContract(
      buildDiscovered([...CONTRACT_TOOL_NAMES, 'tests.unknown_tool']),
      { discoveredContractVersion: '1.1.0' },
    );

    // New tools surfaced in newTools, NOT a hard failure
    expect(result.valid).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.newTools).toContain('tests.unknown_tool');
    expect(result.diagnostics).toContain('passed');
  });

  it('fails when discovered tools are missing required contract tools', () => {
    const partialTools = CONTRACT_TOOL_NAMES.slice(0, 6);
    const result = validateDiscoveredToolsAgainstContract(buildDiscovered(partialTools), {
      discoveredContractVersion: '1.1.0',
    });

    expect(result.valid).toBe(false);
    expect(result.mismatches.some((item) => item.includes('missing tools'))).toBe(true);
    expect(result.diagnostics).toContain('tests.get_predictive_candidates');
  });

  it('fails when discovered version drifts from locked version', () => {
    const result = validateDiscoveredToolsAgainstContract(buildDiscovered(CONTRACT_TOOL_NAMES), {
      discoveredContractVersion: '1.1.1',
    });

    expect(result.valid).toBe(false);
    expect(result.mismatches).toContain(
      'discovered contract version mismatch: expected 1.1.0, got 1.1.1',
    );
  });
});
