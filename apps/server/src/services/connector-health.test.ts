import { describe, expect, it } from 'vitest';
import {
  buildConnectorHealthEvent,
  buildMcpContractHealthEvent,
} from './connector-health.js';

describe('buildConnectorHealthEvent', () => {
  it('returns a HubEvent with type "connector:health"', () => {
    const event = buildConnectorHealthEvent('github', 'healthy');
    expect(event.type).toBe('connector:health');
  });

  it('includes connector name in payload', () => {
    const event = buildConnectorHealthEvent('github', 'healthy');
    expect(event.payload.connector).toBe('github');
  });

  it('includes status in payload', () => {
    const event = buildConnectorHealthEvent('github', 'healthy');
    expect(event.payload.status).toBe('healthy');
  });

  it('supports "error" status', () => {
    const event = buildConnectorHealthEvent('jira', 'error');
    expect(event.payload.connector).toBe('jira');
    expect(event.payload.status).toBe('error');
  });

  it('includes timestamp in payload', () => {
    const event = buildConnectorHealthEvent('slack', 'healthy');
    expect(event.payload).toHaveProperty('timestamp');
    expect(typeof event.payload.timestamp).toBe('string');
  });
});

describe('buildMcpContractHealthEvent', () => {
  it('returns mcp contract health event payload', () => {
    const event = buildMcpContractHealthEvent('1.0.0', 'passed', '2026-01-01T00:00:00.000Z', 'ok');

    expect(event.type).toBe('connector:health:mcp-contract');
    expect(event.payload.connector).toBe('dashboard_mcp');
    expect(event.payload.contractVersion).toBe('1.0.0');
    expect(event.payload.validationStatus).toBe('passed');
    expect(event.payload.lastValidationTimestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(event.payload.diagnostics).toBe('ok');
  });
});
