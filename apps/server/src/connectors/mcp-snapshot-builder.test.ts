import { describe, expect, it } from 'vitest';
import { buildSnapshotFromDiscoveredTools } from '../../../../scripts/update-mcp-contract.js';

describe('buildSnapshotFromDiscoveredTools', () => {
  it('builds a valid snapshot from discovered tools using default options', () => {
    const tools = [
      { name: 'runs.list_recent', inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } } },
      { name: 'tests.get_failures_by_run', inputSchema: { type: 'object', required: ['runId'], properties: { runId: { type: 'string' } } } },
    ];

    const snapshot = buildSnapshotFromDiscoveredTools(tools);

    expect(snapshot.version).toBe('1.1.0');
    expect(Object.keys(snapshot.tools)).toEqual(['runs.list_recent', 'tests.get_failures_by_run']);
    expect(snapshot.tools['runs.list_recent']?.inputSchema).toEqual(tools[0]?.inputSchema);
    expect(snapshot.tools['runs.list_recent']?.outputSchema).toEqual({});
    expect(snapshot.errorCodes).toContain('UNAUTHORIZED');
    expect(snapshot.errorCodes).toContain('INTERNAL_ERROR');
  });

  it('uses custom version and errorCodes when provided', () => {
    const tools = [{ name: 'runs.list_recent', inputSchema: {} }];
    const snapshot = buildSnapshotFromDiscoveredTools(tools, {
      version: '2.0.0',
      errorCodes: ['CUSTOM_ERROR'],
    });

    expect(snapshot.version).toBe('2.0.0');
    expect(snapshot.errorCodes).toEqual(['CUSTOM_ERROR']);
  });

  it('produces an empty tools record for an empty tool list', () => {
    const snapshot = buildSnapshotFromDiscoveredTools([]);

    expect(snapshot.tools).toEqual({});
    expect(snapshot.version).toBe('1.1.0');
    expect(snapshot.errorCodes.length).toBeGreaterThan(0);
  });

  it('preserves inputSchema exactly as provided', () => {
    const complexSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
    };
    const tools = [{ name: 'runs.get_summary_by_id', inputSchema: complexSchema }];

    const snapshot = buildSnapshotFromDiscoveredTools(tools);

    expect(snapshot.tools['runs.get_summary_by_id']?.inputSchema).toEqual(complexSchema);
  });

  it('produces a JSON-serializable snapshot (valid fixture)', () => {
    const tools = [
      { name: 'analytics.get_pass_rate', inputSchema: { type: 'object', properties: { days: { type: 'integer' } } } },
    ];

    const snapshot = buildSnapshotFromDiscoveredTools(tools);
    const json = JSON.stringify(snapshot, null, 2);

    // Must be parseable
    const parsed = JSON.parse(json) as typeof snapshot;
    expect(parsed.version).toBe(snapshot.version);
    expect(Object.keys(parsed.tools)).toEqual(Object.keys(snapshot.tools));
  });
});
