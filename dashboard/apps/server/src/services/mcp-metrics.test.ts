import { describe, expect, it } from 'vitest';
import { McpMetricsCollector } from './mcp-metrics.js';

describe('McpMetricsCollector', () => {
  it('recordCall increments totalCalls and callsByTool', () => {
    const collector = new McpMetricsCollector();

    collector.recordCall('getFailureTaxonomy', 20);
    collector.recordCall('getFailureTaxonomy', 40);
    collector.recordCall('getCorrelations', 10);

    const metrics = collector.getMetrics();
    expect(metrics.totalCalls).toBe(3);
    expect(metrics.callsByTool).toEqual({
      getFailureTaxonomy: 2,
      getCorrelations: 1,
    });
  });

  it('recordDenial increments totalDenials', () => {
    const collector = new McpMetricsCollector();

    collector.recordDenial();
    collector.recordDenial();

    expect(collector.getMetrics().totalDenials).toBe(2);
  });

  it('recordError increments totalErrors', () => {
    const collector = new McpMetricsCollector();

    collector.recordError();

    expect(collector.getMetrics().totalErrors).toBe(1);
  });

  it('getP95Latency returns the expected value', () => {
    const collector = new McpMetricsCollector();

    [5, 10, 20, 30, 40, 50, 60, 70, 80, 90].forEach((ms) => {
      collector.recordCall('tool', ms);
    });

    expect(collector.getP95Latency()).toBe(90);
  });

  it('reset clears all metrics', () => {
    const collector = new McpMetricsCollector();

    collector.recordCall('tool', 10);
    collector.recordDenial();
    collector.recordError();
    collector.reset();

    expect(collector.getMetrics()).toEqual({
      totalCalls: 0,
      totalDenials: 0,
      totalErrors: 0,
      callsByTool: {},
      latencies: [],
    });
    expect(collector.getP95Latency()).toBeNull();
  });

  it('latency buffer respects maxLatencyBuffer limit', () => {
    const collector = new McpMetricsCollector(3);

    collector.recordCall('tool', 10);
    collector.recordCall('tool', 20);
    collector.recordCall('tool', 30);
    collector.recordCall('tool', 40);

    expect(collector.getMetrics().latencies).toEqual([20, 30, 40]);
  });
});
