import { type ZodSchema } from 'zod';

/**
 * Standard API error response shape from the server.
 */
export interface ApiError {
  error: string | object;
  details?: unknown;
}

/**
 * Custom error class for API failures.
 * Includes HTTP status code and optional server error details.
 */
export class ApiFetchError extends Error {
  constructor(
    public status: number,
    public body: ApiError | null,
    message?: string,
  ) {
    super(message ?? `API request failed with status ${status}`);
    this.name = 'ApiFetchError';
  }
}

export interface ApiFetchOptions extends RequestInit {
  /** Query parameters to append to the URL */
  params?: Record<string, string | number | boolean | undefined>;
  /** Zod schema to validate the response body */
  schema?: ZodSchema;
  /** Custom error message for failed requests */
  errorMessage?: string;
}

/**
 * Centralized fetch wrapper for API calls with:
 * - Automatic JSON parsing
 * - Error handling with typed errors
 * - Optional Zod validation
 * - Query parameter serialization
 *
 * Throws `ApiFetchError` on HTTP errors (4xx, 5xx).
 *
 * @example
 * ```typescript
 * // Basic usage
 * const runs = await apiFetch<Run[]>('/api/runs');
 *
 * // With validation
 * const run = await apiFetch('/api/runs/123', { schema: RunSchema });
 *
 * // With params
 * const tests = await apiFetch('/api/tests', {
 *   params: { limit: 100, offset: 0 },
 *   schema: z.array(TestSchema),
 * });
 *
 * // POST with body
 * const newRun = await apiFetch('/api/runs', {
 *   method: 'POST',
 *   body: JSON.stringify({ branch: 'main' }),
 *   schema: RunSchema,
 * });
 * ```
 */
export async function apiFetch<T>(
  url: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { params, schema, errorMessage, ...fetchOptions } = options;

  // Serialize query params
  let finalUrl = url;
  if (params) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) sp.append(k, String(v));
    }
    const qs = sp.toString();
    if (qs) finalUrl += (url.includes('?') ? '&' : '?') + qs;
  }

  // Set default headers
  const headers = new Headers(fetchOptions.headers);
  if (!headers.has('Content-Type') && fetchOptions.body) {
    headers.set('Content-Type', 'application/json');
  }

  // Execute fetch
  const response = await fetch(finalUrl, { ...fetchOptions, headers });

  // Handle HTTP errors
  if (!response.ok) {
    let errorBody: ApiError | null = null;
    try {
      errorBody = (await response.json()) as ApiError;
    } catch {
      // Response body is not JSON or empty
    }

    throw new ApiFetchError(
      response.status,
      errorBody,
      errorMessage ?? errorBody?.error?.toString() ?? `HTTP ${response.status}`,
    );
  }

  // Parse JSON response
  const data: unknown = await response.json();

  // Validate with Zod if schema provided
  if (schema) {
    const result = schema.safeParse(data);
    if (!result.success) {
      console.error('[apiFetch] Schema validation failed:', result.error);
      throw new Error(`Response validation failed: ${result.error.message}`);
    }
    return result.data as T;
  }

  return data as T;
}
