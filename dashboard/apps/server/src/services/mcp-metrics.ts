export interface McpMetrics {
  totalCalls: number;
  totalDenials: number;
  totalErrors: number;
  callsByTool: Record<string, number>;
  latencies: number[];
}

export class McpMetricsCollector {
  private metrics: McpMetrics;
  private readonly maxLatencyBuffer: number;

  constructor(maxLatencyBuffer: number = 1000) {
    this.maxLatencyBuffer = maxLatencyBuffer;
    this.metrics = {
      totalCalls: 0,
      totalDenials: 0,
      totalErrors: 0,
      callsByTool: {},
      latencies: [],
    };
  }

  recordCall(tool: string, durationMs: number): void {
    this.metrics.totalCalls += 1;
    this.metrics.callsByTool[tool] = (this.metrics.callsByTool[tool] ?? 0) + 1;
    this.metrics.latencies.push(durationMs);

    if (this.metrics.latencies.length > this.maxLatencyBuffer) {
      this.metrics.latencies.splice(0, this.metrics.latencies.length - this.maxLatencyBuffer);
    }
  }

  recordDenial(): void {
    this.metrics.totalDenials += 1;
  }

  recordError(): void {
    this.metrics.totalErrors += 1;
  }

  getMetrics(): Readonly<McpMetrics> {
    return {
      ...this.metrics,
      callsByTool: { ...this.metrics.callsByTool },
      latencies: [...this.metrics.latencies],
    };
  }

  getP95Latency(): number | null {
    if (this.metrics.latencies.length === 0) {
      return null;
    }

    const sorted = [...this.metrics.latencies].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[Math.max(0, index)] ?? null;
  }

  reset(): void {
    this.metrics = {
      totalCalls: 0,
      totalDenials: 0,
      totalErrors: 0,
      callsByTool: {},
      latencies: [],
    };
  }
}
