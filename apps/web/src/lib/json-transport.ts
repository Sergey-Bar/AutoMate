import type { z } from 'zod/v4';
import { parse } from './qa-client.js';

/**
 * The three verbs every scorecard client needs, built once.
 *
 * Same rules as `qa-client.ts` and `health-client.ts`: every response is parsed against the
 * server's contract by the shared `parse`, so a failure reads the server's own sentence, and
 * every request sends the session cookie.
 */
export interface JsonTransport {
  get<T>(path: string, schema: z.ZodType<T>): Promise<T>;
  post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T>;
  put<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T>;
}

export function createJsonTransport(baseUrl = '', fetchImpl: typeof fetch = fetch): JsonTransport {
  const send = async <T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      credentials: 'include',
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return parse(response, schema, path);
  };
  return {
    get: (path, schema) => send('GET', path, schema),
    post: (path, body, schema) => send('POST', path, schema, body),
    put: (path, body, schema) => send('PUT', path, schema, body),
  };
}

/** `?a=1&b=x` from the defined, non-empty entries, or the empty string. */
export function queryString(query: Readonly<Record<string, string | number | undefined>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text.length === 0 ? '' : `?${text}`;
}

/** `/api/v1/projects/<id>`, with the id encoded. The one place a project id enters a path. */
export function projectPath(projectId: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}`;
}
