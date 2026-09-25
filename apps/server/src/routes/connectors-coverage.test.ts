import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { connectorRoutes } from './connectors.js';
import { ConnectorRegistry } from '../connectors/registry.js';
import { z } from 'zod/v4';
import { isEnabled } from '../services/feature-flags.js';
import {
  buildDashboardMcpConnectorManifest,
  getDashboardMcpContractValidationState,
  type DashboardMcpContractValidationState,
} from '../connectors/mcp-connector.js';
import type { ConnectorManifest } from '../../../../packages/connector-sdk/src/types.js';

vi.mock('../services/feature-flags.js', () => ({
  isEnabled: vi.fn(),
}));

vi.mock('../connectors/mcp-connector.js', () => ({
  getDashboardMcpContractValidationState: vi.fn(),
  buildDashboardMcpConnectorManifest: vi.fn(),
}));

describe('connector routes branch coverage (apiKeyStatus)', () => {
  let app: ReturnType<typeof Fastify>;
  const originalEnv = process.env;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    app = Fastify();
    const registry = new ConnectorRegistry();
    registry.registerManifest({
      name: 'sample',
      version: '1.0.0',
      displayName: 'Sample',
      description: 'sample',
      icon: 'icon',
      credentialSchema: z.object({ key: z.string() }),
      tools: [],
    });
    await connectorRoutes(app, { registry });
    await app.ready();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('GET /api/connectors/dashboard_mcp/health returns apiKeyStatus=configured when DASHBOARD_MCP_API_KEY is set', async () => {
    vi.mocked(isEnabled).mockReturnValue(true);
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.DASHBOARD_MCP_API_KEY = 'my-secret-key';
    const mockState: DashboardMcpContractValidationState = {
      validationStatus: 'passed',
      contractVersion: '1.0',
      diagnostics: '',
      mismatches: [],
      lastValidationTimestamp: null,
    };
    vi.mocked(getDashboardMcpContractValidationState).mockReturnValue(mockState);

    const response = await app.inject({ method: 'GET', url: '/api/connectors/dashboard_mcp/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.apiKeyStatus).toBe('configured');
  });

  it('GET /api/connectors/dashboard_mcp/health returns apiKeyStatus=not_configured when key is absent', async () => {
    vi.mocked(isEnabled).mockReturnValue(true);
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    delete process.env.DASHBOARD_MCP_API_KEY;
    const mockState: DashboardMcpContractValidationState = {
      validationStatus: 'passed',
      contractVersion: '1.0',
      diagnostics: '',
      mismatches: [],
      lastValidationTimestamp: null,
    };
    vi.mocked(getDashboardMcpContractValidationState).mockReturnValue(mockState);

    const response = await app.inject({ method: 'GET', url: '/api/connectors/dashboard_mcp/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json().apiKeyStatus).toBe('not_configured');
  });

  it('POST /api/connectors/dashboard_mcp/test-connect returns apiKeyStatus=configured on success', async () => {
    vi.mocked(isEnabled).mockReturnValue(true);
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.DASHBOARD_MCP_API_KEY = 'configured-key';
    const mockState: DashboardMcpContractValidationState = {
      validationStatus: 'passed',
      contractVersion: '1.0',
      diagnostics: '',
      mismatches: [],
      lastValidationTimestamp: null,
    };
    vi.mocked(buildDashboardMcpConnectorManifest).mockResolvedValue(undefined as unknown as ConnectorManifest);
    vi.mocked(getDashboardMcpContractValidationState).mockReturnValue(mockState);

    const response = await app.inject({ method: 'POST', url: '/api/connectors/dashboard_mcp/test-connect' });
    expect(response.statusCode).toBe(200);
    expect(response.json().validationState.apiKeyStatus).toBe('configured');
  });

  it('POST /api/connectors/dashboard_mcp/test-connect returns apiKeyStatus=not_configured on failure', async () => {
    vi.mocked(isEnabled).mockReturnValue(true);
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    delete process.env.DASHBOARD_MCP_API_KEY;
    const mockState: DashboardMcpContractValidationState = {
      validationStatus: 'failed',
      contractVersion: '1.0',
      diagnostics: 'Connection failed',
      mismatches: [],
      lastValidationTimestamp: null,
    };
    vi.mocked(buildDashboardMcpConnectorManifest).mockRejectedValue(new Error('Connection failed'));
    vi.mocked(getDashboardMcpContractValidationState).mockReturnValue(mockState);

    const response = await app.inject({ method: 'POST', url: '/api/connectors/dashboard_mcp/test-connect' });
    expect(response.statusCode).toBe(500);
    expect(response.json().validationState.apiKeyStatus).toBe('not_configured');
  });

  it('GET /api/connectors returns empty list when registry has no connectors', async () => {
    // Test with empty registry to ensure map() on empty array works
    const emptyApp = Fastify();
    const emptyRegistry = new ConnectorRegistry();
    await connectorRoutes(emptyApp, { registry: emptyRegistry });
    await emptyApp.ready();

    const response = await emptyApp.inject({ method: 'GET', url: '/api/connectors' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });
});
