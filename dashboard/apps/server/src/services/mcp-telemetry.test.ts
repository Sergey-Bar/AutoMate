import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  buildAuthEvent,
  buildPolicyDenyEvent,
  buildToolCallEvent,
  buildToolResultEvent,
  createMcpCorrelation,
  emitMcpTelemetry,
} from './mcp-telemetry.js';

describe('mcp-telemetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buildAuthEvent produces the expected shape', () => {
    const event = buildAuthEvent('corr-1', 'actor-1', 'api_key', 'success');

    expect(event).toMatchObject({
      correlationId: 'corr-1',
      event: 'mcp.auth',
      actor: 'actor-1',
      source: 'api_key',
      result: 'success',
    });
    expect(event.timestamp).toEqual(expect.any(String));
  });

  it('buildToolCallEvent produces the expected shape', () => {
    const event = buildToolCallEvent('corr-2', 'actor-2', 'session', 'getFailureTaxonomy');

    expect(event).toMatchObject({
      correlationId: 'corr-2',
      event: 'mcp.tool.call',
      actor: 'actor-2',
      source: 'session',
      tool: 'getFailureTaxonomy',
    });
    expect(event.timestamp).toEqual(expect.any(String));
  });

  it('buildToolResultEvent includes durationMs', () => {
    const event = buildToolResultEvent(
      'corr-3',
      'actor-3',
      'session',
      'getLocatorSuggestions',
      123,
      'success',
    );

    expect(event).toMatchObject({
      correlationId: 'corr-3',
      event: 'mcp.tool.result',
      actor: 'actor-3',
      source: 'session',
      tool: 'getLocatorSuggestions',
      durationMs: 123,
      result: 'success',
    });
  });

  it('buildPolicyDenyEvent includes reason', () => {
    const event = buildPolicyDenyEvent(
      'corr-4',
      'actor-4',
      'api_key',
      'getPredictiveSelection',
      'tool-not-allowed',
    );

    expect(event).toMatchObject({
      correlationId: 'corr-4',
      event: 'mcp.policy.deny',
      actor: 'actor-4',
      source: 'api_key',
      tool: 'getPredictiveSelection',
      result: 'denied',
      reason: 'tool-not-allowed',
    });
  });

  it('emitMcpTelemetry outputs JSON to stdout', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const payload = buildToolCallEvent('corr-5', 'actor-5', 'session', 'getCorrelations');

    emitMcpTelemetry(payload);

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const [writeArg] = writeSpy.mock.calls[0] ?? [];
    const written = String(writeArg).trim();
    expect(JSON.parse(written)).toEqual(payload);
  });

  it('createMcpCorrelation returns a UUID', () => {
    const correlationId = createMcpCorrelation();

    expect(correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
