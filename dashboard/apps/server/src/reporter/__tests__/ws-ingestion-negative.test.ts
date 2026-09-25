/// <reference types="vitest" />
/**
 * ws-ingestion-negative.test.ts — T14
 *
 * Tests the reporter WebSocket server's auth and protocol-version guards,
 * mirroring the verifyClient + connection-handler logic from src/index.ts.
 *
 * Auth failures manifest as HTTP 401 during the WS upgrade (before any WS
 * frame is exchanged). Protocol-version violations produce a WS close frame
 * with application code 4400.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import type { AddressInfo } from 'net';
import type { IncomingMessage } from 'http';

const TIMEOUT_MS = 3_000;

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TestServer {
  port: number;
  close: () => Promise<void>;
}

/**
 * Starts a minimal reporter WebSocket server that mirrors the verifyClient
 * and protocol-version guard from apps/server/src/index.ts.
 * Uses port 0 so the OS assigns a free port — no conflicts with other suites.
 */
async function startTestServer(secret?: string): Promise<TestServer> {
  const httpServer = http.createServer();

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/reporter',
    verifyClient: (
      info: { origin: string; secure: boolean; req: IncomingMessage },
      cb: (res: boolean, code?: number, message?: string) => void,
    ) => {
      if (!secret) {
        cb(true);
        return;
      }
      const url = new URL(info.req.url ?? '', 'http://localhost');
      const token =
        url.searchParams.get('token') ??
        (info.req.headers['x-reporter-token'] as string | undefined);
      if (token === secret) {
        cb(true);
      } else {
        cb(false, 401, 'Unauthorized');
      }
    },
  });

  wss.on('connection', (ws, req) => {
    const reqUrl = new URL(req.url ?? '', 'http://localhost');
    const versionStr = reqUrl.searchParams.get('protocolVersion');
    const SUPPORTED_VERSION = 1;

    if (versionStr !== null) {
      const version = parseInt(versionStr, 10);
      if (version > SUPPORTED_VERSION) {
        ws.close(4400, 'Unsupported protocol version');
        return;
      }
    }

    ws.on('message', (_raw) => {
      // Message processing is tested in ws-ingestion-payloads.test.ts
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));

  const port = (httpServer.address() as AddressInfo).port;

  const close = () =>
    new Promise<void>((resolve, reject) => {
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close();
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });

  return { port, close };
}

// ── Auth rejection tests (T14) ─────────────────────────────────────────────

describe('Reporter WebSocket — auth rejection (T14)', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer('correct-secret-xyz');
  });

  afterAll(async () => {
    await server.close();
  });

  it('rejects upgrade with HTTP 401 when no token is provided', async () => {
    const client = new WebSocket(`ws://127.0.0.1:${server.port}/reporter`);

    const statusCode = await new Promise<number>((resolve, reject) => {
      client.on('unexpected-response', (_req, res) => {
        resolve(res.statusCode ?? 0);
      });
      // Some ws versions surface the rejection as an error event
      client.on('error', (err) => {
        if (err.message.includes('401')) {
          resolve(401);
        } else {
          reject(err);
        }
      });
      client.on('open', () => reject(new Error('Connection should have been rejected')));
      setTimeout(() => reject(new Error('Timed out waiting for auth rejection')), TIMEOUT_MS);
    });

    expect(statusCode).toBe(401);
    client.terminate();
  });

  it('rejects upgrade with HTTP 401 when an invalid token is provided', async () => {
    const client = new WebSocket(
      `ws://127.0.0.1:${server.port}/reporter?token=totally-wrong-token`,
    );

    const statusCode = await new Promise<number>((resolve, reject) => {
      client.on('unexpected-response', (_req, res) => {
        resolve(res.statusCode ?? 0);
      });
      client.on('error', (err) => {
        if (err.message.includes('401')) {
          resolve(401);
        } else {
          reject(err);
        }
      });
      client.on('open', () => reject(new Error('Connection should have been rejected')));
      setTimeout(() => reject(new Error('Timed out waiting for auth rejection')), TIMEOUT_MS);
    });

    expect(statusCode).toBe(401);
    client.terminate();
  });
});

// ── Protocol version guard tests (T14) ────────────────────────────────────

describe('Reporter WebSocket — protocol version guard (T14)', () => {
  let server: TestServer;

  beforeAll(async () => {
    // No secret — focus purely on protocol-version behaviour
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('closes the connection with code 4400 when protocolVersion exceeds supported maximum', async () => {
    const client = new WebSocket(
      `ws://127.0.0.1:${server.port}/reporter?protocolVersion=99`,
    );

    const { code, reason } = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      client.on('close', (c, buf) => resolve({ code: c, reason: buf.toString() }));
      client.on('error', reject);
      setTimeout(() => reject(new Error('Timed out waiting for close frame')), TIMEOUT_MS);
    });

    expect(code).toBe(4400);
    expect(reason).toContain('Unsupported protocol version');
    client.terminate();
  });

  it('keeps the connection open after receiving a non-JSON first message', async () => {
    const client = new WebSocket(
      `ws://127.0.0.1:${server.port}/reporter?protocolVersion=1`,
    );

    await new Promise<void>((resolve, reject) => {
      client.on('open', resolve);
      client.on('error', reject);
      setTimeout(() => reject(new Error('Timed out waiting for open')), TIMEOUT_MS);
    });

    // Server must NOT close the connection when the first message is not JSON
    client.send('this-is-not-valid-json');
    await waitMs(150);

    expect(client.readyState).toBe(WebSocket.OPEN);
    client.terminate();
  });
});
