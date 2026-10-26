import { PassThrough } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MCP_TOOL_NAMES } from '@automate/shared-contracts';
import type { CallerResolver } from '../http/roles.js';
import type { Caller } from '../services/access-service.js';
import { createMcpRoutes } from '../routes/mcp.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { agentProject } from '../test-support/agent-fixtures.js';
import { syntheticAccessToken } from '../test-support/synthetic-credentials.js';
import {
  createProxyServer,
  isEntryPoint,
  proxyConfig,
  ProxyConfigError,
  runStdioProxy,
} from './stdio.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

// Assembled at runtime: a credential-shaped literal is what the secret scanners exist to find.
const TOKEN = syntheticAccessToken();

async function upstreamApp() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const projectId = await agentProject(db, {}, { name: 'Alpha' });
  const tokens: Record<string, Caller> = {
    [TOKEN]: { actor: 'token:viewer', role: 'viewer', uploaderFor: null },
  };
  const access: CallerResolver = {
    mode: 'enforced',
    authenticateToken: async (token) => tokens[token] ?? null,
    hasSession: async () => false,
  };
  const app = new Hono().route(
    '/',
    createMcpRoutes({ access, health: { db: db as never, workspaceId: 'ws-1' } }),
  );
  const seen: string[] = [];
  const fetchApp = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push(url);
    return app.request(url, init);
  }) as typeof fetch;
  return { projectId, fetchApp, seen };
}

describe('proxyConfig', () => {
  it('builds the endpoint from the origin and keeps the token', () => {
    expect(
      proxyConfig({ AUTOMATE_URL: 'https://automate.example/', AUTOMATE_TOKEN: ` ${TOKEN} ` }),
    ).toEqual({
      endpoint: new URL('https://automate.example/api/v1/mcp'),
      token: TOKEN,
    });
    expect(
      proxyConfig({ AUTOMATE_URL: 'http://127.0.0.1:3000', AUTOMATE_TOKEN: TOKEN }).endpoint.href,
    ).toBe('http://127.0.0.1:3000/api/v1/mcp');
    expect(
      proxyConfig({ AUTOMATE_URL: 'http://[::1]:3000', AUTOMATE_TOKEN: TOKEN }).endpoint.port,
    ).toBe('3000');
    expect(
      proxyConfig({ AUTOMATE_URL: 'http://localhost', AUTOMATE_TOKEN: TOKEN }).endpoint.hostname,
    ).toBe('localhost');
  });

  it.each([
    [{ AUTOMATE_TOKEN: TOKEN }, /Set AUTOMATE_URL/u],
    [{ AUTOMATE_URL: 'https://a.example' }, /Set AUTOMATE_TOKEN/u],
    [{ AUTOMATE_URL: 'https://a.example', AUTOMATE_TOKEN: 'not-a-token' }, /amt_/u],
    [{ AUTOMATE_URL: 'not a url', AUTOMATE_TOKEN: TOKEN }, /not a URL/u],
    // The token would cross the network in the clear.
    [{ AUTOMATE_URL: 'http://192.168.1.10:3000', AUTOMATE_TOKEN: TOKEN }, /in the clear/u],
    [{ AUTOMATE_URL: 'ftp://a.example', AUTOMATE_TOKEN: TOKEN }, /https/u],
    [{ AUTOMATE_URL: 'https://user:pass@a.example', AUTOMATE_TOKEN: TOKEN }, /credentials/u],
  ])('refuses %o', (env, message) => {
    expect(() => proxyConfig(env)).toThrow(ProxyConfigError);
    expect(() => proxyConfig(env)).toThrow(message);
  });
});

describe('the stdio proxy', () => {
  it('forwards tools/list and tools/call to the HTTP server, unchanged', async () => {
    const { projectId, fetchApp } = await upstreamApp();
    const upstream = new Client({ name: 'upstream', version: '1' });
    const { StreamableHTTPClientTransport } =
      await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    await upstream.connect(
      new StreamableHTTPClientTransport(new URL('http://127.0.0.1/api/v1/mcp'), {
        fetch: fetchApp,
        requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
      }),
    );
    const proxy = createProxyServer(upstream);
    const [local, remote] = InMemoryTransport.createLinkedPair();
    await proxy.connect(remote);
    const editor = new Client({ name: 'editor', version: '1' });
    await editor.connect(local);
    closers.push(async () => {
      await editor.close();
      await proxy.close();
      await upstream.close();
    });
    const { tools } = await editor.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    const result = await editor.callTool({ name: 'get_health', arguments: { projectId } });
    const [summary] = result.content as Array<{ text: string }>;
    expect(summary?.text).toMatch(/^Alpha on main/u);
  });

  it('serves over stdio streams, and sends the token only to the configured origin', async () => {
    const { fetchApp, seen } = await upstreamApp();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const running = await runStdioProxy({
      env: { AUTOMATE_URL: 'http://127.0.0.1:3000', AUTOMATE_TOKEN: TOKEN },
      stdin,
      stdout,
      fetch: fetchApp,
    });
    closers.push(() => running.close());
    const lines: string[] = [];
    stdout.on('data', (chunk: Buffer) =>
      lines.push(...chunk.toString('utf8').split('\n').filter(Boolean)),
    );
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' })}\n`);
    await expect.poll(() => lines.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const reply = JSON.parse(lines[0] ?? '{}') as { id: number; result: { tools: unknown[] } };
    expect(reply.id).toBe(7);
    expect(reply.result.tools).toHaveLength(MCP_TOOL_NAMES.length);
    expect(new Set(seen)).toEqual(new Set(['http://127.0.0.1:3000/api/v1/mcp']));
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  it('refuses to start without a usable configuration', async () => {
    await expect(runStdioProxy({ env: {} })).rejects.toThrow(ProxyConfigError);
  });
});

describe('isEntryPoint', () => {
  it('is true only for the module the process was started with', () => {
    expect(isEntryPoint(import.meta.url, fileURLToPath(import.meta.url))).toBe(true);
    expect(isEntryPoint(pathToFileURL(process.cwd()).href, undefined)).toBe(false);
    expect(isEntryPoint(import.meta.url, 'C:/definitely/not/here.js')).toBe(false);
  });
});
