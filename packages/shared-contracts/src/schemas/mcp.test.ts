import { describe, expect, it } from 'vitest';
import { HealthGateResponseSchema, MCP_TOOL_NAMES } from './mcp.js';
import { DashboardAnalyticsSummarySchema } from './analytics-trend.js';

describe('the MCP contracts', () => {
  it('names nine tools, each once, and every one of them a read', () => {
    expect(MCP_TOOL_NAMES).toHaveLength(9);
    expect(new Set(MCP_TOOL_NAMES).size).toBe(MCP_TOOL_NAMES.length);
    for (const name of MCP_TOOL_NAMES) expect(name).toMatch(/^(get|list)_/u);
  });

  it('refuses a gate answer with a verdict the gate does not have', () => {
    const shape = HealthGateResponseSchema.shape.verdict;
    expect(shape.safeParse('passed').success).toBe(true);
    expect(shape.safeParse('warning').success).toBe(false);
  });
});

describe('DashboardAnalyticsSummarySchema', () => {
  it('reads no completed run as a null pass rate, never as a measured 0', () => {
    expect(
      DashboardAnalyticsSummarySchema.parse({ totalRuns: 3, passRate: null, avgDurationMs: null }),
    ).toEqual({ totalRuns: 3, passRate: null, avgDurationMs: null });
    expect(
      DashboardAnalyticsSummarySchema.safeParse({ totalRuns: 1, passRate: 101, avgDurationMs: 1 })
        .success,
    ).toBe(false);
  });
});
