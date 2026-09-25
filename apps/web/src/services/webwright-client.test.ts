/// <reference types="vitest/globals" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTask, getTask, connectTaskStream } from './webwright-client.js';
import type { WebwrightTask } from './webwright-client.js';

const mockTask: WebwrightTask = {
  id: 'task-1',
  url: 'https://example.com',
  actions: ['click #btn', 'screenshot'],
  status: 'pending',
  createdAt: '2026-05-26T00:00:00.000Z',
  updatedAt: '2026-05-26T00:00:00.000Z',
};

describe('createTask', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends POST with correct payload and returns task', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockTask),
    } as Response);

    const result = await createTask('https://example.com', ['click #btn', 'screenshot']);

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/webwright/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com', actions: ['click #btn', 'screenshot'] }),
    });
    expect(result).toEqual(mockTask);
  });

  it('throws on non-ok response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);

    await expect(createTask('https://example.com', [])).rejects.toThrow(
      'Failed to create task: 500 Internal Server Error',
    );
  });
});

describe('getTask', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches task by id and returns data', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockTask),
    } as Response);

    const result = await getTask('task-1');

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/webwright/tasks/task-1');
    expect(result).toEqual(mockTask);
  });

  it('throws on non-ok response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response);

    await expect(getTask('missing')).rejects.toThrow('Failed to get task: 404 Not Found');
  });
});

interface MockWs {
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  close: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

describe('connectTaskStream', () => {
  let wsInstance: MockWs;

  beforeEach(() => {
    const closeFn = vi.fn();
    const sendFn = vi.fn();

    const MockWebSocket = vi.fn(function () {
      wsInstance = {
        onmessage: null,
        onerror: null,
        close: closeFn,
        send: sendFn,
      };
      return wsInstance;
    });
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

    Object.defineProperty(globalThis, 'window', {
      value: {
        location: { protocol: 'http:', host: 'localhost:3000' },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates WebSocket with correct URL', () => {
    connectTaskStream('task-1');
    expect(globalThis.WebSocket).toHaveBeenCalledWith(
      'ws://localhost:3000/ws/webwright/tasks/task-1',
    );
  });

  it('calls onMessage handler with parsed task on message', () => {
    const handle = connectTaskStream('task-1');
    const handler = vi.fn();
    handle.onMessage(handler);

    wsInstance.onmessage?.({ data: JSON.stringify(mockTask) } as MessageEvent);

    expect(handler).toHaveBeenCalledWith(mockTask);
  });

  it('calls onError handler on WebSocket error', () => {
    const handle = connectTaskStream('task-1');
    const handler = vi.fn();
    handle.onError(handler);

    const errorEvent = new Event('error');
    wsInstance.onerror?.(errorEvent);

    expect(handler).toHaveBeenCalledWith(errorEvent);
  });

  it('closes WebSocket when close() is called', () => {
    const handle = connectTaskStream('task-1');
    handle.close();
    expect(wsInstance.close).toHaveBeenCalled();
  });

  it('ignores malformed JSON messages without throwing', () => {
    const handle = connectTaskStream('task-1');
    const handler = vi.fn();
    handle.onMessage(handler);

    expect(() => {
      wsInstance.onmessage?.({ data: 'not-json' } as MessageEvent);
    }).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('handles message when no onMessage handler registered (no-op)', () => {
    connectTaskStream('task-1');
    // No handler registered — onmessage fires but messageHandler is null
    expect(() => {
      wsInstance.onmessage?.({ data: JSON.stringify(mockTask) } as MessageEvent);
    }).not.toThrow();
  });

  it('handles WebSocket error when no onError handler registered (no-op)', () => {
    connectTaskStream('task-1');
    // No error handler registered — onerror fires but errorHandler is null
    expect(() => {
      wsInstance.onerror?.(new Event('error'));
    }).not.toThrow();
  });

  it('uses wss: protocol when window.location.protocol is https:', () => {
    Object.defineProperty(globalThis, 'window', {
      value: { location: { protocol: 'https:', host: 'secure.example.com' } },
      writable: true,
      configurable: true,
    });
    connectTaskStream('task-secure');
    expect(globalThis.WebSocket).toHaveBeenCalledWith(
      'wss://secure.example.com/ws/webwright/tasks/task-secure',
    );
  });
});
