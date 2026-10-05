import React from 'react';

/**
 * The one fetch-and-render state machine every command-center screen needs.
 *
 * ## Why it is a hook and not four copies
 *
 * Each screen was written with its own `useState` + `useEffect` + `live` flag +
 * `loading`/`error`/`ready` branches, and jscpd found the eighteen-line skeleton
 * three times in one file. A clone like that is not merely untidy: the fourth screen
 * would have been written with a **different** error branch, and the screen that
 * forgets to render its failure is the screen where a 404 reads as "there is nothing
 * here" — the one conclusion a failure must never support.
 *
 * So the states are declared once, here, and every screen inherits all three.
 */
export type Resource<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; message: string };

/**
 * Loads one resource, ignoring a response that arrives after unmount.
 *
 * `useEffect`'s cleanup is the whole of that: without it a slow response calls
 * `setState` on a component that is gone, and React logs the warning that the test
 * for it is written to prevent.
 */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): Resource<T> {
  const [state, setState] = React.useState<Resource<T>>({ status: 'loading' });
  React.useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void load(controller.signal)
      .then((value) => {
        if (live) setState({ status: 'ready', value });
      })
      .catch((error: unknown) => {
        if (live) {
          setState({ status: 'error', message: describeFailure(error) });
        }
      });
    return () => {
      live = false;
      controller.abort();
    };
    // The caller's dependencies are the authority on when to reload. This hook
    // cannot know what they mean, so the array is passed through verbatim rather
    // than analysed — and no rule is disabled for it, because a suppression comment
    // that names a rule the project does not load is a lint error of its own.
  }, deps);
  return state;
}

/**
 * The sentence a reader should see for a failure.
 *
 * `error.message` is **not** it. `QaApiError` follows the shape `lib/api.ts`
 * already uses — a short `message` naming the status, and a `detail` carrying the
 * server's own words — so reading `message` here would put "API answered 404" on
 * screen in place of "No such project", which is the sentence that would have told
 * the operator what to do.
 *
 * Read through a narrowing cast rather than `instanceof`, because the type of
 * `detail` is not part of `Error` and this hook must work with any thrown value —
 * including one from a future client that names its field differently.
 */
function describeFailure(error: unknown): string {
  const detail = (error as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string' && detail.length > 0) return detail;
  return error instanceof Error ? error.message : String(error);
}
