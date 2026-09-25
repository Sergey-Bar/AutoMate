/// <reference types="vitest" />
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

const {
  wsInstances,
  mockPush,
  mockDispatchEvent,
} = vi.hoisted(() => {
  class MockWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    static CONNECTING = 0;
    static CLOSING = 2;

    url: string;
    readyState = MockWebSocket.OPEN;
    send = vi.fn();
    close = vi.fn();
    onopen: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;

    constructor(url: string) {
      this.url = url;
    }
  }

  const wsInstances: MockWebSocket[] = [];
  class MockWebSocketCtor extends MockWebSocket {
    constructor(url: string) {
      super(url);
      wsInstances.push(this);
    }
  }

  vi.stubGlobal('WebSocket', MockWebSocketCtor as unknown as typeof WebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'run-1' }) }),
  );

  const mockDispatchEvent = vi.fn();
  window.dispatchEvent = mockDispatchEvent;

  const mockPush = vi.fn();
  return { wsInstances, mockPush, mockDispatchEvent };
});

vi.mock('../notificationStore', () => ({
  useNotificationStore: {
    getState: () => ({ push: mockPush }),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { useWsStore } from '../wsStore';

describe('wsStore expanded coverage', () => {
  async function flushMicrotasks(times = 4) {
    for (let i = 0; i < times; i += 1) {
      await Promise.resolve();
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    wsInstances.length = 0;
    mockPush.mockClear();
    mockDispatchEvent.mockClear();

    useWsStore.setState({
      connectionState: 'offline',
      lastEvent: null,
      listeners: new Map(),
      _socket: null,
      _currentRunId: undefined,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('connect() creates websocket with runId URL and sets connecting state', () => {
    useWsStore.getState().connect('run-42');

    expect(wsInstances.length).toBe(1);
    expect(wsInstances[0].url).toContain('/ws?runId=run-42');
    expect(useWsStore.getState().connectionState).toBe('connecting');
    expect(useWsStore.getState()._currentRunId).toBe('run-42');
  });

  it('connect() skips creating duplicate socket for same active runId', () => {
    useWsStore.getState().connect('run-1');
    useWsStore.getState().connect('run-1');

    expect(wsInstances.length).toBe(1);
  });

  it('connect() closes current socket immediately when switching run ids', () => {
    useWsStore.getState().connect('run-1');
    const firstSocket = wsInstances[0];

    useWsStore.getState().connect('run-2');

    expect(firstSocket.close).toHaveBeenCalledTimes(1);
    expect(useWsStore.getState()._currentRunId).toBe('run-2');
    expect(wsInstances.length).toBe(2);
  });

  it('disconnect() closes existing socket and sets offline state', () => {
    useWsStore.getState().connect('run-1');
    const socket = wsInstances[0];

    useWsStore.getState().disconnect();

    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(useWsStore.getState().connectionState).toBe('offline');
    expect(useWsStore.getState()._socket).toBeNull();
  });

  it('handles onmessage by parsing JSON and updating lastEvent', () => {
    useWsStore.getState().connect('run-1');
    const socket = wsInstances[0];
    const eventHandler = vi.fn();
    useWsStore.getState().subscribe('test:end', eventHandler);

    socket.onmessage?.({
      data: JSON.stringify({ type: 'test:end', runId: 'run-1', payload: { status: 'passed' } }),
    });

    expect(useWsStore.getState().lastEvent).toEqual({
      type: 'test:end',
      runId: 'run-1',
      payload: { status: 'passed' },
    });
    expect(eventHandler).toHaveBeenCalledTimes(1);
  });

  it('ignores heartbeat pong messages', () => {
    const handleMessageSpy = vi.spyOn(useWsStore.getState(), '_handleMessage');
    useWsStore.getState().connect('run-1');
    const socket = wsInstances[0];

    socket.onmessage?.({ data: JSON.stringify({ type: 'pong' }) });

    expect(handleMessageSpy).not.toHaveBeenCalled();
  });

  it('starts heartbeat on open and sends ping while connected', () => {
    useWsStore.getState().connect('run-1');
    const socket = wsInstances[0];

    socket.onopen?.({});
    expect(useWsStore.getState().connectionState).toBe('connected');

    vi.advanceTimersByTime(30_000);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }));
  });

  it('handles onclose by entering reconnecting and creating new socket after delay', () => {
    useWsStore.getState().connect('run-1');
    const socket = wsInstances[0];

    socket.onopen?.({});
    socket.onclose?.({});

    expect(useWsStore.getState().connectionState).toBe('reconnecting');
    expect(useWsStore.getState()._socket).toBeNull();

    vi.advanceTimersByTime(1_999);
    expect(wsInstances.length).toBe(1);

    vi.advanceTimersByTime(1);
    expect(wsInstances.length).toBe(2);
  });

  it('handles websocket errors without forcing offline state', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    useWsStore.getState().connect('run-1');
    const socket = wsInstances[0];

    socket.onopen?.({});
    socket.onerror?.(new Event('error'));

    expect(warnSpy).toHaveBeenCalledWith('[ws] WebSocket error', expect.any(Event));
    expect(useWsStore.getState().connectionState).toBe('connected');
  });

  it('warns when incoming message JSON cannot be parsed', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    useWsStore.getState().connect('run-1');
    const socket = wsInstances[0];
    socket.onmessage?.({ data: '{invalid json' });

    expect(warnSpy).toHaveBeenCalledWith('[ws] Failed to parse message');
  });

  it('rehydrates and dispatches ws:reconnected event after reconnect open', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'run-1' }),
    } as Response);

    useWsStore.getState().connect('run-1');
    const firstSocket = wsInstances[0];
    firstSocket.onopen?.({});
    firstSocket.onclose?.({});

    vi.advanceTimersByTime(2_000);
    const reconnectedSocket = wsInstances[1];
    reconnectedSocket.onopen?.({});

    expect(fetchMock).toHaveBeenCalledWith('/api/runs/run-1');
    await flushMicrotasks();
    expect(mockDispatchEvent).toHaveBeenCalledTimes(1);

    const dispatchedEvent = mockDispatchEvent.mock.calls[0]?.[0];
    expect(dispatchedEvent).toBeInstanceOf(CustomEvent);
    expect((dispatchedEvent as CustomEvent).type).toBe('ws:reconnected');
    expect((dispatchedEvent as CustomEvent).detail).toEqual({ runId: 'run-1' });
  });

  it('does not dispatch ws:reconnected event when run rehydrate response is not ok', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ id: 'run-1' }),
    } as Response);

    useWsStore.getState().connect('run-1');
    const firstSocket = wsInstances[0];
    firstSocket.onopen?.({});
    firstSocket.onclose?.({});

    vi.advanceTimersByTime(2_000);
    const reconnectedSocket = wsInstances[1];
    reconnectedSocket.onopen?.({});

    expect(fetchMock).toHaveBeenCalledWith('/api/runs/run-1');
    await flushMicrotasks();
    expect(mockDispatchEvent).not.toHaveBeenCalled();
  });

  it('closes current socket and cancels pending reconnect when switching run ids', () => {
    useWsStore.getState().connect('run-1');
    const firstSocket = wsInstances[0];
    firstSocket.onopen?.({});
    firstSocket.onclose?.({});

    vi.advanceTimersByTime(2_000);
    const reconnectSocket = wsInstances[1];
    reconnectSocket.onopen?.({});

    useWsStore.getState().connect('run-2');

    expect(reconnectSocket.close).toHaveBeenCalledTimes(1);
    expect(useWsStore.getState()._currentRunId).toBe('run-2');
    expect(wsInstances.length).toBe(3);
  });
});
