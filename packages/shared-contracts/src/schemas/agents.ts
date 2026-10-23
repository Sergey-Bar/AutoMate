/**
 * Agents domain schemas — Zod v4
 *
 * Contracts for the Automate AI Agent Framework (Product 3).
 * Covers the 5 agent domains (browser, api, load, security, mobile),
 * agent request/result, and the NotImplemented sentinel type.
 *
 * Agent endpoints: POST /agents/{domain}/generate | /agents/{domain}/run
 * Unified result schema aligned with PRD §7.4.
 */
import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// AgentDomain
// ---------------------------------------------------------------------------

export const AgentDomainSchema = z.enum(['browser', 'api', 'load', 'security', 'mobile']);
export type AgentDomain = z.infer<typeof AgentDomainSchema>;

// ---------------------------------------------------------------------------
// AgentRequest
// ---------------------------------------------------------------------------

export const AgentRequestSchema = z.object({
  domain: AgentDomainSchema,
  action: z.enum(['generate', 'run', 'scan']),
  prompt: z.string().optional(),
  specPath: z.string().optional(),
  targetUrl: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type AgentRequest = z.infer<typeof AgentRequestSchema>;

// ---------------------------------------------------------------------------
// AgentTestItem (individual test inside a result)
// ---------------------------------------------------------------------------

export const AgentTestItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['passed', 'failed', 'skipped', 'error']),
  durationMs: z.number().int().min(0).optional(),
});
export type AgentTestItem = z.infer<typeof AgentTestItemSchema>;

// ---------------------------------------------------------------------------
// AgentArtifacts
// ---------------------------------------------------------------------------

export const AgentArtifactsSchema = z.object({
  allureResultsPath: z.string().optional(),
  screenshots: z.array(z.string()).optional(),
  rawOutputPath: z.string().optional(),
});
export type AgentArtifacts = z.infer<typeof AgentArtifactsSchema>;

// ---------------------------------------------------------------------------
// AgentResult  (PRD §7.4 unified result schema)
// ---------------------------------------------------------------------------

export const AgentResultSchema = z.object({
  runId: z.string(),
  agent: AgentDomainSchema,
  status: z.enum(['passed', 'failed', 'error']),
  startedAt: z.string(),
  durationMs: z.number().int().min(0),
  summary: z.object({
    total: z.number().int().min(0),
    passed: z.number().int().min(0),
    failed: z.number().int().min(0),
    skipped: z.number().int().min(0),
  }),
  aiNarrative: z.string().optional(),
  tests: z.array(AgentTestItemSchema).optional(),
  artifacts: AgentArtifactsSchema.optional(),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;

// ---------------------------------------------------------------------------
// browser.run  (BK-1: the first domain with a real adapter)
// ---------------------------------------------------------------------------

/**
 * Input of `POST /api/v1/agents/browser/run`.
 *
 * Deliberately the subset of the runs API's request (`POST /api/v1/runs`) that the Playwright
 * runner acts on, not a parallel vocabulary: `projectId`, `environmentId`, `releaseId`,
 * `branch`, `commit`, `timeoutMs` and `idempotencyKey` mean exactly what they mean there.
 *
 * - `project` is a **Playwright project name** (`--project <name>`), allowlisted by the runner
 *   (`RUNNER_PLAYWRIGHT_PROJECTS`). The pattern forbids a leading `-` so it can never be read
 *   as a CLI flag.
 * - `targetUrl` is the base URL the browser is pointed at. Only its shape is checked here
 *   (http/https, no embedded credentials); the runner enforces `RUNNER_ALLOWED_TARGET_URLS`,
 *   and a target it refuses becomes a `config_failed` run, visible through the runs API.
 *
 * Strict: a spec path, a grep or a test selection is refused rather than dropped, because the
 * runner does not honour one and a request that silently ran something broader than it asked
 * for would be a worse answer than a 400.
 */
export const BrowserRunInputSchema = z.strictObject({
  project: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u, 'not a Playwright project name'),
  targetUrl: z.string().refine(isPlainHttpUrl, 'must be an http(s) URL without credentials'),
  projectId: z.string().min(1).optional(),
  environmentId: z.string().min(1).optional(),
  releaseId: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(86_400_000).optional(),
  idempotencyKey: z.string().min(1).optional(),
});
export type BrowserRunInput = z.infer<typeof BrowserRunInputSchema>;

// ---------------------------------------------------------------------------
// api.run  (X-3: the second domain with a real adapter)
// ---------------------------------------------------------------------------

/** One segment of a collection path: no leading dot or dash, so no `..` and no flag. */
const COLLECTION_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/u;

/**
 * Input of `POST /api/v1/agents/api/run`: run one Bruno collection against a target.
 *
 * - `collection` is a directory **relative to the runner's collection root**
 *   (`RUNNER_API_COLLECTION_ROOT`), made of plain segments. `.` is the root itself. There is no
 *   `..`, no absolute path, and no segment starting with `-`, so it can be neither a traversal
 *   nor a CLI flag; the runner re-checks, because a job is read back from a database.
 * - `environment` names a Bruno environment file in that collection (`environments/<name>.bru`).
 * - `targetUrl` reaches the collection as the `baseUrl` variable, which requests refer to as
 *   `{{baseUrl}}`. Only its shape is checked here; the runner enforces
 *   `RUNNER_ALLOWED_TARGET_URLS`, and a target it refuses becomes a `config_failed` run.
 *
 * Strict, and deliberately without a command, arguments or variables: the runner builds the one
 * `bru run` invocation itself, so a caller cannot choose what is executed, only which collection.
 */
export const ApiRunInputSchema = z.strictObject({
  collection: z
    .string()
    .max(200)
    .refine(
      (value) => value === '.' || value.split('/').every((part) => COLLECTION_SEGMENT.test(part)),
      'not a relative collection path',
    ),
  environment: z
    .string()
    .regex(/^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/u, 'not a Bruno environment name')
    .optional(),
  targetUrl: z.string().refine(isPlainHttpUrl, 'must be an http(s) URL without credentials'),
  projectId: z.string().min(1).optional(),
  environmentId: z.string().min(1).optional(),
  releaseId: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(86_400_000).optional(),
  idempotencyKey: z.string().min(1).optional(),
});
export type ApiRunInput = z.infer<typeof ApiRunInputSchema>;

function isPlainHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// AgentAcceptedRun  (the 202 body of any agent action that queues an execution job)
// ---------------------------------------------------------------------------

/**
 * What an agent action that hands work to the execution pipeline answers (HTTP 202).
 *
 * The run is not finished: `links.run` is where its status is read, through the same runs API
 * every other producer uses. `duplicate` is true when an `Idempotency-Key` replayed an earlier
 * request, in which case `runId` is that earlier run.
 */
export const AgentAcceptedRunSchema = z.object({
  status: z.literal('accepted'),
  domain: AgentDomainSchema,
  action: z.enum(['generate', 'run', 'scan']),
  runId: z.string().min(1),
  jobId: z.string().min(1),
  phase: z.string().min(1),
  duplicate: z.boolean(),
  links: z.object({
    run: z.string().min(1),
    events: z.string().min(1),
    artifacts: z.string().min(1),
  }),
});
export type AgentAcceptedRun = z.infer<typeof AgentAcceptedRunSchema>;

// ---------------------------------------------------------------------------
// AgentNotImplemented  (sentinel for unimplemented domain handlers)
// ---------------------------------------------------------------------------

export const AgentNotImplementedSchema = z.object({
  domain: AgentDomainSchema,
  implemented: z.literal(false),
  message: z.string(),
});
export type AgentNotImplemented = z.infer<typeof AgentNotImplementedSchema>;
