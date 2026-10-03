import { z } from 'zod/v4';
import {
  CopilotAnswerSchema,
  ProjectDetailResponseSchema,
  ProjectListResponseSchema,
  QaFlakyResponseSchema,
  QaGapsResponseSchema,
  QaHollowResponseSchema,
  QaScoreSchema,
  QaStructureResponseSchema,
  type CopilotAnswer,
  type ProjectDetailResponse,
  type QaFlakyResponse,
  type QaGapsResponse,
  type QaHollowResponse,
  type QaScore,
  type QaStructureResponse,
  type RegisteredProject,
} from './qa.js';

/**
 * The command center's data layer.
 *
 * ## Every response is parsed, and every path is built here
 *
 * Two rules that together make this file the only place a QA number can enter the
 * client. Nothing else calls `fetch`, so nothing else can render a response that
 * was never validated — and no screen builds a URL by concatenation, so no screen
 * can construct a path with a project id in it.
 *
 * The schemas are the **server's** contracts, imported from `@automate/shared-contracts`
 * rather than re-declared. A copy is a second authority that disagrees the first time
 * a field is added, which is the defect `RUN_PHASES` was and the one this package
 * exists to not repeat.
 */

export interface QaClient {
  listProjects(): Promise<RegisteredProject[]>;
  getProject(projectId: string): Promise<ProjectDetailResponse>;
  getScore(projectId: string): Promise<QaScore>;
  getGaps(projectId: string): Promise<QaGapsResponse>;
  getHollow(projectId: string): Promise<QaHollowResponse>;
  getFlaky(projectId: string): Promise<QaFlakyResponse>;
  getStructure(projectId: string): Promise<QaStructureResponse>;
  askCopilot(projectId: string, question: string): Promise<CopilotAnswer>;
  startRun(
    projectId: string,
    commandId: string,
    idempotencyKey: string,
  ): Promise<{ runId: string }>;
}

/** What a response must look like for `getJson` to accept it. */
type Schema<T> = z.ZodType<T>;

export class QaApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`API answered ${String(status)}`);
    this.name = 'QaApiError';
  }
}

/**
 * The HTTP client.
 *
 * `credentials: 'include'` on every call, matching `lib/api.ts`. The command center
 * is behind the same session as the rest of the dashboard, and a client that
 * fetched one without a cookie would fail only for the reader whose session it did
 * not send.
 */
export function createQaClient(baseUrl = '', fetchImpl: typeof fetch = fetch): QaClient {
  const url = (path: string): string => `${baseUrl}${path}`;
  const auth = { credentials: 'include' } as const;

  async function get<T>(path: string, schema: Schema<T>): Promise<T> {
    const response = await fetchImpl(url(path), { ...auth, method: 'GET' });
    return parse(response, schema, path);
  }

  async function post<T>(path: string, body: unknown, schema: Schema<T>): Promise<T> {
    const response = await fetchImpl(url(path), {
      ...auth,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return parse(response, schema, path);
  }

  return {
    listProjects: async () => (await get('/api/v1/projects', ProjectListResponseSchema)).projects,
    getProject: (projectId) =>
      get(`/api/v1/projects/${encodeURIComponent(projectId)}`, ProjectDetailResponseSchema),
    getScore: (projectId) =>
      get(`/api/v1/projects/${encodeURIComponent(projectId)}/qa/score`, QaScoreSchema),
    getGaps: (projectId) =>
      get(`/api/v1/projects/${encodeURIComponent(projectId)}/qa/gaps`, QaGapsResponseSchema),
    getHollow: (projectId) =>
      get(`/api/v1/projects/${encodeURIComponent(projectId)}/qa/hollow`, QaHollowResponseSchema),
    getFlaky: (projectId) =>
      get(`/api/v1/projects/${encodeURIComponent(projectId)}/qa/flaky`, QaFlakyResponseSchema),
    getStructure: (projectId) =>
      get(
        `/api/v1/projects/${encodeURIComponent(projectId)}/qa/structure`,
        QaStructureResponseSchema,
      ),
    askCopilot: (projectId, question) =>
      post(
        `/api/v1/projects/${encodeURIComponent(projectId)}/copilot/answer`,
        { question },
        CopilotAnswerSchema,
      ),
    // **A command id, never an executable.** The body has no field that could carry
    // an argv, so the client cannot start a command the profile does not declare.
    startRun: (projectId, commandId, idempotencyKey) =>
      post(
        `/api/v1/projects/${encodeURIComponent(projectId)}/run.start`,
        { commandId, idempotencyKey },
        z.object({ runId: z.string().min(1), jobId: z.string().min(1), phase: z.string().min(1) }),
      ),
  };
}

async function parse<T>(response: Response, schema: Schema<T>, path: string): Promise<T> {
  // A response that is not JSON at all — a proxy's HTML error page, a login
  // redirect — must not throw here. `parse` would then raise a `SyntaxError` whose
  // message is about the body rather than about the request, and a screen would
  // show that instead of anything actionable.
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new QaApiError(response.status, describeError(body, response));
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new QaApiError(
      response.status,
      `Response from ${path} did not match the expected shape: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

/**
 * The server's own sentence, rather than its JSON.
 *
 * The API's error body is `{ error: { code, message } }`, and stringifying that
 * whole object renders `{"code":"NOT_FOUND","message":"No such project"}` at a
 * reader — raw JSON where a sentence belongs. `message` is what the boundary
 * already wrote for a human, so it is what a screen shows.
 */
function describeError(body: unknown, response: Response): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === 'object' && error !== null) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.length > 0) return message;
    }
    if (typeof error === 'string' && error.length > 0) return error;
  }
  // A body that is not the API's error shape at all: the status line is still
  // true, and a reader is better served by it than by `undefined`.
  return `HTTP ${String(response.status)}`;
}
