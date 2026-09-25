/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Globals must be set before wsStore module is evaluated ---
// vi.hoisted runs before imports are resolved
const { mockPush } = vi.hoisted(() => {
  const mockPush = vi.fn();

  // Mock WebSocket class
  class MockWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    static CONNECTING = 0;
    static CLOSING = 2;

    url: string;
    readyState = 1;
    onopen: ((ev: unknown) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: unknown) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    send = vi.fn();
    close = vi.fn();

    constructor(url: string) {
      this.url = url;
    }
  }

  // Set up globals that wsStore.ts needs at module level
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  globalThis.window = {
    location: { host: 'localhost:5173' },
    matchMedia: vi.fn().mockReturnValue({ matches: false }),
    dispatchEvent: vi.fn(),
    CustomEvent: class MockCustomEvent {
      type: string;
      detail: unknown;
      constructor(type: string, opts?: { detail?: unknown }) {
        this.type = type;
        this.detail = opts?.detail;
      }
    },
  } as unknown as Window & typeof globalThis;
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
  }) as unknown as typeof fetch;

  return { mockPush };
});

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock notificationStore
vi.mock('./notificationStore', () => ({
  useNotificationStore: {
    getState: () => ({
      push: mockPush,
    }),
  },
}));

import { useWsStore } from './wsStore';
import { toast } from 'sonner';

// Helper: trigger onopen on the current socket
function triggerOpen() {
  const socket = useWsStore.getState()._socket;
  if (socket?.onopen) socket.onopen(new Event('open'));
}

// Helper: trigger onclose on the current socket
function triggerClose() {
  const socket = useWsStore.getState()._socket;
  if (socket?.onclose) socket.onclose(new CloseEvent('close'));
}

// Helper: trigger onmessage on the current socket with a raw object payload
function triggerMessage(data: unknown) {
  const socket = useWsStore.getState()._socket;
  if (socket?.onmessage) socket.onmessage({ data: JSON.stringify(data) });
}

describe('wsStore', () => {
  beforeEach(() => {
    vi.useRealTimers();
    useWsStore.setState({
      connectionState: 'offline',
      lastEvent: null,
      listeners: new Map(),
      _socket: null,
      _currentRunId: undefined,
    });
    // Reset mock send counts
    vi.mocked(globalThis.fetch).mockReset();
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);
    mockPush.mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  describe('initial state', () => {
    it('starts offline with no socket', () => {
      const state = useWsStore.getState();
      expect(state.connectionState).toBe('offline');
      expect(state.lastEvent).toBeNull();
      expect(state._socket).toBeNull();
    });
  });

  describe('subscribe', () => {
    it('adds a listener for an event type', () => {
      const handler = vi.fn();
      useWsStore.getState().subscribe('run:start', handler);
      expect(useWsStore.getState().listeners.get('run:start')?.size).toBe(1);
    });

    it('returns an unsubscribe function', () => {
      const handler = vi.fn();
      const unsub = useWsStore.getState().subscribe('run:start', handler);
      unsub();
      expect(useWsStore.getState().listeners.get('run:start')?.size).toBe(0);
    });

    it('supports multiple listeners for same event type', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      useWsStore.getState().subscribe('test:end', handler1);
      useWsStore.getState().subscribe('test:end', handler2);
      expect(useWsStore.getState().listeners.get('test:end')?.size).toBe(2);
    });

    it('supports multiple event types', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      useWsStore.getState().subscribe('run:start', handler1);
      useWsStore.getState().subscribe('run:end', handler2);
      expect(useWsStore.getState().listeners.get('run:start')?.size).toBe(1);
      expect(useWsStore.getState().listeners.get('run:end')?.size).toBe(1);
    });
  });

  describe('_handleMessage', () => {
    it('sets lastEvent', () => {
      const event = { type: 'test:begin' as const, runId: 'run-1', payload: {} };
      useWsStore.getState()._handleMessage(event);
      expect(useWsStore.getState().lastEvent).toEqual(event);
    });

    it('calls registered listeners for matching event type', () => {
      const handler = vi.fn();
      useWsStore.getState().subscribe('test:begin', handler);

      const event = { type: 'test:begin' as const, runId: 'run-1', payload: {} };
      useWsStore.getState()._handleMessage(event);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('does not call listeners for non-matching event type', () => {
      const handler = vi.fn();
      useWsStore.getState().subscribe('run:start', handler);

      const event = { type: 'test:begin' as const, runId: 'run-1', payload: {} };
      useWsStore.getState()._handleMessage(event);
      expect(handler).not.toHaveBeenCalled();
    });

    it('calls wildcard (*) listeners for any event', () => {
      const wildcardHandler = vi.fn();
      useWsStore.getState().subscribe('*', wildcardHandler);

      const event = { type: 'test:begin' as const, runId: 'run-1', payload: {} };
      useWsStore.getState()._handleMessage(event);
      expect(wildcardHandler).toHaveBeenCalledWith(event);
    });

    it('calls both specific and wildcard listeners', () => {
      const specificHandler = vi.fn();
      const wildcardHandler = vi.fn();
      useWsStore.getState().subscribe('test:end', specificHandler);
      useWsStore.getState().subscribe('*', wildcardHandler);

      const event = { type: 'test:end' as const, runId: 'run-1', payload: {} };
      useWsStore.getState()._handleMessage(event);
      expect(specificHandler).toHaveBeenCalledWith(event);
      expect(wildcardHandler).toHaveBeenCalledWith(event);
    });

    describe('run:end handling', () => {
      it('pushes notification on run:end', () => {
        const event = {
          type: 'run:end' as const,
          runId: 'run-1',
          payload: { status: 'passed', failed: 0 },
        };
        useWsStore.getState()._handleMessage(event);
        expect(mockPush).toHaveBeenCalledWith({
          type: 'run:end',
          title: 'Run passed',
          description: 'All tests passed',
          runId: 'run-1',
        });
      });

      it('shows success toast when all tests pass', () => {
        const event = {
          type: 'run:end' as const,
          runId: 'run-1',
          payload: { status: 'passed', failed: 0 },
        };
        useWsStore.getState()._handleMessage(event);
        expect(toast.success).toHaveBeenCalledWith(
          'Run finished \u2014 all tests passed',
          { duration: 4000 },
        );
      });

      it('shows error toast when tests fail', () => {
        const event = {
          type: 'run:end' as const,
          runId: 'run-1',
          payload: { status: 'failed', failed: 3 },
        };
        useWsStore.getState()._handleMessage(event);
        expect(toast.error).toHaveBeenCalledWith(
          'Run finished \u2014 3 test(s) failed',
          { duration: 5000 },
        );
      });

      it('pushes notification with failure description', () => {
        const event = {
          type: 'run:end' as const,
          runId: 'run-1',
          payload: { status: 'failed', failed: 5 },
        };
        useWsStore.getState()._handleMessage(event);
        expect(mockPush).toHaveBeenCalledWith({
          type: 'run:end',
          title: 'Run failed',
          description: '5 test(s) failed',
          runId: 'run-1',
        });
      });

      it('handles run:end with no explicit status', () => {
        const event = {
          type: 'run:end' as const,
          runId: 'run-1',
          payload: {},
        };
        useWsStore.getState()._handleMessage(event);
        expect(mockPush).toHaveBeenCalledWith({
          type: 'run:end',
          title: 'Run finished',
          description: 'All tests passed',
          runId: 'run-1',
        });
      });
    });
  });

  describe('connect', () => {
    it('creates a WebSocket connection', () => {
      useWsStore.getState().connect();
      expect(useWsStore.getState().connectionState).toBe('connecting');
    });

    it('creates a WebSocket with runId', () => {
      useWsStore.getState().connect('run-42');
      expect(useWsStore.getState()._currentRunId).toBe('run-42');
    });
  });

  describe('disconnect', () => {
    it('sets state to offline', () => {
      useWsStore.getState().connect();
      useWsStore.getState().disconnect();
      expect(useWsStore.getState().connectionState).toBe('offline');
      expect(useWsStore.getState()._socket).toBeNull();
    });

    it('intentional disconnect via onclose callback sets offline and clears socket (lines 75-77)', () => {
      // Lines 74-77: if (intentionalDisconnect) { set({ connectionState: 'offline', _socket: null }); intentionalDisconnect = false; return; }
      // The disconnect() method sets intentionalDisconnect = true then calls socket.close().
      // The socket's close mock doesn't fire onclose automatically — but disconnect() also calls
      // set({ connectionState: 'offline', _socket: null }) directly.
      // To test the onclose path: we need to trigger onclose AFTER disconnect() sets the flag.
      useWsStore.getState().connect();

      const socket = useWsStore.getState()._socket;
      expect(socket).not.toBeNull();

      // Call disconnect() which sets intentionalDisconnect = true
      useWsStore.getState().disconnect();

      // At this point disconnect() already set state to offline via the direct set() call.
      // Now simulate the socket's onclose firing (which is the code path on lines 74-77).
      // This verifies that the intentionalDisconnect path short-circuits reconnect logic.
      if (socket && socket.onclose) {
        socket.onclose(new CloseEvent('close'));
      }

      expect(useWsStore.getState().connectionState).toBe('offline');
      expect(useWsStore.getState()._socket).toBeNull();
    });
  });

  describe('heartbeat', () => {
    it('sends a ping message after HEARTBEAT_MS (30s) when connected', () => {
      vi.useFakeTimers();
      useWsStore.getState().connect();
      const socket = useWsStore.getState()._socket!;
      expect(socket).not.toBeNull();

      // Trigger open to start heartbeat
      triggerOpen();
      expect(useWsStore.getState().connectionState).toBe('connected');

      // Before 30s — no ping yet
      vi.advanceTimersByTime(29_999);
      expect(socket.send).not.toHaveBeenCalled();

      // At exactly 30s — first ping fires
      vi.advanceTimersByTime(1);
      expect(socket.send).toHaveBeenCalledTimes(1);
      expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }));

      // Another 30s — second ping fires
      vi.advanceTimersByTime(30_000);
      expect(socket.send).toHaveBeenCalledTimes(2);
    });

    it('sends multiple pings at 30s intervals', () => {
      vi.useFakeTimers();
      useWsStore.getState().connect();
      const socket = useWsStore.getState()._socket!;

      triggerOpen();

      vi.advanceTimersByTime(90_000); // 3 intervals
      expect(socket.send).toHaveBeenCalledTimes(3);
      for (const call of socket.send.mock.calls) {
        expect(call[0]).toBe(JSON.stringify({ type: 'ping' }));
      }
    });
  });

  describe('heartbeat cleanup', () => {
    it('clears heartbeat interval when the socket closes', () => {
      vi.useFakeTimers();
      useWsStore.getState().connect();
      const socket = useWsStore.getState()._socket!;

      triggerOpen();

      // Verify pings fire while open
      vi.advanceTimersByTime(30_000);
      expect(socket.send).toHaveBeenCalledTimes(1);

      // Simulate close — heartbeat should be cleared
      triggerClose();

      const sendCountAfterClose = socket.send.mock.calls.length;
      vi.advanceTimersByTime(60_000); // advance 2 more intervals
      // send count must not increase — interval was cleared
      expect(socket.send).toHaveBeenCalledTimes(sendCountAfterClose);
    });

    it('clears heartbeat interval when disconnect() is called', () => {
      vi.useFakeTimers();
      useWsStore.getState().connect();
      const socket = useWsStore.getState()._socket!;

      triggerOpen();

      vi.advanceTimersByTime(30_000);
      expect(socket.send).toHaveBeenCalledTimes(1);

      // Intentional disconnect — heartbeat must stop
      useWsStore.getState().disconnect();

      const sendCountAfterDisconnect = socket.send.mock.calls.length;
      vi.advanceTimersByTime(60_000);
      expect(socket.send).toHaveBeenCalledTimes(sendCountAfterDisconnect);
      expect(useWsStore.getState().connectionState).toBe('offline');
    });
  });

  describe('pong message handling', () => {
    it('silently ignores pong messages — does not update lastEvent', () => {
      useWsStore.getState().connect();
      triggerOpen();

      const initialLastEvent = useWsStore.getState().lastEvent;
      triggerMessage({ type: 'pong' });

      expect(useWsStore.getState().lastEvent).toBe(initialLastEvent);
    });

    it('does not call any listeners when a pong message is received', () => {
      useWsStore.getState().connect();
      triggerOpen();

      const wildcardHandler = vi.fn();
      useWsStore.getState().subscribe('*', wildcardHandler);

      triggerMessage({ type: 'pong' });

      expect(wildcardHandler).not.toHaveBeenCalled();
    });
  });

  describe('reconnect backoff', () => {
    it('reconnect delay doubles on first close (1s → 2s)', () => {
      vi.useFakeTimers();
      // Fresh connect + open to reset reconnectDelay to RECONNECT_DELAY_MS (1000)
      useWsStore.getState().connect();
      triggerOpen(); // resets reconnectDelay = 1000

      const socket1 = useWsStore.getState()._socket!;

      // First close — delay becomes Math.min(1000 * 2, 30000) = 2000
      triggerClose();
      expect(useWsStore.getState().connectionState).toBe('reconnecting');

      // Advance 1999ms — no reconnect yet
      vi.advanceTimersByTime(1999);
      expect(useWsStore.getState()._socket).toBeNull();

      // Advance 1ms more — reconnect fires (delay=2000)
      vi.advanceTimersByTime(1);
      const socket2 = useWsStore.getState()._socket;
      expect(socket2).not.toBeNull();
      expect(socket2).not.toBe(socket1);
    });

    it('reconnect delay doubles again on second close (2s → 4s)', () => {
      vi.useFakeTimers();
      // Reset delay via fresh connect + open
      useWsStore.getState().connect();
      triggerOpen(); // reconnectDelay = 1000

      // First close → delay = 2000
      triggerClose();
      vi.advanceTimersByTime(2000); // triggers reconnect
      expect(useWsStore.getState()._socket).not.toBeNull();

      // Second close → delay = Math.min(2000 * 2, 30000) = 4000
      triggerClose();
      expect(useWsStore.getState().connectionState).toBe('reconnecting');

      vi.advanceTimersByTime(3999);
      expect(useWsStore.getState()._socket).toBeNull();

      vi.advanceTimersByTime(1);
      expect(useWsStore.getState()._socket).not.toBeNull();
    });

    it('reconnect delay is capped at MAX_RECONNECT_MS (30s)', () => {
      vi.useFakeTimers();
      // Reset delay via connect + open
      useWsStore.getState().connect();
      triggerOpen(); // reconnectDelay = 1000

      // Repeatedly close to grow delay past cap:
      // close 1: delay = min(1000*2, 30000) = 2000, advance 2000 → reconnect
      // close 2: delay = min(2000*2, 30000) = 4000, advance 4000 → reconnect
      // close 3: delay = min(4000*2, 30000) = 8000, advance 8000 → reconnect
      // close 4: delay = min(8000*2, 30000) = 16000, advance 16000 → reconnect
      // close 5: delay = min(16000*2, 30000) = 30000, advance 30000 → reconnect
      const delays = [2000, 4000, 8000, 16000, 30000];
      for (const delay of delays) {
        triggerClose();
        vi.advanceTimersByTime(delay);
        expect(useWsStore.getState()._socket).not.toBeNull();
      }

      // After the last reconnect, delay should still be capped at 30000
      // close 6: delay = min(30000*2, 30000) = 30000
      triggerClose();
      expect(useWsStore.getState().connectionState).toBe('reconnecting');

      // Should NOT reconnect at 29999ms
      vi.advanceTimersByTime(29_999);
      expect(useWsStore.getState()._socket).toBeNull();

      // Should reconnect at 30000ms (cap)
      vi.advanceTimersByTime(1);
      expect(useWsStore.getState()._socket).not.toBeNull();
    });
  });

  describe('intentional disconnect — no reconnect', () => {
    it('does not attempt reconnect after disconnect() is called', () => {
      vi.useFakeTimers();
      useWsStore.getState().connect();
      triggerOpen();

      // Capture socket before disconnect (it gets cleared by disconnect())
      const socket = useWsStore.getState()._socket!;

      // Intentional disconnect
      useWsStore.getState().disconnect();

      // Simulate onclose firing AFTER disconnect has set intentionalDisconnect = true
      if (socket.onclose) socket.onclose(new CloseEvent('close'));

      // Advance well past any reconnect delay
      vi.advanceTimersByTime(60_000);

      // State must remain offline — no new socket created
      expect(useWsStore.getState().connectionState).toBe('offline');
      expect(useWsStore.getState()._socket).toBeNull();
    });
  });

  describe('reconnect rehydration', () => {
    it('calls fetch for the runId when reconnecting', async () => {
      vi.useFakeTimers();
      useWsStore.getState().connect('test-run-99');
      triggerOpen(); // connectionState = 'connected', wasReconnecting = false

      // Close to trigger reconnect
      triggerClose();
      expect(useWsStore.getState().connectionState).toBe('reconnecting');

      // Let the reconnect timer fire (delay = 2000 after first close)
      vi.advanceTimersByTime(2000);
      expect(useWsStore.getState()._socket).not.toBeNull();

      // Trigger onopen on new socket — wasReconnecting should be true
      vi.useRealTimers();
      triggerOpen();

      // Allow microtask queue to flush
      await Promise.resolve();

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/runs/test-run-99');
    });

    it('dispatches ws:reconnected CustomEvent when rehydration succeeds', async () => {
      vi.useFakeTimers();
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'test-run-99', status: 'passed' }),
      } as Response);

      useWsStore.getState().connect('test-run-99');
      triggerOpen();

      triggerClose();
      vi.advanceTimersByTime(2000);

      vi.useRealTimers();
      triggerOpen();

      // Flush all promises
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ws:reconnected' }),
      );
    });

    it('does not dispatch event when fetch returns ok=false', async () => {
      vi.useFakeTimers();
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: false,
        json: () => Promise.resolve(null),
      } as Response);
      vi.mocked(window.dispatchEvent).mockClear();

      useWsStore.getState().connect('test-run-99');
      triggerOpen();

      triggerClose();
      vi.advanceTimersByTime(2000);

      vi.useRealTimers();
      triggerOpen();

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(window.dispatchEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ws:reconnected' }),
      );
    });

    it('does not call fetch when there is no runId on reconnect', async () => {
      vi.useFakeTimers();
      // Connect without a runId
      useWsStore.getState().connect();
      triggerOpen();

      triggerClose();
      vi.advanceTimersByTime(2000);

      vi.useRealTimers();
      triggerOpen();

      await Promise.resolve();

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  describe('reconnect rehydration failure', () => {
    it('catches fetch errors and logs a warning — does not throw', async () => {
      vi.useFakeTimers();
      const fetchError = new Error('Network failure');
      vi.mocked(globalThis.fetch).mockRejectedValue(fetchError);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      useWsStore.getState().connect('run-error-test');
      triggerOpen();

      triggerClose();
      vi.advanceTimersByTime(2000);

      vi.useRealTimers();
      triggerOpen();

      // Flush microtasks and macrotasks
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(warnSpy).toHaveBeenCalledWith(
        '[ws] REST rehydration failed on reconnect',
        fetchError,
      );

      warnSpy.mockRestore();
    });

    it('remains in connected state even after rehydration fetch failure', async () => {
      vi.useFakeTimers();
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Network failure'));

      useWsStore.getState().connect('run-error-test');
      triggerOpen();

      triggerClose();
      vi.advanceTimersByTime(2000);

      vi.useRealTimers();
      triggerOpen();

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(useWsStore.getState().connectionState).toBe('connected');
    });
  });
});
