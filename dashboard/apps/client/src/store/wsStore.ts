import { create } from 'zustand';
import type { WsEvent, WsEventType } from '@/lib/types';
import { useNotificationStore } from './notificationStore';
import { toast } from 'sonner';

const WS_EVENT_TYPES: ReadonlySet<string> = new Set<WsEventType>([
  'connected', 'run:start', 'test:begin', 'test:end',
  'step:begin', 'step:end', 'stdout', 'stderr', 'run:end', 'artifact:new',
]);

/** Runtime type guard — validates shape before we trust the data. */
function isWsEvent(raw: unknown): raw is WsEvent {
  if (typeof raw !== 'object' || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  return typeof obj.type === 'string' && WS_EVENT_TYPES.has(obj.type) && typeof obj.runId === 'string';
}

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

interface WsStore {
  connectionState: ConnectionState;
  lastEvent: WsEvent | null;
  listeners: Map<string, Set<(event: WsEvent) => void>>;
  _socket: WebSocket | null;
  _currentRunId: string | undefined;

  connect: (runId?: string) => void;
  disconnect: () => void;
  subscribe: (type: string, handler: (event: WsEvent) => void) => () => void;
  _handleMessage: (event: WsEvent) => void;
}

const WS_BASE = import.meta.env.VITE_WS_URL ?? `ws://${window.location.host}/ws`;
const RECONNECT_DELAY_MS = 1_000;   // RELY-01: start at 1s (was 2s)
const MAX_RECONNECT_MS = 30_000;
const HEARTBEAT_MS = 30_000;        // RELY-03: 30s ping/pong

export const useWsStore = create<WsStore>((set, get) => {
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = RECONNECT_DELAY_MS;
  let intentionalDisconnect = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;  // RELY-03

  function createSocket(runId?: string) {
    const url = runId ? `${WS_BASE}?runId=${runId}` : WS_BASE;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      const wasReconnecting = get().connectionState === 'reconnecting';
      set({ connectionState: 'connected' });
      reconnectDelay = RECONNECT_DELAY_MS;

      // Start heartbeat (RELY-03)
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, HEARTBEAT_MS);

      // Restore live run state from REST on reconnect (RELY-02)
      if (wasReconnecting && runId) {
        fetch(`/api/runs/${runId}`)
          .then((r) => r.ok ? r.json() : null)
          .then((run) => {
            if (!run) return;
            // Dispatch custom event so run detail page can invalidate its TanStack Query cache
            window.dispatchEvent(new CustomEvent('ws:reconnected', { detail: { runId } }));
          })
          .catch((err) => { console.warn('[ws] REST rehydration failed on reconnect', err); });
      }
    };

    ws.onmessage = (msg) => {
      try {
        const raw: unknown = JSON.parse(msg.data);
        // Heartbeat reply — skip silently
        if (typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>).type === 'pong') return;
        if (!isWsEvent(raw)) {
          console.warn('[ws] Ignoring message with unexpected shape');
          return;
        }
        get()._handleMessage(raw);
      } catch {
        console.warn('[ws] Failed to parse message');
      }
    };

    ws.onclose = () => {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (intentionalDisconnect) {
        set({ connectionState: 'offline', _socket: null });
        intentionalDisconnect = false;
        return;
      }
      set({ connectionState: 'reconnecting', _socket: null });
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
      reconnectTimeout = setTimeout(() => {
        createSocket(runId);
      }, reconnectDelay);
    };

    // RELY-01: don't set 'offline' on error — onclose fires after onerror and drives the reconnect loop
    ws.onerror = (err) => {
      console.warn('[ws] WebSocket error', err);
      // onclose will fire after onerror and trigger the reconnect loop
    };

    set({ _socket: ws });
    return ws;
  }

  return {
    connectionState: 'offline',
    lastEvent: null,
    listeners: new Map(),
    _socket: null,
    _currentRunId: undefined,

    connect: (runId) => {
      // A new connect() call is always intentional — reset any pending disconnect flag
      intentionalDisconnect = false;
      const current = get()._socket;
      const currentRunId = get()._currentRunId;
      // If already connected to the same runId, skip
      if (current && current.readyState <= 1 && currentRunId === runId) return;
      // If connected to a different runId, close old socket first
      if (current && current.readyState <= 1) {
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        current.close();
      }
      set({ connectionState: 'connecting', _currentRunId: runId });
      createSocket(runId);
    },

    disconnect: () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      intentionalDisconnect = true;
      get()._socket?.close();
      set({ connectionState: 'offline', _socket: null });
    },

    subscribe: (type, handler) => {
      const listeners = get().listeners;
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(handler);
      return () => listeners.get(type)?.delete(handler);
    },

    _handleMessage: (event) => {
      set({ lastEvent: event });

      // Push notification on run:end
      if (event.type === 'run:end') {
        const p = event.payload as Record<string, unknown>;
        const status = (p?.status as string) ?? 'finished';
        const failed = (p?.failed as number) ?? 0;
        useNotificationStore.getState().push({
          type: 'run:end',
          title: `Run ${status}`,
          description: failed > 0 ? `${failed} test(s) failed` : 'All tests passed',
          runId: event.runId,
        });

        // Sonner toast
        if (failed > 0) {
          toast.error(`Run finished — ${failed} test(s) failed`, { duration: 5000 });
        } else {
          toast.success('Run finished — all tests passed', { duration: 4000 });
        }
      }

      const handlers = get().listeners.get(event.type);
      if (handlers) for (const h of handlers) h(event);
      // also emit to wildcard '*' listeners
      const wildcards = get().listeners.get('*');
      if (wildcards) for (const h of wildcards) h(event);
    },
  };
});
