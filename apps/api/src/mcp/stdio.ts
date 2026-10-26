#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { isLoopbackBind } from '@automate/config';
import { MCP_SERVER_INFO } from './server.js';

/**
 * The stdio MCP server an editor launches: a proxy to `POST /api/v1/mcp` on an AutoMate
 * install, so Claude Code, Cursor, Kiro or VS Code can reach a server they cannot speak
 * Streamable HTTP to with a header — or that a user prefers to configure as a command.
 *
 * It holds no tool of its own: `tools/list` and `tools/call` are forwarded as they are, so
 * the tools, their schemas and every access decision are the server's, never this file's.
 * It reads two variables and nothing else:
 *
 * - `AUTOMATE_URL` — the install's origin. `https:` anywhere; `http:` only to a loopback
 *   host, because the token would cross the network in the clear.
 * - `AUTOMATE_TOKEN` — an `amt_` access token with the viewer role. It is sent as a bearer
 *   header to that one origin and is never written to stdout, where the protocol is.
 */
export interface ProxyConfig {
  endpoint: URL;
  token: string;
}

export class ProxyConfigError extends Error {
  override readonly name = 'ProxyConfigError';
}

/** The endpoint and token from the environment, or the sentence that says what is wrong. */
export function proxyConfig(env: Readonly<Record<string, string | undefined>>): ProxyConfig {
  const raw = env['AUTOMATE_URL']?.trim() ?? '';
  const token = env['AUTOMATE_TOKEN']?.trim() ?? '';
  if (raw === '') throw new ProxyConfigError('Set AUTOMATE_URL to the AutoMate origin.');
  if (!token.startsWith('amt_')) {
    throw new ProxyConfigError('Set AUTOMATE_TOKEN to an amt_ access token with the viewer role.');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProxyConfigError(`AUTOMATE_URL is not a URL: ${raw}`);
  }
  const loopback = isLoopbackBind(url.hostname.replace(/^\[|\]$/gu, ''));
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new ProxyConfigError(
      'AUTOMATE_URL must be https://, or http:// to a loopback host: the token would cross the network in the clear.',
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new ProxyConfigError('AUTOMATE_URL must not carry credentials; use AUTOMATE_TOKEN.');
  }
  return { endpoint: new URL('/api/v1/mcp', url), token };
}

/** A local server whose every tool is the upstream's, forwarded unchanged. */
export function createProxyServer(upstream: Client): McpServer {
  const proxy = new McpServer(
    { ...MCP_SERVER_INFO, name: `${MCP_SERVER_INFO.name}-stdio` },
    { capabilities: { tools: { listChanged: false } } },
  );
  proxy.server.setRequestHandler(ListToolsRequestSchema, (request) =>
    upstream.listTools(request.params),
  );
  proxy.server.setRequestHandler(CallToolRequestSchema, (request) =>
    upstream.callTool(request.params),
  );
  return proxy;
}

export interface StdioIo {
  env: Readonly<Record<string, string | undefined>>;
  stdin?: Readable;
  stdout?: Writable;
  /** The HTTP client, for a test; the platform `fetch` otherwise. */
  fetch?: typeof fetch;
}

/** Connects upstream, then serves stdio. Resolves once both ends are connected. */
export async function runStdioProxy(io: StdioIo): Promise<{ close(): Promise<void> }> {
  const config = proxyConfig(io.env);
  const upstream = new Client({
    name: `${MCP_SERVER_INFO.name}-stdio`,
    version: MCP_SERVER_INFO.version,
  });
  await upstream.connect(
    new StreamableHTTPClientTransport(config.endpoint, {
      requestInit: { headers: { authorization: `Bearer ${config.token}` } },
      ...(io.fetch === undefined ? {} : { fetch: io.fetch }),
    }),
  );
  const proxy = createProxyServer(upstream);
  await proxy.connect(new StdioServerTransport(io.stdin, io.stdout));
  return {
    close: async () => {
      await proxy.close();
      await upstream.close();
    },
  };
}

/** Whether this module is the process entry point (`node dist/mcp/stdio.js`). */
export function isEntryPoint(moduleUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  // Diagnostics go to stderr: stdout is the protocol.
  runStdioProxy({
    env: {
      AUTOMATE_URL: process.env['AUTOMATE_URL'],
      AUTOMATE_TOKEN: process.env['AUTOMATE_TOKEN'],
    },
  }).catch((error: unknown) => {
    process.stderr.write(
      `automate mcp: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
