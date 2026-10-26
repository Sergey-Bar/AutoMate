import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { isDomainError } from '../errors/domain-error.js';
import { MCP_TOOLS, type McpScope, type McpTool } from './tools.js';

/** What the server calls itself in `initialize`. */
export const MCP_SERVER_INFO = { name: 'automate', version: '1.0.0' } as const;

/**
 * A tool failure as an MCP tool error: `isError` with the DomainError's stable code, so an
 * assistant reads "FORBIDDEN: …" or "NOT_FOUND: …" rather than a protocol fault. A 5xx says
 * `internal error` and nothing more, by the same rule the HTTP error boundary keeps.
 */
export function toolError(error: unknown): CallToolResult {
  if (isDomainError(error)) {
    const { message } = error.toBody('mcp').error as { message: string };
    return { isError: true, content: [{ type: 'text', text: `${error.code}: ${message}` }] };
  }
  return { isError: true, content: [{ type: 'text', text: 'INTERNAL: internal error' }] };
}

/** Where a tool's server-side failure is logged before it is rendered INTERNAL. */
export type McpLog = (message: string, details: Record<string, unknown>) => void;

const consoleLog: McpLog = (message, details) => console.error(message, details);

/**
 * Whether a failure is the server's: anything that is not a DomainError, and a DomainError
 * with a 5xx status. Those reach the log with their cause; the caller sees only INTERNAL.
 */
function isServerFault(error: unknown): boolean {
  return !isDomainError(error) || error.status >= 500;
}

async function call(
  tool: McpTool,
  scope: McpScope,
  args: unknown,
  log: McpLog,
): Promise<CallToolResult> {
  try {
    const answer = await tool.run(scope, args);
    return {
      content: [
        { type: 'text', text: answer.summary },
        { type: 'text', text: JSON.stringify(answer.value) },
      ],
    };
  } catch (error) {
    if (isServerFault(error)) {
      log('an MCP tool failed', {
        tool: tool.name,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
      });
    }
    return toolError(error);
  }
}

/** One server per request, bound to one caller's scope. It holds no state between requests. */
export function createMcpServer(scope: McpScope, log: McpLog = consoleLog): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, {
    capabilities: { tools: { listChanged: false } },
    instructions:
      'Read-only access to AutoMate: repository health, findings, the pull-request gate, delivery, AI-written code, agent quality, supply chain and test effectiveness. Call list_projects first to find a project id.',
  });
  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args: unknown) => call(tool, scope, args, log),
    );
  }
  return server;
}
