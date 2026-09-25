import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultApiClient, type Run, type RunEvent } from '../lib/api.js';

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

export function useRuns(api = defaultApiClient) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isLive, setIsLive] = useState(false);
  const runsRef = useRef<Run[]>([]);
  const mountedRef = useRef(true);

  const refresh = useCallback(
    async (showLoading = false) => {
      if (!mountedRef.current) return;
      if (showLoading) setIsLoading(true);
      try {
        const data = await api.getRuns();
        if (!mountedRef.current) return;
        runsRef.current = data;
        setRuns(data);
        setError(null);
      } catch (caught) {
        if (mountedRef.current) {
          setError(caught instanceof Error ? caught : new Error('Failed to fetch runs'));
        }
      } finally {
        if (showLoading && mountedRef.current) setIsLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    mountedRef.current = true;
    void api
      .getRuns()
      .then((data) => {
        if (!mountedRef.current) return;
        runsRef.current = data;
        setRuns(data);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (mountedRef.current) {
          setError(caught instanceof Error ? caught : new Error('Failed to fetch runs'));
        }
      })
      .finally(() => {
        if (mountedRef.current) setIsLoading(false);
      });

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
      onConnectionChange: setIsLive,
    });

    const poll = window.setInterval(() => void refresh(), 5000);
    return () => {
      mountedRef.current = false;
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [api, refresh]);

  return { runs, isLoading, error, isLive, refresh };
}

export function isRunActive(run: Run): boolean {
  return ACTIVE_PHASES.has(run.phase);
}
