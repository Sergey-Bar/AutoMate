import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const EXPECTED_VERSION = '1.1.0' as const;
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
  'dashboard-contract-v1-snapshot.json',
);

interface ContractFixture {
  version: string;
  tools: Record<string, { inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown> }>;
  errorCodes: string[];
}

function loadFixture(): ContractFixture {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as ContractFixture;
}

function validateFixtureShape(fixture: ContractFixture) {
  expect(typeof fixture).toBe('object');
  expect(fixture).toHaveProperty('version');
  expect(fixture).toHaveProperty('tools');
  expect(fixture).toHaveProperty('errorCodes');
  expect(Array.isArray(fixture.errorCodes)).toBe(true);
}

function assertExpectedToolNames(toolNames: string[]) {
  const sortedCurrent = [...toolNames].sort();
  const sortedExpected = [...EXPECTED_TOOL_NAMES].sort();
  expect(sortedCurrent).toEqual(sortedExpected);
}

describe('dashboard MCP contract fixture compatibility', () => {
  it('is parseable and version-pinned', () => {
    const fixture = loadFixture();
    validateFixtureShape(fixture);
    expect(fixture.version).toBe(EXPECTED_VERSION);
  });

  it('matches the v1 read-only tool allowlist exactly', () => {
    const fixture = loadFixture();
    const toolNames = Object.keys(fixture.tools);

    assertExpectedToolNames(toolNames);

    const mutatingVerbPattern = /(create|update|delete|remove|write|mutate|patch|set|insert|upsert)/i;
    for (const toolName of toolNames) {
      expect(mutatingVerbPattern.test(toolName)).toBe(false);
    }
  });

  it('fails validation if fixture drifts from expected allowlist/version', () => {
    const fixture = loadFixture();
    const drifted = {
      ...fixture,
      version: '1.0.1',
      tools: {
        ...fixture.tools,
        'runs.list_recent': {
          ...fixture.tools['runs.list_recent'],
          outputSchema: {
            ...fixture.tools['runs.list_recent'].outputSchema,
            properties: {
              ...((fixture.tools['runs.list_recent'].outputSchema.properties as Record<string, unknown>) ?? {}),
              extraField: { type: 'string' },
            },
          },
        },
      },
    };

    expect(() => {
      expect(drifted.version).toBe(EXPECTED_VERSION);
    }).toThrowError();

    expect(() => {
      assertExpectedToolNames(Object.keys({ ...drifted.tools, 'tests.write_results': { inputSchema: {}, outputSchema: {} } }));
    }).toThrowError();
  });
});
