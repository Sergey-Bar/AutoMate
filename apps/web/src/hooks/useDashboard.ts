import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultApiClient,
  type AnalyticsSummary,
  type ArtifactDescriptor,
  type GateEvaluation,
  type QuarantineEntry,
  type ReleaseReadiness,
  type Run,
  type RunEvent,
} from '../lib/api.js';
import { projectRunEvent } from './useRuns.js';

export function useAnalytics(api = defaultApiClient) {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    void api
      .getAnalyticsSummary()
      .then((result) => {
        if (!mounted) return;
        setData(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (mounted)
          setError(caught instanceof Error ? caught : new Error('Analytics unavailable'));
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [api]);

  return { data, isLoading, error };
}

export interface RunDetailData {
  run: Run | null;
  artifacts: ArtifactDescriptor[];
  gate: GateEvaluation | null;
  readiness: ReleaseReadiness | null;
  events: RunEvent[];
  evidenceError: Error | null;
}

export function useRunDetail(id: string, api = defaultApiClient) {
  const [data, setData] = useState<RunDetailData>({
    run: null,
    artifacts: [],
    gate: null,
    readiness: null,
    events: [],
    evidenceError: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const mountedRef = useRef(true);
  const seenEvents = useRef(new Set<string>());

  const refresh = useCallback(
    async (showLoading = false) => {
      if (!mountedRef.current) return;
      if (showLoading) setIsLoading(true);
      try {
        const run = await api.getRun(id);
        if (!mountedRef.current) return;
        setData((current) => ({ ...current, run }));
        setError(null);

        const [artifactsResult, gateResult, readinessResult] = await Promise.allSettled([
          api.getRunArtifacts(id),
          api.getRunGate(id),
          run.releaseId ? api.getReleaseReadiness(run.releaseId) : Promise.resolve(null),
        ]);
        if (!mountedRef.current) return;

        const failures = [artifactsResult, gateResult, readinessResult].filter(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        setData((current) => ({
          ...current,
          run,
          artifacts:
            artifactsResult.status === 'fulfilled' ? artifactsResult.value : current.artifacts,
          gate:
            run.policyEvaluation ?? (gateResult.status === 'fulfilled' ? gateResult.value : null),
          readiness:
            readinessResult.status === 'fulfilled' ? readinessResult.value : current.readiness,
          evidenceError:
            failures.length > 0 ? new Error('Some run evidence could not be loaded') : null,
        }));
      } catch (caught) {
        if (mountedRef.current) {
          setError(caught instanceof Error ? caught : new Error('Failed to fetch run'));
        }
      } finally {
        if (showLoading && mountedRef.current) setIsLoading(false);
      }
    },
    [api, id],
  );

  useEffect(() => {
    mountedRef.current = true;
    seenEvents.current.clear();
    void refresh(true);
    const unsubscribe = api.subscribeToRunEvents({
      onEvent: (event) => {
        if (event.runId !== id || seenEvents.current.has(event.eventId)) return;
        seenEvents.current.add(event.eventId);
        setData((current) => {
          const events = current.events.some((item) => item.eventId === event.eventId)
            ? current.events
            : [...current.events, event];
          return {
            ...current,
            events,
            run: current.run ? projectRunEvent(current.run, event) : current.run,
            artifacts:
              event.type === 'artifact.created'
                ? [
                    ...current.artifacts.filter(
                      (artifact) => artifact.id !== event.payload.artifact.id,
                    ),
                    event.payload.artifact,
                  ]
                : current.artifacts,
            gate: event.type === 'gate.evaluated' ? event.payload.evaluation : current.gate,
          };
        });
        if (
          event.type.startsWith('test.') ||
          event.type === 'artifact.created' ||
          event.type === 'gate.evaluated'
        ) {
          void refresh();
        }
      },
      onReconnect: () => void refresh(),
      onConnectionChange: setIsLive,
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [api, id, refresh]);

  const cancel = useCallback(async () => {
    setIsActing(true);
    setActionError(null);
    try {
      const run = await api.cancelRun(id);
      setData((current) => ({ ...current, run }));
      await refresh();
      return run;
    } catch (caught) {
      const actionFailure = caught instanceof Error ? caught : new Error('Failed to cancel run');
      setActionError(actionFailure);
      throw actionFailure;
    } finally {
      if (mountedRef.current) setIsActing(false);
    }
  }, [api, id, refresh]);

  const retry = useCallback(async () => {
    setIsActing(true);
    setActionError(null);
    try {
      const run = await api.retryRun(id);
      setData((current) => ({ ...current, run, events: [], artifacts: [], gate: null }));
      return run;
    } catch (caught) {
      const actionFailure = caught instanceof Error ? caught : new Error('Failed to retry run');
      setActionError(actionFailure);
      throw actionFailure;
    } finally {
      if (mountedRef.current) setIsActing(false);
    }
  }, [api, id]);

  return {
    ...data,
    isLoading,
    error,
    actionError,
    isActing,
    isLive,
    refresh,
    cancel,
    retry,
  };
}

export function useReleaseReadiness(releaseId: string | null, api = defaultApiClient) {
  const [data, setData] = useState<ReleaseReadiness | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(releaseId));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!releaseId) {
      setData(null);
      setIsLoading(false);
      return () => {
        mounted = false;
      };
    }
    setIsLoading(true);
    void api
      .getReleaseReadiness(releaseId)
      .then((result) => {
        if (!mounted) return;
        setData(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (mounted) {
          setError(caught instanceof Error ? caught : new Error('Release readiness unavailable'));
        }
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [api, releaseId]);

  return { data, isLoading, error };
}

export function useQuarantine(api = defaultApiClient) {
  const [data, setData] = useState<QuarantineEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    void api
      .getQuarantine()
      .then((result) => {
        if (!mounted) return;
        setData(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (mounted) {
          setError(caught instanceof Error ? caught : new Error('Quarantine unavailable'));
        }
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [api]);

  const addQuarantine = async (entry: { testTitle: string; testFile: string; reason?: string }) => {
    const created = await api.addQuarantine(entry);
    setData((current) => [...current, created]);
    return created;
  };

  return { data, isLoading, error, addQuarantine };
}
