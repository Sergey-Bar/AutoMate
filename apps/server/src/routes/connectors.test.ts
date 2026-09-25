import { describe, expect, it, beforeEach, vi } from 'vitest';
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


describe('connector config API', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    const registry = new ConnectorRegistry();
    registry.registerManifest({
      name: 'test-connector',
      version: '0.1.0',
      displayName: 'Test Connector',
      description: 'A test connector',
      icon: 'test',
      credentialSchema: z.object({ token: z.string() }),
      tools: [
        {
          name: 'test_tool',
          description: 'A test tool',
          inputSchema: z.object({ input: z.string() }),
          handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
        },
      ],
    });
    await connectorRoutes(app, { registry });
    await app.ready();
  });

  it('GET /api/connectors lists registered connectors', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/connectors' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('test-connector');
    expect(body[0].displayName).toBe('Test Connector');
    expect(body[0].toolCount).toBe(1);
  });

  describe('GET /api/connectors/dashboard_mcp/health', () => {
    it('returns 404 if mcp-client feature is disabled', async () => {
      vi.mocked(isEnabled).mockReturnValue(false);
      const response = await app.inject({ method: 'GET', url: '/api/connectors/dashboard_mcp/health' });
      expect(response.statusCode).toBe(404);
    });

    it('returns health status when feature is enabled', async () => {
      vi.mocked(isEnabled).mockReturnValue(true);
      const mockState: DashboardMcpContractValidationState = { validationStatus: 'passed', contractVersion: '1.0', diagnostics: '', mismatches: [], lastValidationTimestamp: null };
      vi.mocked(getDashboardMcpContractValidationState).mockReturnValue(mockState);


      const response = await app.inject({ method: 'GET', url: '/api/connectors/dashboard_mcp/health' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.validationStatus).toBe('passed');
      expect(body.contractVersion).toBe('1.0');
      expect(body.apiKeyStatus).toBe('not_configured');
    });
  });

  describe('POST /api/connectors/dashboard_mcp/test-connect', () => {
    it('returns 404 if mcp-client feature is disabled', async () => {
      vi.mocked(isEnabled).mockReturnValue(false);
      const response = await app.inject({ method: 'POST', url: '/api/connectors/dashboard_mcp/test-connect' });
      expect(response.statusCode).toBe(404);
    });

    it('returns success after triggering a rebuild', async () => {
      vi.mocked(isEnabled).mockReturnValue(true);
      const mockState: DashboardMcpContractValidationState = { validationStatus: 'passed', contractVersion: '1.0', diagnostics: '', mismatches: [], lastValidationTimestamp: null };
      vi.mocked(buildDashboardMcpConnectorManifest).mockResolvedValue(undefined as unknown as ConnectorManifest);
      vi.mocked(getDashboardMcpContractValidationState).mockReturnValue(mockState);


      const response = await app.inject({ method: 'POST', url: '/api/connectors/dashboard_mcp/test-connect' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.validationState.validationStatus).toBe('passed');
    });

    it('returns failure if rebuild throws', async () => {
      vi.mocked(isEnabled).mockReturnValue(true);
      const mockState: DashboardMcpContractValidationState = { validationStatus: 'failed', contractVersion: '1.0', diagnostics: 'Build failed', mismatches: ['Build failed'], lastValidationTimestamp: null };
      vi.mocked(buildDashboardMcpConnectorManifest).mockRejectedValue(new Error('Build failed'));
      vi.mocked(getDashboardMcpContractValidationState).mockReturnValue(mockState);


      const response = await app.inject({ method: 'POST', url: '/api/connectors/dashboard_mcp/test-connect' });
      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.validationState.validationStatus).toBe('failed');
    });
  });
});
