import type { HubEvent } from './event-hub.js';

export type ConnectorStatus = 'healthy' | 'error' | 'unknown';

/**
 * Builds a HubEvent for connector health status changes.
 * Broadcast via EventHub to notify WebSocket clients.
 */
export function buildConnectorHealthEvent(
  connector: string,
  status: ConnectorStatus,
): HubEvent {
  return {
    type: 'connector:health',
    payload: {
      connector,
      status,
      timestamp: new Date().toISOString(),
    },
  };
}

export function buildMcpContractHealthEvent(
  contractVersion: string,
  validationStatus: 'passed' | 'failed' | 'unknown',
  lastValidationTimestamp: string | null,
  diagnostics: string,
): HubEvent {
  return {
    type: 'connector:health:mcp-contract',
    payload: {
      connector: 'dashboard_mcp',
      contractVersion,
      validationStatus,
      lastValidationTimestamp,
      diagnostics,
      timestamp: new Date().toISOString(),
    },
  };
}
