import type { FastifyInstance } from 'fastify';
import type { ConnectorRegistry } from '../connectors/registry.js';

import { isEnabled } from '../services/feature-flags.js';
import {
  buildDashboardMcpConnectorManifest,
  getDashboardMcpContractValidationState,
} from '../connectors/mcp-connector.js';
export interface ConnectorRouteDeps {
  registry: ConnectorRegistry;
}

export async function connectorRoutes(app: FastifyInstance, deps: ConnectorRouteDeps): Promise<void> {
  app.get('/api/connectors', async (): Promise<unknown> => {
    return deps.registry.listManifests().map(m => ({
      name: m.name,
      displayName: m.displayName,
      description: m.description,
      icon: m.icon,
      toolCount: m.tools.length,
    }));
  });

  app.get('/api/connectors/dashboard_mcp/health', async (req, reply): Promise<unknown> => {
    if (!isEnabled('mcp-client')) {
      return reply.code(404).send({ error: 'MCP client feature is disabled.' });
    }
    const validationState = getDashboardMcpContractValidationState();
    const apiKeyStatus = process.env.DASHBOARD_MCP_API_KEY ? 'configured' : 'not_configured';
    return { ...validationState, apiKeyStatus };
  });

  app.post('/api/connectors/dashboard_mcp/test-connect', async (req, reply): Promise<unknown> => {
    if (!isEnabled('mcp-client')) {
      return reply.code(404).send({ error: 'MCP client feature is disabled.' });
    }
    try {
      await buildDashboardMcpConnectorManifest();
      const validationState = getDashboardMcpContractValidationState();
      const apiKeyStatus = process.env.DASHBOARD_MCP_API_KEY ? 'configured' : 'not_configured';
      
      if (validationState.validationStatus === 'failed') {
        app.log.warn({ validationState }, 'MCP connector test-connect: validation failed');
        return reply.code(500).send({ success: false, validationState: { ...validationState, apiKeyStatus } });
      }
      
      app.log.info({ validationState }, 'MCP connector test-connect: validation passed');
      return { success: true, validationState: { ...validationState, apiKeyStatus } };
    } catch (error: unknown) {
      const validationState = getDashboardMcpContractValidationState();
      const apiKeyStatus = process.env.DASHBOARD_MCP_API_KEY ? 'configured' : 'not_configured';
      
      app.log.error({
        err: error,
        validationState,
        mismatches: validationState.mismatches,
        diagnostics: validationState.diagnostics,
      }, 'MCP connector test-connect failed with exception');
      
      return reply.code(500).send({ success: false, validationState: { ...validationState, apiKeyStatus } });
    }
  });

}

