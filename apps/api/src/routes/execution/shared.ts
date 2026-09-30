/**
 * shared.ts — the helpers every execution route group uses.
 *
 * These sat in the middle of `routes/execution.ts`, between the schemas and the
 * handlers, so nothing could reach one without importing all of the others. Three
 * groups and four private copies of the same idea — "the effective workspace", "an
 * error body in the standard shape", "a parsed body or a 400" — is how a request
 * starts answering 401 on one path and 400 on another.
 *
 * They are exported here, and the route groups import them, so the *shape* of a
 * response is decided in one file. `createExecutionRoutes` in the parent directory
 * composes the groups in the same order it has always registered them.
 */

import { timingSafeEqual } from 'node:crypto';
import { DomainError } from '../../errors/domain-error.js';
import path from 'node:path';
import type { Context } from 'hono';
import { z } from 'zod/v4';
import { DEFAULT_WORKSPACE_ID, type RunRecord } from '../../repositories/run-repository.js';
import type { CanonicalRealtimeEvent, RealtimeBus } from '../../realtime/realtime-bus.js';
import { defaultPolicy } from '../../execution/quality-gate.js';
import { bearerToken } from '../../http/bearer-token.js';
import type {
  DomainName,
  ExecutionRun,
  ExecutionStore,
  QualityPolicy,
  RunPhase,
} from '../../execution/types.js';
import type { ExecutionRoutesOptions } from './schemas.js';
import { requireRequestId } from '../../observability/request-context.js';

/**
 * Whether the lease a request presents is still the job's own.
 *
 * Two fields, one question, and the two failures have **different codes**: a stale
 * `leaseId` means the runner lost the job, a stale `fencingToken` means it held the job
 * and has since been superseded. Collapsing them into a boolean threw the distinction
 * away, and returning a reason keeps it — `JOB_LEASE_INVALID` and `JOB_FENCING_STALE`
 * are the two codes a runner uses to decide whether to re-claim or to give up.
 *
 * A field the request omits is not checked: the runner that sends neither is relying on
 * the token in the `Authorization` header, and the header's runner is the one already
 * compared against `leaseOwner` above.
 *
 * @param {{ leaseId: string | null; fencingToken: number }} job
 * @param {{ leaseId?: string; fencingToken?: number }} presented
 * @returns {{ ok: true } | { ok: false; code: 'JOB_LEASE_INVALID' | 'JOB_FENCING_STALE' }}
 */
export function jobLeaseIsCurrent(
  job: { leaseId: string | null; fencingToken: number },
  presented: { leaseId?: string; fencingToken?: number },
): { ok: true } | { ok: false; code: 'JOB_LEASE_INVALID' | 'JOB_FENCING_STALE' } {
  if (presented.leaseId !== undefined && presented.leaseId !== job.leaseId) {
    return { ok: false, code: 'JOB_LEASE_INVALID' };
  }
  if (presented.fencingToken !== undefined && presented.fencingToken !== job.fencingToken) {
    return { ok: false, code: 'JOB_FENCING_STALE' };
  }
  return { ok: true };
}

/** The closure state every route group needs, built once by `createExecutionRoutes`. */
export interface ExecutionRouteContext {
  options: ExecutionRoutesOptions;
  /** The effective workspace, resolved once. */
  ws: string;
  /**
   * Per-run event sequence allocator, shared across groups.
   *
   * Shared deliberately: a sequence is a property of the *run*, not of the endpoint
   * that happens to be appending. Two allocators would let `/runs/:id/events` and
   * `/jobs/:id/events` hand out the same number, and the replay cursor is built from
   * it.
   */
  eventSequences: Map<string, number>;
  maxArtifactBytes: number;
}

export function workspace(options: ExecutionRoutesOptions): string {
  // The shared constant, not a literal: the reporter path resolves the same value and
  // the two disagreeing is what made a reported run invisible to this listing.
  return options.workspaceId ?? DEFAULT_WORKSPACE_ID;
}

export function requestId(_c: Context): string {
  return requireRequestId();
}

/** The most runs one page will ever return. */
export const MAX_RUNS_PER_PAGE = 100;
export const DEFAULT_RUNS_PER_PAGE = 25;

/**
 * Parses `?limit` and `?cursor` for a list endpoint.
 *
 * A missing or nonsensical value falls back to the default rather than erroring:
 * a dashboard should never fail to render because someone hand-edited a query
 * string. The cap is what matters — without one, `GET /api/v1/runs` returned
 * every run in the install's history with its tests and artifacts, so the first
 * page load grew with the size of the workspace rather than the size of the page.
 */
export function parsePageQuery(
  rawLimit: string | undefined,
  rawCursor: string | undefined,
): { limit: number; cursor?: string } {
  const parsed = rawLimit === undefined ? Number.NaN : Number.parseInt(rawLimit, 10);
  const limit = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), MAX_RUNS_PER_PAGE)
    : DEFAULT_RUNS_PER_PAGE;
  return rawCursor === undefined || rawCursor.trim() === ''
    ? { limit }
    : { limit, cursor: rawCursor.trim() };
}

/**
 * The cursor for a run: its creation time and id.
 *
 * Both halves matter. The time alone is not unique — a batch of runs can share
 * a timestamp to the millisecond — and paging on a non-unique key silently skips
 * or repeats rows, which is worse than not paging at all.
 */
export function pageCursor(run: ExecutionRun): string {
  return Buffer.from(`${run.createdAt}|${run.id}`, 'utf8').toString('base64url');
}

/**
 * A sequence cursor: a number, or `'invalid'`.
 *
 * The sentinel rather than a silent fallback, because a cursor is a *claim* about
 * where to resume. A caller that sent `after=nonsense` and got the first page back
 * would treat it as an empty stream and stop polling; a caller that sent it after a
 * real page would silently re-read from the start. `'invalid'` lets the route answer
 * 400 and tell the client its cursor is wrong, which is the only response that lets
 * it recover.
 */
export function parseAfterSequence(raw: string | undefined): number | 'invalid' | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return 'invalid';
  return parsed;
}

/**
 * A requested event page size, or the store's default.
 *
 * Clamped in the store rather than here, so both implementations agree on what a
 * page is; this only rejects a value that is not a number at all, which the store's
 * clamp would otherwise treat as its default.
 */
export function pageSize(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * No error helper. This one is gone.
 *
 * `error(c, status, code, message, details)` built a response by hand at the call site,
 * which is three separate things in one function. It rendered a second copy of the body
 * the error boundary already renders, so the two could disagree about `requestId` and
 * about which fields a 5xx is allowed to carry. It took the status as a literal beside
 * the code, so nothing checked the pair — and two of the forty-two sites did not type a
 * status at all, passing one in from elsewhere, which is how a status ends up decided in
 * a second place. And it took the code as a bare `string`, so a code the taxonomy had
 * never heard of compiled without complaint.
 *
 * All three are now impossible rather than discouraged: `throw new DomainError(code,
 * message)` names a code from `errors/domain-error.ts`, the status comes from the one
 * table behind it, and the body is rendered once by the boundary.
 *
 * The response shape is unchanged, which is why the route tests did not need rewriting —
 * only the harness, so that a thrown `DomainError` meets the boundary the way it does in
 * production instead of Hono's default handler.
 */

export function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T | null> {
  return c.req
    .json()
    .then((body) => schema.safeParse(body))
    .then((result) => (result.success ? result.data : null))
    .catch(() => null);
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Whether a runner may register, and the two questions that decides it.
 *
 * The old version was:
 *
 *   if (secret === undefined) return process.env['NODE_ENV'] !== 'production';
 *
 * which fails **open** everywhere that is not production. A staging deployment with no
 * registration secret configured let anyone who asked register a runner, and a runner
 * that registers can claim jobs. It also failed open on any `NODE_ENV` the deployment
 * had not heard of — which is the state a brand-new environment is in.
 *
 * The default is now to refuse, and the only environment that may register without a
 * secret is `test`, named exactly. That is the review ruleset's `no-fail-open-default`
 * made executable: a default that permits the insecure path where refusing is
 * possible. Dev and staging now set a secret like production does, which is a
 * one-line change to their environment and the entire point of requiring one.
 *
 * @param c the Hono context
 * @param secret the configured registration secret, if any
 * @param environment `NODE_ENV`, injected so the policy is testable
 */
export function registrationAuthorized(
  c: Context,
  secret: string | undefined,
  environment: string | undefined = process.env['NODE_ENV'],
): boolean {
  if (secret === undefined) {
    // The one environment where a missing secret is a fixture rather than a
    // deployment. Everywhere else an unset secret is a misconfiguration, and the
    // answer to a misconfiguration on an authenticated route is no.
    return environment === 'test';
  }
  const provided =
    c.req.header('x-runner-registration-secret') ?? bearerToken(c.req.header('authorization'));
  return provided !== undefined && safeEqual(provided, secret);
}

export async function authenticate(c: Context, store: ExecutionStore) {
  const token = bearerToken(c.req.header('authorization'));
  if (!token) return null;
  return store.authenticateRunner(token);
}

export function legacyRun(record: RunRecord): ExecutionRun {
  const now = new Date().toISOString();
  const phase: RunPhase =
    record.status === 'passed' || record.status === 'failed'
      ? 'complete'
      : record.status === 'interrupted'
        ? 'partial'
        : 'running';
  const outcome =
    record.status === 'passed'
      ? 'passed'
      : record.status === 'failed'
        ? 'failed'
        : record.status === 'interrupted'
          ? 'partial'
          : null;
  return {
    id: record.id,
    externalId: record.id,
    source: 'legacy-reporter',
    framework: 'unknown',
    adapterVersion: 'legacy-1',
    testType: 'unknown',
    projectId: null,
    environmentId: null,
    releaseId: null,
    branch: record.branch,
    commit: record.commitSha,
    suite: null,
    selection: [],
    timeoutMs: 30 * 60_000,
    priority: 0,
    requiredCapabilities: [],
    labels: [],
    configuration: {},
    metadata: {},
    policyId: null,
    idempotencyKey: `legacy:${record.id}`,
    workspaceId: DEFAULT_WORKSPACE_ID,
    attempt: 1,
    retryOfRunId: null,
    phase,
    outcome,
    createdAt: record.startedAt,
    updatedAt: record.finishedAt ?? record.startedAt ?? now,
    startedAt: record.startedAt,
    completedAt: record.finishedAt,
    runner: null,
    tests: [],
    summary: {
      total: record.total,
      passed: record.passed,
      failed: record.failed,
      flaky: record.flaky,
      skipped: record.skipped,
      blocked: 0,
      unknown: Math.max(
        0,
        record.total - record.passed - record.failed - record.flaky - record.skipped,
      ),
      durationMs: record.durationMs,
    },
    error: null,
    rawEvidenceRefs: [],
    artifacts: [],
    policyEvaluation: null,
    status: record.status,
  };
}

export async function ensurePolicy(
  store: ExecutionStore,
  workspaceId: string,
): Promise<QualityPolicy> {
  const policies = await store.listPolicies(workspaceId);
  if (policies[0]) return policies[0];
  const input = defaultPolicy(workspaceId);
  return store.createPolicy(input);
}

export function safeName(value: string): string {
  const base = path.basename(value.replaceAll('\\', '/'));
  return base.replace(/[^a-zA-Z0-9._-]/g, '_') || 'artifact';
}

/**
 * The two ways an artifact download can fail to produce bytes, as two answers.
 *
 * `getArtifact` returns null both when the artifact row is gone and when its bytes
 * cannot be read. Reporting the second case as 404 turns a storage failure into "this
 * evidence never existed" — the one response that tells the caller to stop asking and
 * tells nobody to go and look. So this throws `ARTIFACT_BYTES_UNAVAILABLE` (503) when the
 * metadata row is there and the bytes are not, and `ARTIFACT_NOT_FOUND` when the row is
 * not there at all. Stores without the optional descriptor lookup fall back to the 404.
 *
 * The 503 carries `callerSafe` because its details are about a resource the caller
 * named: the artifact id it just asked for, the run that owns it, and the checksum that
 * was recorded. Without that flag the boundary would blank them and answer
 * `internal error`, and the caller would have to re-derive what its own request already
 * said. `storageKey` is the one field here that is a server-side path, and it is the
 * reason the flag is a deliberate per-error decision rather than a rule for 503s.
 */
export async function missingArtifact(
  _c: Context,
  store: ExecutionStore,
  artifactId: string,
  runId?: string,
  workspaceId?: string,
): Promise<never> {
  const descriptor = await store.getArtifactDescriptor?.(artifactId, workspaceId);
  if (descriptor && (!runId || descriptor.runId === runId)) {
    throw new DomainError(
      'ARTIFACT_BYTES_UNAVAILABLE',
      'Artifact metadata exists but its bytes are unavailable',
      {
        callerSafe: true,
        details: {
          artifactId: descriptor.id,
          runId: descriptor.runId,
          expectedSizeBytes: descriptor.sizeBytes,
          checksum: descriptor.checksum,
        },
      },
    );
  }
  throw new DomainError('ARTIFACT_NOT_FOUND', 'Artifact not found');
}

export function artifactKind(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === 'raw_report' || normalized === 'report') return 'report';
  if (normalized === 'playwright-json' || normalized === 'json') return 'json';
  if (normalized === 'junit') return 'junit';
  if (normalized === 'stdout') return 'stdout';
  if (normalized === 'stderr') return 'stderr';
  if (normalized === 'screenshot') return 'screenshot';
  if (normalized === 'video') return 'video';
  if (normalized === 'trace') return 'trace';
  if (normalized === 'html' || normalized === 'html-report') return 'html';
  if (normalized === 'log' || normalized === 'event-log') return 'log';
  return 'other';
}

export function domainStatusesFromRun(
  run: ExecutionRun,
): Partial<
  Record<
    DomainName,
    'passed' | 'failed' | 'warning' | 'unknown' | 'not_configured' | 'not_implemented'
  >
> {
  if (run.outcome === 'passed') return { browser: 'passed' };
  if (run.outcome === 'failed') return { browser: 'failed' };
  if (run.outcome === 'partial') return { browser: 'warning' };
  return { browser: 'unknown' };
}

export function publishCanonical(
  bus: RealtimeBus | undefined,
  event: Omit<CanonicalRealtimeEvent, 'version' | 'sequence'>,
  sequences: Map<string, number>,
): void {
  const sequence = (sequences.get(event.runId) ?? 0) + 1;
  sequences.set(event.runId, sequence);
  // Publishing to the realtime bus is fire-and-forget: the durable bus contract is
  // non-rejecting (it logs and resolves), so there is nothing here to await. Marked
  // `void` rather than left bare so the intent is visible and a future bus that
  // *can* reject has to make a decision here instead of becoming an unhandled
  // rejection.
  void bus?.publish({ version: '1', sequence, ...event });
}

/**
 * Upper bound on any single request body reaching the execution boundary.
 * Base64 inflates by 4/3, so this is the ceiling before the decoded-size check
 * in the artifact handler. Without it a single runner-token request could
 * allocate an arbitrary amount of memory.
 */
export const MAX_EXECUTION_BODY_BYTES = 96 * 1024 * 1024;
