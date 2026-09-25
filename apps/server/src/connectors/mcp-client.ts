import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolResult } from '../../../../packages/connector-sdk/src/types.js';

export interface DashboardMcpClientConfig {
  url: string;
  apiKey: string;
  connectTimeoutMs?: number;
  toolTimeoutMs?: number;
}

export interface DashboardMcpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface DashboardMcpClient {
  connect(): Promise<void>;
  listTools(): Promise<DashboardMcpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  disconnect(): Promise<void>;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_TOOL_TIMEOUT_MS = 10_000;

type McpCallToolTextContent = { type: 'text'; text: string };

function normalizeCallToolContent(raw: unknown): Array<{ type: 'text'; text: string }> {
  if (!Array.isArray(raw)) return [];

  return raw.map((item) => {
    if (
      typeof item === 'object'
      && item !== null
      && 'type' in item
      && (item as { type?: unknown }).type === 'text'
      && 'text' in item
      && typeof (item as { text?: unknown }).text === 'string'
    ) {
      return { type: 'text' as const, text: (item as McpCallToolTextContent).text };
    }
    return { type: 'text' as const, text: JSON.stringify(item) };
  });
}

function toActionableError(error: unknown, action: 'connect' | 'list tools' | 'call tool'): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    `Dashboard MCP unavailable during ${action}. Check DASHBOARD_MCP_URL/DASHBOARD_MCP_API_KEY and dashboard server health. Root cause: ${message}`,
  );
}

export function createDashboardMcpClient(config?: Partial<DashboardMcpClientConfig>): DashboardMcpClient {
  const url = config?.url ?? process.env.DASHBOARD_MCP_URL ?? '';
  const apiKey = config?.apiKey ?? process.env.DASHBOARD_SERVICE_ACCOUNT_KEY ?? process.env.DASHBOARD_MCP_API_KEY ?? '';
  const connectTimeoutMs = config?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const toolTimeoutMs = config?.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;

  const client = new Client({ name: 'automate-server-mcp-client', version: '1.0.0' }, { capabilities: {} });
  let transport: StreamableHTTPClientTransport | null = null;
  let connectPromise: Promise<void> | null = null;
  let connected = false;

  async function connect() {
    if (connected) return;
    if (connectPromise) return connectPromise;

    if (!url || !apiKey) {
      throw new Error('Dashboard MCP unavailable during connect. Missing DASHBOARD_MCP_URL or DASHBOARD_SERVICE_ACCOUNT_KEY / DASHBOARD_MCP_API_KEY.');
    }

    connectPromise = (async () => {
      try {
        transport = new StreamableHTTPClientTransport(new URL(url), {
          requestInit: {
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          },
        });
        await client.connect(transport, { timeout: connectTimeoutMs });
        connected = true;
      } catch (error) {
        connected = false;
        throw toActionableError(error, 'connect');
      } finally {
        connectPromise = null;
      }
    })();

    return connectPromise;
  }

  async function listTools(): Promise<DashboardMcpTool[]> {
    await connect();

    try {
      const result = await client.listTools(undefined, { timeout: toolTimeoutMs });
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
      }));
    } catch (error) {
      throw toActionableError(error, 'list tools');
    }
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    await connect();

    try {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: toolTimeoutMs }) as {
        content?: unknown;
        structuredContent?: unknown;
        isError?: unknown;
      };

      const normalizedContent = normalizeCallToolContent(result.content);

      const content = normalizedContent.length > 0
        ? normalizedContent
        : [{ type: 'text' as const, text: JSON.stringify(result.structuredContent ?? {}) }];

      return {
        content,
        isError: typeof result.isError === 'boolean' ? result.isError : false,
      };
    } catch (error) {
      throw toActionableError(error, 'call tool');
    }
  }

  async function disconnect() {
    connected = false;
    connectPromise = null;
    await client.close().catch(() => undefined);
    await transport?.close().catch(() => undefined);
    transport = null;
  }

  return {
    connect,
    listTools,
    callTool,
    disconnect,
  };
}
