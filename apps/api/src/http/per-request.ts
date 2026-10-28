import type { Context } from 'hono';

/**
 * A lookup that runs at most once per request, however many checks ask for it.
 *
 * Who a request is gets asked several times: by the workspace dispatch, by the workspace's
 * caller resolver, and by the installation-session check. Each answer can cost a database read
 * and a write — a session read touches `last_used_at` — so each is asked of the database once.
 *
 * Keyed by the request itself, so a request the dispatch forwards to another workspace's
 * composition shares the answer: that composition's `fetch` receives the same `Request`. A
 * failed lookup is the same failure for every asker in the request, not a retry.
 */
export function perRequest<T>(
  load: (context: Context) => Promise<T>,
): (context: Context) => Promise<T> {
  const answers = new WeakMap<Request, Promise<T>>();
  return (context) => {
    const request = context.req.raw;
    let answer = answers.get(request);
    if (answer === undefined) {
      answer = load(context);
      answers.set(request, answer);
    }
    return answer;
  };
}
