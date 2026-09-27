import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultApiClient,
  isAbortError,
  type AnalyticsSummary,
  type ArtifactDescriptor,
  type GateEvaluation,
  type QuarantineEntry,
  type ReleaseReadiness,
  type Run,
  type RunEvent,
} from '../lib/api.js';
import { useRequestLifecycle } from './use-request-lifecycle.js';
import { projectRunEvent } from './useRuns.js';

export function useAnalytics(api = defaultApiClient) {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { begin, cancelAll } = useRequestLifecycle();

  useEffect(() => {
    const signal = begin();
    void api
      .getAnalyticsSummary({ signal })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        // A request cancelled by unmount is not an analytics failure, and
        // reporting it would replace a rendered summary with an error.
        if (isAbortError(caught)) return;
        setError(caught instanceof Error ? caught : new Error('Analytics unavailable'));
      })
      .finally(() => {
        if (!signal.aborted) setIsLoading(false);
      });
    return () => {
      cancelAll();
    };
  }, [api, begin, cancelAll]);

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

/**
 * Folds three settled evidence requests into the next snapshot.
 *
 * Extracted from `refresh` because that function had grown a filter, an `every`, and
 * four ternaries inline — enough branching that the one question it really answers,
 * "is this a partial-evidence failure or a cancellation?", could no longer be read off
 * the code. It is pure, so the distinction is a table-test rather than an integration
 * test that has to be arranged to make a request abort.
 *
 * Returns `current` unchanged when every rejection was a cancellation: a cancellation
 * is not a partial-evidence failure, nothing is missing, and the answers are simply no
 * longer wanted. `refresh` calls this inside a `setData` updater rather than against a
 * captured `data`, because events arrive between renders and a captured copy would
 * silently discard them; React bails out on the identical reference, so the no-change
 * case costs no re-render.
 */
function foldEvidence(
  current: RunDetailData,
  run: Run,
  artifacts: PromiseSettledResult<ArtifactDescriptor[]>,
  gate: PromiseSettledResult<GateEvaluation | null>,
  readiness: PromiseSettledResult<ReleaseReadiness | null>,
): RunDetailData {
  const failures = [artifacts, gate, readiness].filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failures.length > 0 && failures.every((failure) => isAbortError(failure.reason))) {
    return current;
  }
  return {
    ...current,
    run,
    artifacts: artifacts.status === 'fulfilled' ? artifacts.value : current.artifacts,
    gate: run.policyEvaluation ?? (gate.status === 'fulfilled' ? gate.value : null),
    readiness: readiness.status === 'fulfilled' ? readiness.value : current.readiness,
    evidenceError: failures.length > 0 ? new Error('Some run evidence could not be loaded') : null,
  };
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
  const { begin: beginLoad, cancelAll: cancelLoads } = useRequestLifecycle();

  const refresh = useCallback(
    async (showLoading = false) => {
      if (!mountedRef.current) return;
      if (showLoading) setIsLoading(true);
      // One signal for the whole refresh: the run and its three evidence
      // requests are a single snapshot, so a superseding refresh has to cancel
      // all four together rather than leave a gate from the previous one to
      // land on its own.
      const signal = beginLoad();
      try {
        const run = await api.getRun(id, { signal });
        if (!mountedRef.current) return;
        setData((current) => ({ ...current, run }));
        setError(null);

        const [artifactsResult, gateResult, readinessResult] = await Promise.allSettled([
          api.getRunArtifacts(id, { signal }),
          api.getRunGate(id, { signal }),
          run.releaseId
            ? api.getReleaseReadiness(run.releaseId, { signal })
            : Promise.resolve(null),
        ]);
        if (!mountedRef.current) return;

        setData((current) =>
          foldEvidence(current, run, artifactsResult, gateResult, readinessResult),
        );
      } catch (caught) {
        if (isAbortError(caught)) return;
        if (mountedRef.current) {
          setError(caught instanceof Error ? caught : new Error('Failed to fetch run'));
        }
      } finally {
        if (showLoading && mountedRef.current) setIsLoading(false);
      }
    },
    [api, id, beginLoad],
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
      cancelLoads();
      unsubscribe();
    };
  }, [api, id, refresh, cancelLoads]);

  /**
   * `cancelRun` and `retryRun` are deliberately called without a signal.
   *
   * They are user-initiated, they are not superseded by a later poll, and the
   * observable half of the unmount defect — a result written into a component
   * that no longer exists — is closed by the `mountedRef` guards below. Adding
   * the argument would change the call arity that `routes/dashboard/run-detail`
   * asserts on, and that file is owned elsewhere; the argument can be threaded
   * in the same commit that owns those tests.
   */
  const cancel = useCallback(async () => {
    setIsActing(true);
    setActionError(null);
    try {
      const run = await api.cancelRun(id);
      if (!mountedRef.current) return run;
      setData((current) => ({ ...current, run }));
      await refresh();
      return run;
    } catch (caught) {
      if (isAbortError(caught)) throw caught;
      const actionFailure = caught instanceof Error ? caught : new Error('Failed to cancel run');
      if (mountedRef.current) setActionError(actionFailure);
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
      if (!mountedRef.current) return run;
      setData((current) => ({ ...current, run, events: [], artifacts: [], gate: null }));
      return run;
    } catch (caught) {
      if (isAbortError(caught)) throw caught;
      const actionFailure = caught instanceof Error ? caught : new Error('Failed to retry run');
      if (mountedRef.current) setActionError(actionFailure);
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
  const { begin, cancelAll } = useRequestLifecycle();

  useEffect(() => {
    if (!releaseId) {
      setData(null);
      setIsLoading(false);
      return () => {
        cancelAll();
      };
    }
    setIsLoading(true);
    const signal = begin();
    void api
      .getReleaseReadiness(releaseId, { signal })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (isAbortError(caught)) return;
        setError(caught instanceof Error ? caught : new Error('Release readiness unavailable'));
      })
      .finally(() => {
        if (!signal.aborted) setIsLoading(false);
      });
    return () => {
      cancelAll();
    };
  }, [api, releaseId, begin, cancelAll]);

  return { data, isLoading, error };
}

export function useQuarantine(api = defaultApiClient) {
  const [data, setData] = useState<QuarantineEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { begin, cancelAll } = useRequestLifecycle();

  useEffect(() => {
    const signal = begin();
    void api
      .getQuarantine({ signal })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (isAbortError(caught)) return;
        setError(caught instanceof Error ? caught : new Error('Quarantine unavailable'));
      })
      .finally(() => {
        if (!signal.aborted) setIsLoading(false);
      });
    return () => {
      cancelAll();
    };
  }, [api, begin, cancelAll]);

  const addQuarantine = async (entry: { testTitle: string; testFile: string; reason?: string }) => {
    const created = await api.addQuarantine(entry);
    setData((current) => [...current, created]);
    return created;
  };

  return { data, isLoading, error, addQuarantine };
}
