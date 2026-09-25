import { z } from 'zod/v4';
import type { ConnectorManifest } from '../../../../packages/connector-sdk/src/types.js';
import { createDashboardMcpClient, type DashboardMcpClientConfig } from './mcp-client.js';
import {
  validateDiscoveredToolsAgainstContract,
  type McpContractValidationResult,
} from './mcp-contract-validator.js';
import { filterAllowedTools, isToolAllowed } from './mcp-tool-policy.js';

const CONNECTOR_NAME = 'dashboard_mcp';

export interface DashboardMcpContractValidationState {
  contractVersion: string;
  validationStatus: 'passed' | 'failed' | 'unknown';
  diagnostics: string;
  mismatches: string[];
  lastValidationTimestamp: string | null;
}

let contractValidationState: DashboardMcpContractValidationState = {
  contractVersion: '1.1.0',
  validationStatus: 'unknown',
  diagnostics: 'dashboard_mcp contract validation has not run yet.',
  mismatches: [],
  lastValidationTimestamp: null,
};

function buildBaseManifest(): Omit<ConnectorManifest, 'tools'> {
  return {
    name: CONNECTOR_NAME,
    version: '1.0.0',
    displayName: 'Dashboard MCP',
    description: 'Dashboard analytics tools exposed via MCP.',
    icon: 'dashboard',
    credentialSchema: z.object({
      apiKey: z.string().min(1).optional(),
    }),
  };
}

function fallbackManifest(errorMessage: string): ConnectorManifest {
  const base = buildBaseManifest();
  return {
    ...base,
    description: `Dashboard MCP unavailable: ${errorMessage}`,
    tools: [],
  };
}

function setValidationStateFromResult(result: McpContractValidationResult) {
  contractValidationState = {
    contractVersion: result.contractVersion,
    validationStatus: result.valid ? 'passed' : 'failed',
    diagnostics: result.diagnostics,
    mismatches: result.mismatches,
    lastValidationTimestamp: result.validatedAt,
  };
}

function setValidationStateFromError(message: string) {
  contractValidationState = {
    ...contractValidationState,
    validationStatus: 'failed',
    diagnostics: message,
    mismatches: [message],
    lastValidationTimestamp: new Date().toISOString(),
  };
}

export function getDashboardMcpContractValidationState(): DashboardMcpContractValidationState {
  return { ...contractValidationState, mismatches: [...contractValidationState.mismatches] };
}

export interface McpConnectorLogger {
  info: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export async function buildDashboardMcpConnectorManifest(
  config?: Partial<DashboardMcpClientConfig>,
  logger?: McpConnectorLogger,
): Promise<ConnectorManifest> {
  const base = buildBaseManifest();
  const discoveryClient = createDashboardMcpClient(config);

  try {
    const discoveredTools = await discoveryClient.listTools();
    const validationResult = validateDiscoveredToolsAgainstContract(discoveredTools, { discoveredContractVersion: '1.1.0' });
    setValidationStateFromResult(validationResult);

    if (!validationResult.valid) {
      logger?.error({
        contractVersion: validationResult.contractVersion,
        mismatches: validationResult.mismatches,
        diagnostics: validationResult.diagnostics,
        validatedAt: validationResult.validatedAt,
      }, '[dashboard_mcp] Contract validation failed');
      return fallbackManifest(`contract validation failed. ${validationResult.diagnostics}`);
    }

    logger?.info({
      contractVersion: validationResult.contractVersion,
      toolCount: discoveredTools.length,
      validatedAt: validationResult.validatedAt,
    }, '[dashboard_mcp] Contract validation passed');

    if (validationResult.newTools.length > 0) {
      logger?.info({
        newTools: validationResult.newTools,
        hint: 'Run scripts/update-mcp-contract.ts to refresh the snapshot fixture.',
      }, '[dashboard_mcp] Contract snapshot is stale — new tools detected on Dashboard (not in fixture). Update snapshot to enable them.');
    }

    const { allowed, denied } = filterAllowedTools(discoveredTools);

    const tools: ConnectorManifest['tools'] = allowed.map((mcpTool) => ({
      name: mcpTool.name,
      description: mcpTool.description ?? `Dashboard MCP tool: ${mcpTool.name}`,
      inputSchema: z.object({}).passthrough(),
      handler: async (input, context) => {
        if (!isToolAllowed(mcpTool.name)) {
          throw new Error(`dashboard_mcp tool denied by policy: ${mcpTool.name}`);
        }

        const credentialsApiKey = context.credentials.apiKey;
        const callClient = createDashboardMcpClient({
          ...config,
          apiKey: credentialsApiKey || config?.apiKey,
        });

        try {
          await callClient.connect();
          const args = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
          return await callClient.callTool(mcpTool.name, args);
        } finally {
          await callClient.disconnect();
        }
      },
    }));

    return {
      ...base,
      description: denied.length > 0
        ? `${base.description} Policy denied tools: ${denied.join(', ')}`
        : base.description,
      tools,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.error({
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    }, '[dashboard_mcp] Connector build failed');
    setValidationStateFromError(message);
    return fallbackManifest(message);
  } finally {
    await discoveryClient.disconnect();
  }
}
