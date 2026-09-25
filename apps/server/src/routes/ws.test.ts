import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wsRoutes } from './ws.js';
import { EventHub } from '../services/event-hub.js';

type WsEvent = {
  type: string;
  payload: Record<string, unknown>;
};

type MockSocket = {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  _trigger: (event: string) => void;
};

type WsHandler = (socket: MockSocket) => void;

describe('ws route', () => {
  let eventHub: EventHub;
  let capturedHandler: WsHandler | undefined;

  const mockApp = {
    get: vi.fn((
      path: string,
      opts: { websocket: boolean },
      handler: WsHandler,
    ) => {
      void path;
      void opts;
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
      capturedHandler = handler;
    }),
  };

  function createMockSocket(readyState = 1): MockSocket {
    const listeners: Record<string, Array<() => void>> = {};

    return {
      readyState,
      send: vi.fn(),
      on: vi.fn((event: string, cb: () => void) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
      }),
      _trigger(event: string) {
        listeners[event]?.forEach((cb) => {
          cb();
        });
      },
    };
  }

  function assertHandler(): WsHandler {
    expect(capturedHandler).toBeTypeOf('function');
    return capturedHandler as WsHandler;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    eventHub = new EventHub();
    capturedHandler = undefined;
  });

  it('exports wsRoutes function', async () => {
    const mod = await import('./ws.js');
    expect(typeof mod.wsRoutes).toBe('function');
  });

  it('registers GET /ws route with websocket enabled', async () => {
    await wsRoutes(mockApp as never, { eventHub });

    expect(mockApp.get).toHaveBeenCalledTimes(1);
    expect(mockApp.get).toHaveBeenCalledWith('/ws', { websocket: true }, expect.any(Function));
  });

  it('subscribes to event hub when socket connects', async () => {
    const subscribeSpy = vi.spyOn(eventHub, 'subscribe');
    await wsRoutes(mockApp as never, { eventHub });

    const socket = createMockSocket(1);
    assertHandler()(socket);

    expect(subscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('forwards broadcast events when socket readyState is OPEN', async () => {
    await wsRoutes(mockApp as never, { eventHub });

    const socket = createMockSocket(1);
    assertHandler()(socket);

    const event: WsEvent = {
      type: 'tool:start',
      payload: { toolName: 'search' },
    };

    eventHub.broadcast(event);

    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify(event));
  });

  it('does not forward broadcast events when socket readyState is not OPEN', async () => {
    await wsRoutes(mockApp as never, { eventHub });

    const socket = createMockSocket(3);
    assertHandler()(socket);

    eventHub.broadcast({
      type: 'tool:start',
      payload: { toolName: 'search' },
    });

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('unsubscribes listener after socket close event', async () => {
    await wsRoutes(mockApp as never, { eventHub });

    const socket = createMockSocket(1);
    assertHandler()(socket);

    eventHub.broadcast({ type: 'before-close', payload: { step: 1 } });
    expect(socket.send).toHaveBeenCalledTimes(1);

    socket._trigger('close');
    eventHub.broadcast({ type: 'after-close', payload: { step: 2 } });

    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it('forwards multiple events in order', async () => {
    await wsRoutes(mockApp as never, { eventHub });

    const socket = createMockSocket(1);
    assertHandler()(socket);

    const events: WsEvent[] = [
      { type: 'event-1', payload: { value: 1 } },
      { type: 'event-2', payload: { value: 2 } },
      { type: 'event-3', payload: { value: 3 } },
    ];

    for (const event of events) eventHub.broadcast(event);

    expect(socket.send).toHaveBeenCalledTimes(events.length);
    expect(socket.send).toHaveBeenNthCalledWith(1, JSON.stringify(events[0]));
    expect(socket.send).toHaveBeenNthCalledWith(2, JSON.stringify(events[1]));
    expect(socket.send).toHaveBeenNthCalledWith(3, JSON.stringify(events[2]));
  });

  // Kills mutant 399: StringLiteral "" on line 16 — log message '[ws] WebSocket client error' → ''
  it('logs error with correct message when socket emits error event — kills mutant 399', async () => {
    const logWarn = vi.fn();
    const mockAppWithLog = {
      get: vi.fn((
        _path: string,
        _opts: { websocket: boolean },
        handler: WsHandler,
      ) => {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
        capturedHandler = handler;
      }),
      log: { warn: logWarn },
    };

    await wsRoutes(mockAppWithLog as never, { eventHub });

    const listeners: Record<string, Array<(arg?: unknown) => void>> = {};
    const socketWithError = {
      readyState: 1,
      send: vi.fn(),
      on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
      }),
      _trigger(event: string, arg?: unknown) {
        listeners[event]?.forEach((cb) => cb(arg));
      },
    };

    assertHandler()(socketWithError as unknown as MockSocket);

    const err = new Error('WebSocket connection reset');
    (socketWithError as unknown as { _trigger: (event: string, arg?: unknown) => void })
      ._trigger('error', err);

    expect(logWarn).toHaveBeenCalledTimes(1);
    // Mutant 399 replaces '[ws] WebSocket client error' with ''
    // This test verifies the message is exactly '[ws] WebSocket client error'
    const callArgs = logWarn.mock.calls[0] as [Record<string, unknown>, string];
    expect(callArgs[1]).toBe('[ws] WebSocket client error');
    expect(callArgs[1]).not.toBe('');
    expect(callArgs[0]).toEqual({ err });
  });
});
