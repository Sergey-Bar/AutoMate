import crypto from 'node:crypto';

export interface McpTelemetryEvent {
  correlationId: string;
  event: string;
  actor: string;
  source: string;
  tool?: string;
  durationMs?: number;
  statusCode?: number;
  result?: 'success' | 'error' | 'denied';
  reason?: string;
  timestamp: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function emitMcpTelemetry(event: McpTelemetryEvent): void {
  process.stdout.write(JSON.stringify(event) + '\n');
}

export function createMcpCorrelation(): string {
  return crypto.randomUUID();
}

export function buildAuthEvent(
  correlationId: string,
  actor: string,
  source: string,
  result: 'success' | 'denied',
  reason?: string,
): McpTelemetryEvent {
  return {
    correlationId,
    event: 'mcp.auth',
    actor,
    source,
    result,
    reason,
    timestamp: nowIso(),
  };
}

export function buildToolCallEvent(
  correlationId: string,
  actor: string,
  source: string,
  tool: string,
): McpTelemetryEvent {
  return {
    correlationId,
    event: 'mcp.tool.call',
    actor,
    source,
    tool,
    timestamp: nowIso(),
  };
}

export function buildToolResultEvent(
  correlationId: string,
  actor: string,
  source: string,
  tool: string,
  durationMs: number,
  result: 'success' | 'error',
  reason?: string,
): McpTelemetryEvent {
  return {
    correlationId,
    event: 'mcp.tool.result',
    actor,
    source,
    tool,
    durationMs,
    result,
    reason,
    timestamp: nowIso(),
  };
}

export function buildPolicyDenyEvent(
  correlationId: string,
  actor: string,
  source: string,
  tool: string,
  reason: string,
): McpTelemetryEvent {
  return {
    correlationId,
    event: 'mcp.policy.deny',
    actor,
    source,
    tool,
    result: 'denied',
    reason,
    timestamp: nowIso(),
  };
}
