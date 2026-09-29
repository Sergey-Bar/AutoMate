import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultApiClient, isAbortError, type Run, type RunEvent } from '../lib/api.js';
import { useRequestLifecycle } from './use-request-lifecycle.js';

const ACTIVE_PHASES = new Set<Run['phase']>([
  'queued',
  'assigned',
  'preparing',
  'running',
  'collecting',
  'normalizing',
  'analyzing',
  'gate_evaluation',
]);

export function projectRunEvent(run: Run, event: RunEvent): Run {
  switch (event.type) {
    case 'run.queued':
      return { ...run, phase: event.payload.phase, outcome: event.payload.outcome };
    case 'run.assigned':
      return { ...run, phase: event.payload.phase, outcome: event.payload.outcome };
    case 'run.started':
      return { ...run, phase: event.payload.phase, outcome: event.payload.outcome };
    case 'run.phase_changed':
      return { ...run, phase: event.payload.phase, outcome: event.payload.outcome };
    case 'run.completed':
      return {
        ...run,
        phase: event.payload.phase,
        outcome: event.payload.outcome,
        finishedAt: event.payload.finishedAt,
      };
    default:
      return run;
  }
}

/**
 * Take ownership of the next request, cancelling whatever is still in flight.
 *
 * The 5-second poll, an SSE-driven refetch and the initial load can all be
 * in flight at once, and the last one started is the only one whose answer is
 * still wanted — the earlier ones hold their sockets open and then write over the
 * newer result. One controller at a time makes "superseded" a fact rather than a
 * race.
 */
export function useRuns(api = defaultApiClient) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isLive, setIsLive] = useState(false);
  /** Mirrors `isLive` for the poll interval, whose closure is created once. */
  const isLiveRef = useRef(false);
  const runsRef = useRef<Run[]>([]);
  const mountedRef = useRef(true);
  const { begin: beginLoad, cancelAll: cancelLoads } = useRequestLifecycle();

  const refresh = useCallback(
    async (showLoading = false) => {
      if (!mountedRef.current) return;
      if (showLoading) setIsLoading(true);
      const signal = beginLoad();
      try {
        const data = await api.getRuns({ signal });
        if (!mountedRef.current) return;
        runsRef.current = data;
        setRuns(data);
        setError(null);
      } catch (caught) {
        // A cancellation is something this hook asked for, so it is not a
        // failure and must not replace a rendered list with an error.
        if (isAbortError(caught)) return;
        if (mountedRef.current) {
          setError(caught instanceof Error ? caught : new Error('Failed to fetch runs'));
        }
      } finally {
        if (showLoading && mountedRef.current) setIsLoading(false);
      }
    },
    [api, beginLoad],
  );

  useEffect(() => {
    mountedRef.current = true;
    void refresh(true);

    const unsubscribe = api.subscribeToRunEvents({
      onEvent: (event) => {
        const knownRun = runsRef.current.find((run) => run.id === event.runId);
        setRuns((current) => {
          const index = current.findIndex((run) => run.id === event.runId);
          if (index < 0) return current;
          const updated = [...current];
          updated[index] = projectRunEvent(updated[index] as Run, event);
          runsRef.current = updated;
          return updated;
        });
        const needsRefresh =
          !knownRun ||
          event.type.startsWith('test.') ||
          event.type === 'artifact.created' ||
          event.type === 'gate.evaluated';
        if (needsRefresh) void refresh();
      },
      onReconnect: () => void refresh(),
      onConnectionChange: (live) => {
        isLiveRef.current = live;
        setIsLive(live);
      },
    });

    // The poller is a safety net, not a second source of truth.
    //
    // It used to refresh the whole list every five seconds regardless of whether
    // the stream was connected — so on a healthy connection every page paid for a
    // full list fetch to discover what the stream had already pushed, and the
    // fetch was also a chance for a run added by *another* session to arrive
    // before it had an event (ledger W-5).
    //
    // It now runs only while the stream is down, which is the only case where
    // polling is the only way to learn anything. Connected, the stream is
    // authoritative and this does nothing; disconnected, it is what keeps the
    // page honest.
    //
    // A ref rather than the state value, because the interval closure is created
    // once and would otherwise capture the first render's `false` forever.
    const poll = window.setInterval(() => {
      if (isLiveRef.current) return;
      void refresh();
    }, 5000);
    return () => {
      mountedRef.current = false;
      cancelLoads();
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [api, refresh, cancelLoads]);

  return { runs, isLoading, error, isLive, refresh };
}

export function isRunActive(run: Run): boolean {
  return ACTIVE_PHASES.has(run.phase);
}
