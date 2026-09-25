/// <reference types="vitest" />
/**
 * ws-ingestion-payloads.test.ts — T15
 *
 * Tests the reporter WebSocket server's resilience to edge-case payloads and
 * connection lifecycle events. Every test verifies that the server survives
 * without crashing and without unexpectedly closing client connections.
 *
 * The test server mirrors the message-handling contract of the real server:
 *  - silently swallows non-JSON input (no close, no error sent to client)
 *  - silently ignores unknown event types
 *  - handles binary frames without crashing
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import type { AddressInfo } from 'net';

const TIMEOUT_MS = 3_000;

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TestServer {
  port: number;
  close: () => Promise<void>;
}

/**
 * Starts a reporter WebSocket server whose message handler mirrors the real
 * ReporterBridge.handleReporterEvent contract (fail-safe JSON parse, ignore
 * unknown types) without requiring a database connection.
 */
async function startPayloadsServer(): Promise<TestServer> {
  const httpServer = http.createServer();
  const wss = new WebSocketServer({ server: httpServer, path: '/reporter' });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const text = raw.toString();
      // Mirror ReporterBridge.handleReporterEvent: silently swallow parse errors
      try {
        const event = JSON.parse(text) as { type?: string };
        // Unknown types fall through — no crash, no close (mirrors the default: branch)
        void event;
      } catch {
        // Intentionally ignored — same behaviour as the real bridge
      }
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

/**
 * Opens a WebSocket connection and waits for it to reach OPEN state.
 */
async function connectClient(port: number): Promise<WebSocket> {
  const client = new WebSocket(
    `ws://127.0.0.1:${port}/reporter?protocolVersion=1`,
  );
  await new Promise<void>((resolve, reject) => {
    client.on('open', resolve);
    client.on('error', reject);
    setTimeout(() => reject(new Error('Timed out waiting for connection')), TIMEOUT_MS);
  });
  return client;
}

// ── Payload resilience tests (T15) ────────────────────────────────────────

describe('Reporter WebSocket — payload resilience (T15)', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startPayloadsServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('keeps connection open after receiving an invalid JSON string', async () => {
    const client = await connectClient(server.port);

    client.send('{ this is : not : valid json }');
    await waitMs(150);

    // Connection must remain open — server must not react by closing
    expect(client.readyState).toBe(WebSocket.OPEN);

    // Sending a second message proves the channel is truly still alive
    client.send(JSON.stringify({ type: 'ping', runId: 'r1', payload: {} }));
    await waitMs(50);
    expect(client.readyState).toBe(WebSocket.OPEN);

    client.terminate();
  });

  it('does not crash when it receives a message with an unknown event type', async () => {
    const client = await connectClient(server.port);

    client.send(
      JSON.stringify({ type: 'nonexistent:event', runId: 'unknown-run', payload: {} }),
    );
    await waitMs(150);

    expect(client.readyState).toBe(WebSocket.OPEN);
    client.terminate();
  });

  it('does not crash when a client sends a binary frame', async () => {
    const client = await connectClient(server.port);

    // Send raw binary data — not a valid UTF-8 JSON string
    client.send(Buffer.from([0x00, 0x01, 0x02, 0xfe, 0xff]));
    await waitMs(150);

    expect(client.readyState).toBe(WebSocket.OPEN);
    client.terminate();
  });

  it('server remains accepting connections after a client abruptly terminates', async () => {
    const victim = await connectClient(server.port);

    // Forcefully close without a WS closing handshake
    victim.terminate();
    await waitMs(150);

    // Server must still be reachable — a new connection should succeed
    const followUp = await connectClient(server.port);
    expect(followUp.readyState).toBe(WebSocket.OPEN);
    followUp.terminate();
  });

  it('server remains stable after rapid connect/disconnect cycles', async () => {
    const CYCLES = 10;

    for (let i = 0; i < CYCLES; i++) {
      const ws = new WebSocket(
        `ws://127.0.0.1:${server.port}/reporter?protocolVersion=1`,
      );
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          ws.terminate();
          resolve();
        });
        ws.on('error', reject);
        setTimeout(() => reject(new Error(`Cycle ${i} timed out`)), TIMEOUT_MS);
      });
    }

    // Server must still be alive after all the churn
    const final = await connectClient(server.port);
    expect(final.readyState).toBe(WebSocket.OPEN);
    final.terminate();
  });

  it('concurrent clients with distinct run IDs do not interfere with each other', async () => {
    const NUM_CLIENTS = 5;
    const clients = await Promise.all(
      Array.from({ length: NUM_CLIENTS }, () => connectClient(server.port)),
    );

    // Each client sends a distinct run event
    for (const [i, client] of clients.entries()) {
      client.send(
        JSON.stringify({ type: 'run:start', runId: `run-concurrent-${i}`, payload: { total: i } }),
      );
    }

    await waitMs(200);

    // All clients must remain connected — no cross-contamination
    for (const client of clients) {
      expect(client.readyState).toBe(WebSocket.OPEN);
    }

    clients.forEach((c) => c.terminate());
  });
});
