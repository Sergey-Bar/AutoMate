import { useCallback, useRef } from 'react';

/**
 * One in-flight request at a time, per hook instance.
 *
 * Every one of these hooks loads on mount, refreshes on a timer, and refreshes
 * again on every pushed event, so more than one request is routinely in flight at
 * a time. Two of them are wrong in opposite ways:
 *
 *  - Without a signal at all, a request that started before unmount holds its
 *    socket open until the server answers, and its result then arrives at a
 *    component that no longer exists.
 *  - Without cancellation, a request that a newer one has already superseded
 *    writes its older answer over the newer one, so a slow response for an old
 *    poll is indistinguishable from a fresh answer.
 *
 * `begin` aborts whatever came before and returns the new signal, so "supersede"
 * stops being a race between two `setState` calls. `cancelAll` is the unmount
 * path. Both are idempotent, and a call after unmount is harmless: `abort()` on
 * an already-aborted controller is a no-op, and the hooks already guard their
 * own `setState` on a mounted ref.
 */
export interface RequestLifecycle {
  /** Abort the in-flight request, if any, and take ownership of the next one. */
  begin: () => AbortSignal;
  /** Abort the in-flight request without starting another. */
  cancelAll: () => void;
}

export function useRequestLifecycle(): RequestLifecycle {
  const controllerRef = useRef<AbortController | null>(null);

  const begin = useCallback((): AbortSignal => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    return controller.signal;
  }, []);

  const cancelAll = useCallback((): void => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  return { begin, cancelAll };
}
