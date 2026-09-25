#!/usr/bin/env tsx
/**
 * scripts/update-mcp-contract.ts
 *
 * Connects to the Dashboard MCP server, fetches the current tool list, and
 * writes an updated snapshot fixture to:
 *   apps/server/src/mcp/__fixtures__/dashboard-contract-v1-snapshot.json
 *
 * Run from the Automate root:
 *   npx tsx scripts/update-mcp-contract.ts --dashboard-url http://localhost:4000 [--api-key <key>]
 *
 * Options:
 *   --dashboard-url  Dashboard base URL (default: http://localhost:4000)
 *   --api-key        Dashboard API key (default: DASHBOARD_MCP_API_KEY env)
 *   --output         Output path for snapshot (default: fixture path)
 *   --dry-run        Print the snapshot without writing to disk
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDashboardMcpClient } from '../apps/server/src/connectors/mcp-client.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SnapshotTool {
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface ContractSnapshot {
  version: string;
  tools: Record<string, SnapshotTool>;
  errorCodes: string[];
}

export interface BuildSnapshotOptions {
  version?: string;
  errorCodes?: string[];
}

// ── Core function (exported for testing) ──────────────────────────────────────

/**
 * Build a contract snapshot object from a list of discovered MCP tools.
 * outputSchema is left as {} since MCP tool listing does not expose it.
 */
export function buildSnapshotFromDiscoveredTools(
  tools: Array<{ name: string; inputSchema: Record<string, unknown> }>,
  options: BuildSnapshotOptions = {},
): ContractSnapshot {
  const version = options.version ?? '1.1.0';
  const errorCodes = options.errorCodes ?? [
    'UNAUTHORIZED',
    'TOOL_NOT_FOUND',
    'INVALID_INPUT',
    'INTERNAL_ERROR',
    'FEATURE_DISABLED',
  ];

  const toolEntries = tools.map((tool) => [
    tool.name,
    {
      inputSchema: tool.inputSchema,
      outputSchema: {},
    },
  ]);

  return {
    version,
    tools: Object.fromEntries(toolEntries) as Record<string, SnapshotTool>,
    errorCodes,
  };
}

// ── CLI entrypoint ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg?.startsWith('--') && i + 1 < argv.length) {
      const key = arg.slice(2);
      result[key] = argv[i + 1] ?? '';
      i++;
    } else if (arg?.startsWith('--')) {
      result[arg.slice(2)] = 'true';
    }
  }
  return result;
}

const DEFAULT_FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../apps/server/src/mcp/__fixtures__/dashboard-contract-v1-snapshot.json',
);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const dashboardUrl = args['dashboard-url'] ?? process.env.DASHBOARD_MCP_URL ?? 'http://localhost:4000';
  const apiKey = args['api-key'] ?? process.env.DASHBOARD_MCP_API_KEY ?? '';
  const outputPath = args['output'] ?? DEFAULT_FIXTURE_PATH;
  const dryRun = args['dry-run'] === 'true';

  const mcpUrl = dashboardUrl.replace(/\/+$/, '') + '/mcp';

  console.log(`[update-mcp-contract] Connecting to Dashboard MCP at: ${mcpUrl}`);

  const client = createDashboardMcpClient({ url: mcpUrl, apiKey });

  try {
    await client.connect();
    const tools = await client.listTools();
    console.log(`[update-mcp-contract] Discovered ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);

    const snapshot = buildSnapshotFromDiscoveredTools(tools);
    const json = JSON.stringify(snapshot, null, 2) + '\n';

    if (dryRun) {
      console.log('[update-mcp-contract] Dry-run — snapshot (not written):');
      console.log(json);
    } else {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, json, 'utf8');
      console.log(`[update-mcp-contract] Snapshot written to: ${outputPath}`);
    }
  } finally {
    await client.disconnect();
  }
}

// Run only when executed directly
const scriptUrl = pathToFileURL(process.argv[1] ?? '').href;
if (import.meta.url === scriptUrl) {
  main().catch((err: Error) => {
    console.error('[update-mcp-contract] Failed:', err.message);
    process.exit(1);
  });
}

function pathToFileURL(p: string): URL {
  return new URL('file://' + p.replace(/\\/g, '/'));
}
