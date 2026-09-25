import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  getMcpV1ContractSnapshot,
  MCP_CONTRACT_VERSION,
  MCP_V1_TOOL_NAMES,
} from './contract.js';

const EXPECTED_TOOL_NAMES = [
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

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'contract-v1-snapshot.json',
);

function loadSnapshotFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, unknown>;
}

function assertContractDriftFree(current: unknown, snapshot: unknown) {
  const currentJson = JSON.stringify(current, null, 2);
  const snapshotJson = JSON.stringify(snapshot, null, 2);

  if (currentJson !== snapshotJson) {
    throw new Error(
      [
        'MCP v1 contract drift detected between runtime contract and snapshot fixture.',
        'Update contract version and fixture intentionally when making breaking changes.',
        '',
        '--- CURRENT CONTRACT ---',
        currentJson,
        '',
        '--- SNAPSHOT FIXTURE ---',
        snapshotJson,
      ].join('\n'),
    );
  }
}

describe('mcp v1 contract', () => {
  it('pins the contract version and exact tool name allowlist', () => {
    expect(MCP_CONTRACT_VERSION).toBe('1.1.0');
    expect(MCP_V1_TOOL_NAMES).toEqual(EXPECTED_TOOL_NAMES);
  });

  it('matches the frozen snapshot fixture exactly', () => {
    const current = getMcpV1ContractSnapshot();
    const snapshot = loadSnapshotFixture();

    assertContractDriftFree(current, snapshot);
    expect(current).toEqual(snapshot);
  });

  it('exposes read-only tool names only', () => {
    const mutatingVerbPattern = /(create|update|delete|remove|write|mutate|patch|set|insert|upsert)/i;

    for (const toolName of MCP_V1_TOOL_NAMES) {
      expect(mutatingVerbPattern.test(toolName)).toBe(false);
    }
  });
});
