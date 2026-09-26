/**
 * reporter.ts — Unified API reporter ingestion route
 *
 * Accepts reporter events in two formats:
 *
 * 1. Legacy compatibility format (legacy-flat-v1, @automate/reporter v1):
 *    { type: 'run:start' | 'test:begin' | ..., runId: string, payload: unknown }
 *
 * 2. Versioned format:
 *    { version: string, type: string, runId: string, timestamp: string, payload: unknown }
 *
 * Detection: if the body lacks both `version` and `timestamp`, it is treated as legacy.
 *
 * The versioned path accepts only the named contracts
 * (REPORTER_EVENT_VERSION and RUN_CONTRACT_VERSION) and only known event
 * types; anything else is rejected with an explicit 400 instead of being
 * accepted and silently dropped by persistence.
 *
 * Auth: when REPORTER_SECRET is configured, requests must supply the secret via
 *   - Authorization: Bearer <token>
 *   - ?token=<value>  (compatible with the existing ws-reporter query-param behaviour)
 * If no secret is configured the endpoint is open (development / test mode).
 *
 * Upload truthfulness (POST /api/v1/reporter/upload):
 *   - an explicitly declared status is honoured as-is (legacy compatibility);
 *   - otherwise the status is derived fail-closed from the uploaded evidence
 *     (see {@link deriveUploadStatus}) — an upload that carries no outcome is
 *     persisted as `interrupted`, never as `passed`.
 */
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod/v4';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import {
  CANONICAL_REPORTER_EVENT_TYPES,
  LEGACY_FLAT_V1_CONTRACT_ID,
  PERSISTED_RUN_STATUS_VALUES,
  REPORTER_EVENT_VERSION,
  RUN_CONTRACT_VERSION,
} from '@automate/shared-contracts';
import {
  toPersistedStatus,
  type RunRepository,
  type RunStatus,
  type TestStatus,
} from '../repositories/run-repository.js';
import { persistReporterEvent } from '../services/reporter-persistence.js';
import type { RealtimeBus } from '../realtime/realtime-bus.js';

// ---------------------------------------------------------------------------
// Legacy wire shape — emitted by @automate/reporter
// ---------------------------------------------------------------------------

const LEGACY_EVENT_TYPES = [
  'run:start',
  'test:begin',
  'test:end',
  'step:begin',
  'step:end',
  'stdout',
  'stderr',
  'run:end',
] as const;

export type LegacyEventType = (typeof LEGACY_EVENT_TYPES)[number];

const LegacyReporterEventSchema = z.object({
  type: z.enum(LEGACY_EVENT_TYPES),
  runId: z.string().min(1),
  payload: z.unknown(),
});

export type LegacyReporterEvent = z.infer<typeof LegacyReporterEventSchema>;

// ---------------------------------------------------------------------------
// New versioned wire shape
// ---------------------------------------------------------------------------

/** Reporter SDK v1 colon vocabulary declared in shared-contracts reporter-events. */
const REPORTER_V1_EVENT_TYPES = [
  'run:started',
  'test:started',
  'test:completed',
  'run:completed',
] as const;

const VERSIONED_EVENT_VERSIONS = [REPORTER_EVENT_VERSION, RUN_CONTRACT_VERSION] as const;
const VERSIONED_EVENT_TYPES = [
  ...CANONICAL_REPORTER_EVENT_TYPES,
  ...REPORTER_V1_EVENT_TYPES,
  ...LEGACY_EVENT_TYPES,
];

const VersionedReporterEventSchema = z.object({
  version: z.enum(VERSIONED_EVENT_VERSIONS),
  type: z.enum(VERSIONED_EVENT_TYPES as [string, ...string[]]),
  runId: z.string().min(1),
  timestamp: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid timestamp'),
  payload: z.unknown(),
});

export type VersionedReporterEvent = z.infer<typeof VersionedReporterEventSchema>;

// ---------------------------------------------------------------------------
// Normalised internal representation
// ---------------------------------------------------------------------------

export interface NormalizedReporterEvent {
  version: string;
  type: string;
  runId: string;
  timestamp: string;
  payload: unknown;
}

const UploadedTestSchema = z
  .object({
    id: z.string().min(1).optional(),
    testId: z.string().min(1).optional(),
    title: z.string().min(1),
    file: z.string().default(''),
    // Both spellings are accepted on the way in — Playwright emits `timedOut`
    // and other reporters send `timed_out`, and rejecting one of them would fail
    // a real upload. `normalizeTestStatus` collapses them to the single stored
    // spelling, so the database never holds two names for one state.
    status: z.enum([
      'running',
      'passed',
      'failed',
      'flaky',
      'skipped',
      'timedOut',
      'timed_out',
      'queued',
    ]),
    durationMs: z.number().nonnegative().nullable().optional(),
  })
  .refine((value) => Boolean(value.id ?? value.testId), {
    message: 'id or testId is required',
    path: ['id'],
  });

const UploadSummarySchema = z.object({
  total: z.number().int().nonnegative().optional(),
  passed: z.number().int().nonnegative().optional(),
  failed: z.number().int().nonnegative().optional(),
  flaky: z.number().int().nonnegative().optional(),
  skipped: z.number().int().nonnegative().optional(),
});

const ReporterUploadSchema = z.object({
  format: z.enum(['playwright', 'junit']).optional(),
  runId: z.string().min(1),
  // No default: an absent status is derived from the uploaded evidence so an
  // evidence-free upload can never inherit a green `passed`.
  // From the contract, so this cannot accept a status the `runs_status_check`
  // constraint would then reject. `queued` is excluded because an upload names a
  // status it observed, and a queued run has observed nothing.
  status: z.enum(PERSISTED_RUN_STATUS_VALUES).optional(),
  startedAt: z.string().min(1).optional(),
  finishedAt: z.string().nullable().optional(),
  durationMs: z.number().nonnegative().nullable().optional(),
  branch: z.string().optional(),
  commitSha: z.string().optional(),
  triggeredBy: z.string().optional(),
  tests: z.array(UploadedTestSchema).optional().default([]),
  summary: UploadSummarySchema.optional(),
});

type ReporterUploadPayload = z.infer<typeof ReporterUploadSchema>;
type UploadedTest = z.infer<typeof UploadedTestSchema>;

/**
 * Non-green terminal status used when an upload carries no usable evidence.
 *
 * The run status vocabulary (RunStatus, mirrored by `runs.status` in
 * @automate/db) has no `unknown` member, so `interrupted` is the honest
 * landing spot: an upload that proves nothing must never be persisted as
 * `passed`.
 */
const UNDETERMINED_RUN_STATUS: RunStatus = 'interrupted';

/** Test statuses that mean "declared, but no outcome was ever observed". */
const UNRESOLVED_TEST_STATUSES: ReadonlySet<TestStatus> = new Set<TestStatus>([
  'running',
  'queued',
]);

function sanitizePath(rawPath: string): string {
  const normalized = path.normalize(rawPath);
  if (path.isAbsolute(normalized) || normalized.includes('..') || normalized.includes('\0')) {
    return path.basename(normalized);
  }
  return normalized.split(path.sep).join('/');
}

function countStatuses(tests: ReadonlyArray<z.infer<typeof UploadedTestSchema>>): {
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
} {
  let passed = 0;
  let failed = 0;
  let flaky = 0;
  let skipped = 0;
  for (const test of tests) {
    if (test.status === 'passed') passed += 1;
    if (test.status === 'failed' || test.status === 'timedOut' || test.status === 'timed_out')
      failed += 1;
    if (test.status === 'flaky') flaky += 1;
    if (test.status === 'skipped') skipped += 1;
  }
  return { total: tests.length, passed, failed, flaky, skipped };
}

/**
 * Derive a run status for uploads that do not declare one.
 *
 * Fail-closed by construction — `passed` is only ever returned when the
 * upload carries real evidence:
 *
 *   - no test rows at all                       → non-green (unknown)
 *   - any failed/timedOut row (or summary.failed) → failed
 *   - any row that never resolved (queued/running) → non-green (unknown)
 *   - no row actually passed                     → non-green (unknown)
 *   - otherwise                                  → passed
 */
function deriveUploadStatus(
  tests: ReadonlyArray<UploadedTest>,
  summary: ReporterUploadPayload['summary'],
): RunStatus {
  const derived = countStatuses(tests);
  if (tests.length === 0) return UNDETERMINED_RUN_STATUS;
  if ((summary?.failed ?? derived.failed) > 0) return 'failed';
  if (tests.some((test) => UNRESOLVED_TEST_STATUSES.has(normalizeTestStatus(test.status)))) {
    return UNDETERMINED_RUN_STATUS;
  }
  if ((summary?.passed ?? derived.passed) === 0) return UNDETERMINED_RUN_STATUS;
  return 'passed';
}

function normalizeUploadPayload(payload: ReporterUploadPayload): ReporterUploadPayload {
  const tests = payload.tests.map((test) => ({
    id: test.id,
    testId: test.testId,
    title: test.title,
    file: sanitizePath(test.file),
    status: normalizeTestStatus(test.status),
    durationMs: test.durationMs,
  }));

  return {
    ...payload,
    tests,
  };
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

async function parseReporterUpload(c: Context): Promise<ReporterUploadPayload> {
  const contentType = c.req.header('content-type') ?? '';
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    throw new Error('Reporter upload exceeds 5 MiB limit');
  }

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const runId = String(form.get('runId') ?? '').trim();
    const branch = String(form.get('branch') ?? '').trim() || undefined;
    const commitSha = String(form.get('commitSha') ?? '').trim() || undefined;
    const triggeredBy = String(form.get('triggeredBy') ?? '').trim() || undefined;
    const status = String(form.get('status') ?? '').trim() || undefined;
    const format = String(form.get('format') ?? '').trim() || undefined;
    const artifactType = String(form.get('artifactType') ?? '')
      .trim()
      .toLowerCase();
    const filePart = form.get('file');

    if (
      typeof filePart !== 'object' ||
      filePart === null ||
      !('text' in filePart) ||
      !('name' in filePart)
    ) {
      throw new Error('file field is required for multipart uploads');
    }

    const uploadFile = filePart as { text(): Promise<string>; name: string };
    const text = await uploadFile.text();
    if (new TextEncoder().encode(text).byteLength > MAX_UPLOAD_BYTES) {
      throw new Error('Reporter upload exceeds 5 MiB limit');
    }
    let candidate: unknown;

    const looksLikeXml = /^\s*<(?:\?xml|testsuites?|testsuite)\b/i.test(text);
    if (format === 'junit' && !looksLikeXml) {
      throw new Error('JUnit uploads must use application/xml');
    }
    if (format === 'playwright' && looksLikeXml) {
      throw new Error('Playwright uploads must use JSON');
    }
    if (artifactType === 'junit' || uploadFile.name.toLowerCase().endsWith('.xml')) {
      candidate = parseJunitUpload(runId, text);
    } else {
      candidate = parseJsonUpload(runId, text);
    }

    if (typeof candidate === 'object' && candidate !== null) {
      const objectCandidate = candidate as Record<string, unknown>;
      if (branch) objectCandidate['branch'] = branch;
      if (commitSha) objectCandidate['commitSha'] = commitSha;
      if (triggeredBy) objectCandidate['triggeredBy'] = triggeredBy;
      if (status) objectCandidate['status'] = status;
      if (format) objectCandidate['format'] = format;
    }

    const parsed = ReporterUploadSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.flatten().fieldErrors));
    }
    return normalizeUploadPayload(parsed.data);
  }

  const raw = await c.req.json();
  const parsed = ReporterUploadSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(JSON.stringify(parsed.error.flatten().fieldErrors));
  }
  if (parsed.data.format === 'junit') {
    throw new Error('JUnit uploads must use application/xml');
  }
  return normalizeUploadPayload(parsed.data);
}

function parseJsonUpload(runIdFromField: string, text: string): unknown {
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== 'object' || parsed === null) {
    return parsed;
  }

  const object = parsed as Record<string, unknown>;
  if (Array.isArray(object['tests']) && typeof object['runId'] === 'string') {
    return object;
  }

  if (Array.isArray(object['suites'])) {
    return convertPlaywrightJsonToUpload(runIdFromField, object);
  }

  return object;
}

/**
 * Convert a Playwright JSON report into upload rows.
 *
 * Every `spec.tests[]` entry and every attempt in `tests[].results[]` becomes
 * its own row, so retries and multi-project specs are never collapsed into a
 * single "last result wins" verdict.  A test that declares no results keeps a
 * single unresolved row instead of silently disappearing.
 *
 * The returned payload carries no run status: it is derived from the rows by
 * {@link deriveUploadStatus} unless the request declares one explicitly.
 */
function convertPlaywrightJsonToUpload(
  runIdFromField: string,
  report: Record<string, unknown>,
): ReporterUploadPayload {
  const runId =
    runIdFromField || (typeof report['runId'] === 'string' ? report['runId'] : 'uploaded-run');
  const tests: UploadedTest[] = [];

  const collectSuite = (suite: Record<string, unknown>, parentTitle = ''): void => {
    const suiteTitle = typeof suite['title'] === 'string' ? suite['title'] : '';
    const fullTitlePrefix = [parentTitle, suiteTitle].filter(Boolean).join(' > ');

    const specs = Array.isArray(suite['specs']) ? suite['specs'] : [];
    for (const spec of specs) {
      if (typeof spec !== 'object' || spec === null) continue;
      const specObject = spec as Record<string, unknown>;
      const specTitle =
        typeof specObject['title'] === 'string' ? specObject['title'] : 'Unnamed spec';
      const specTests = Array.isArray(specObject['tests']) ? specObject['tests'] : [];
      const file = typeof suite['file'] === 'string' ? suite['file'] : '';

      for (const [testIndex, entry] of specTests.entries()) {
        if (typeof entry !== 'object' || entry === null) continue;
        const testObject = entry as Record<string, unknown>;
        const testTitle =
          typeof testObject['title'] === 'string' && testObject['title'] !== ''
            ? testObject['title']
            : specTitle;
        const fullTitle = fullTitlePrefix ? `${fullTitlePrefix} > ${testTitle}` : testTitle;
        const results = Array.isArray(testObject['results']) ? testObject['results'] : [];
        // No results at all → the report knows the test exists but not its
        // outcome. Keep one unresolved row (never a verdict) so the run cannot
        // be derived as green.
        const attempts: unknown[] = results.length > 0 ? results : [testObject];

        for (const [attemptIndex, attempt] of attempts.entries()) {
          const attemptObject: Record<string, unknown> =
            typeof attempt === 'object' && attempt !== null
              ? (attempt as Record<string, unknown>)
              : {};
          const rawStatus =
            typeof attemptObject['status'] === 'string' ? attemptObject['status'] : 'queued';
          tests.push({
            id: `${file || 'unknown'}::${fullTitle}::${testIndex + 1}.${attemptIndex + 1}`,
            title: fullTitle,
            file,
            status: mapPlaywrightStatus(rawStatus),
            durationMs:
              typeof attemptObject['duration'] === 'number' ? attemptObject['duration'] : null,
          });
        }
      }
    }

    const nested = Array.isArray(suite['suites']) ? suite['suites'] : [];
    for (const child of nested) {
      if (typeof child === 'object' && child !== null) {
        collectSuite(child as Record<string, unknown>, fullTitlePrefix);
      }
    }
  };

  const suites = Array.isArray(report['suites']) ? report['suites'] : [];
  for (const suite of suites) {
    if (typeof suite === 'object' && suite !== null) {
      collectSuite(suite as Record<string, unknown>);
    }
  }

  return {
    runId,
    tests,
    summary: countStatuses(tests),
  };
}

function mapPlaywrightStatus(status: string): TestStatus {
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  if (status === 'timedOut' || status === 'timed_out') return 'timed_out';
  if (status === 'skipped') return 'skipped';
  if (status === 'interrupted') return 'failed';
  return 'queued';
}

/**
 * The one spelling a test status is stored and compared in.
 *
 * The upload schema admits both `timedOut` (what Playwright emits) and
 * `timed_out` (what other reporters send), because rejecting either would fail a
 * real upload. Everything downstream sees one value, so a timeout cannot be
 * counted as an unobserved test in one place and a failure in another.
 */
function normalizeTestStatus(status: string): TestStatus {
  return status === 'timedOut' ? 'timed_out' : (status as TestStatus);
}

/**
 * A forward scan for `<testcase>` elements.
 *
 * The previous implementation used `/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g`,
 * whose lazy `[\s\S]*?` restarts for every opener. Over a multi-megabyte body
 * that is quadratic, so one authenticated upload could hang the event loop.
 * `indexOf` advances monotonically, so the scan is linear in the input.
 */
function scanTestcases(xml: string): Array<{ attributes: string; body: string | null }> {
  const OPEN = '<testcase';
  const CLOSE = '</testcase>';
  const found: Array<{ attributes: string; body: string | null }> = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const open = xml.indexOf(OPEN, cursor);
    if (open === -1) break;
    const afterName = open + OPEN.length;
    const boundary = xml[afterName];
    if (boundary === undefined || !/[\s/>]/.test(boundary)) {
      // `<testcasefoo>` — not a testcase element. Always advances.
      cursor = afterName;
      continue;
    }
    const tagEnd = xml.indexOf('>', afterName);
    if (tagEnd === -1) break;
    if (xml[tagEnd - 1] === '/') {
      found.push({ attributes: xml.slice(afterName, tagEnd - 1), body: null });
      cursor = tagEnd + 1;
      continue;
    }
    const close = xml.indexOf(CLOSE, tagEnd);
    if (close === -1) {
      // Unterminated final element: keep what we have rather than dropping it.
      found.push({ attributes: xml.slice(afterName, tagEnd), body: xml.slice(tagEnd + 1) });
      break;
    }
    found.push({ attributes: xml.slice(afterName, tagEnd), body: xml.slice(tagEnd + 1, close) });
    cursor = close + CLOSE.length;
  }
  return found;
}

/**
 * JUnit XML is parsed with a hand-rolled scanner, so it carries its own size
 * bound rather than relying on the caller's upload cap. Every entry point is
 * bounded, not only the multipart path.
 */
const MAX_JUNIT_BYTES = 5 * 1024 * 1024;

function parseJunitUpload(runIdFromField: string, xml: string): ReporterUploadPayload {
  const runId = runIdFromField || 'uploaded-junit-run';
  const byteLength = new TextEncoder().encode(xml).byteLength;
  if (byteLength > MAX_JUNIT_BYTES) throw new Error('JUnit upload exceeds 5 MiB limit');
  const tests: UploadedTest[] = [];
  let index = 0;

  const parseAttribute = (attrs: string, key: string): string | null => {
    const regex = new RegExp(`${key}="([^"]*)"`);
    const match = attrs.match(regex);
    return match?.[1] ?? null;
  };

  for (const element of scanTestcases(xml)) {
    index += 1;
    const attrs = element.attributes.trim();
    const body = element.body ?? '';
    const name = parseAttribute(attrs, 'name') ?? 'Unnamed testcase';
    const className = parseAttribute(attrs, 'classname');
    const file = parseAttribute(attrs, 'file') ?? className ?? '';
    const durationSeconds = Number(parseAttribute(attrs, 'time') ?? '0');
    const durationMs = Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : null;

    // Fail closed: a `<testcase>` that declares no status and carries no
    // failure child proves nothing, so it must not be recorded as a pass.
    // `queued` is the "declared, no outcome observed" member of this
    // vocabulary and forces the run to `interrupted` in deriveRunStatus.
    let status: UploadedTest['status'] = 'queued';
    if (/<skipped[\s/>]/.test(body)) status = 'skipped';
    if (/<failure[\s/>]/.test(body) || /<error[\s/>]/.test(body)) status = 'failed';

    const title = className ? `${className} :: ${name}` : name;
    tests.push({
      id: `${file || 'junit'}::${name}::${index}`,
      title,
      file,
      // A *test* status, not a run status — the run's status is derived from
      // these below. `toPersistedStatus` does not belong on this line.
      status,
      durationMs,
    });
  }

  // No status here: an empty <testsuites/> (zero testcases) must fall through
  // to the fail-closed derivation instead of being reported as a pass.
  return {
    runId,
    tests,
    summary: countStatuses(tests),
  };
}

async function persistUploadPayload(
  payload: ReporterUploadPayload,
  repository: RunRepository,
  bus?: RealtimeBus,
): Promise<{ runId: string; status: RunStatus; ingestedTests: number }> {
  const derived = countStatuses(payload.tests);
  const summary = payload.summary ?? {};
  // An explicit status is honoured for non-green terminal states. A declared
  // pass is downgraded when the uploaded rows do not contain real evidence.
  const evidenceStatus = deriveUploadStatus(payload.tests, payload.summary);
  const status =
    payload.status === 'passed' && evidenceStatus !== 'passed'
      ? evidenceStatus
      : (payload.status ?? evidenceStatus);
  const nowIso = new Date().toISOString();
  const startedAt = payload.startedAt ?? nowIso;

  await repository.upsertRun({
    id: payload.runId,
    startedAt,
    finishedAt: payload.finishedAt ?? (status === 'running' ? null : nowIso),
    // Narrowed at the write. `status` is typed as the wider contract union because
    // the upload schema admits it, but the column stores the persisted subset, and
    // a `queued` reaching `runs.status` would be rejected by `runs_status_check`
    // as a 500. The upload schema no longer admits `queued` (it is
    // `PERSISTED_RUN_STATUS_VALUES`), so this cannot throw in practice — and if it
    // ever does, it says so rather than writing something plausible.
    status: toPersistedStatus(status),
    total: summary.total ?? derived.total,
    passed: summary.passed ?? derived.passed,
    failed: summary.failed ?? derived.failed,
    flaky: summary.flaky ?? derived.flaky,
    skipped: summary.skipped ?? derived.skipped,
    durationMs: payload.durationMs ?? null,
    branch: payload.branch ?? null,
    commitSha: payload.commitSha ?? null,
    triggeredBy: payload.triggeredBy ?? 'upload',
  });

  for (const test of payload.tests) {
    const testId = test.id ?? test.testId;
    if (!testId) continue;
    await repository.upsertTest({
      id: testId,
      runId: payload.runId,
      title: test.title,
      file: sanitizePath(test.file),
      status: normalizeTestStatus(test.status),
      durationMs: test.durationMs ?? null,
    });
  }

  if (bus) {
    // Fire-and-forget: the durable bus contract is non-rejecting, so there is
    // nothing to await. Marked so the intent is visible here rather than left
    // implicit.
    void bus.publish({
      type: 'run:updated',
      version: '1',
      runId: payload.runId,
      status,
      timestamp: nowIso,
    });
  }

  return {
    runId: payload.runId,
    status,
    ingestedTests: payload.tests.length,
  };
}

/** Promote a legacy event to the normalised shape. */
export function adaptLegacyEvent(raw: LegacyReporterEvent): NormalizedReporterEvent {
  return {
    version: REPORTER_EVENT_VERSION,
    type: raw.type,
    runId: raw.runId,
    timestamp: new Date().toISOString(),
    payload: raw.payload,
  };
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/** Constant-time string equality. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Dummy compare to maintain constant time even on length mismatch.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Shape detection
// ---------------------------------------------------------------------------

/** Returns true when the body is missing BOTH version AND timestamp → treat as legacy. */
function isLegacyShape(body: Record<string, unknown>): boolean {
  return !('version' in body) && !('timestamp' in body);
}

// ---------------------------------------------------------------------------
// Route factory options
// ---------------------------------------------------------------------------

export interface ReporterRouteOptions {
  /**
   * Persistence seam for run/test data.
   * When not provided the route accepts events but does not persist them.
   * Production code should supply a real RunRepository; tests inject an
   * InMemoryRunRepository for in-process verification.
   */
  repository?: RunRepository;
  /**
   * Realtime broadcast seam (T15).
   * When provided, a `run:updated` event is published after every successful
   * run-level persistence operation.  Ignored when no repository is configured.
   * Tests inject an InMemoryRealtimeBus for in-process verification.
   */
  bus?: RealtimeBus;
  /**
   * When true, the `?token=` query parameter is accepted as an authentication
   * mechanism (legacy ws-reporter compatibility mode).
   *
   * Defaults to `false` — query-param tokens are rejected for security.
   * Enable via `REPORTER_QUERY_TOKEN_COMPAT=true` in production only when
   * running an older reporter that cannot send Authorization headers.
   */
  allowQueryToken?: boolean;
  artifactStore?: { putAt(key: string, bytes: Uint8Array): Promise<void> };
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/**
 * Creates the reporter ingestion Hono app.
 *
 * @param reporterSecret  The expected shared secret. Pass `undefined` for open mode.
 * @param options         Optional route configuration, including the persistence repository.
 */
export function createReporterRoutes(
  reporterSecret: string | undefined,
  options?: ReporterRouteOptions,
): Hono {
  const app = new Hono();
  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_UPLOAD_BYTES,
      onError: (c) => c.json({ error: 'Request body too large' }, 413),
    }),
  );

  // ------------------------------------------------------------------
  // Auth middleware — guards all /api/v1/reporter/* paths
  // ------------------------------------------------------------------
  app.use('/api/v1/reporter/*', async (c, next) => {
    if (reporterSecret === undefined) {
      // No secret configured — open mode (development / test)
      await next();
      return;
    }

    // Accept token from Authorization header (preferred).
    // Query param ?token= is only accepted when allowQueryToken is explicitly enabled
    // (legacy ws-reporter compatibility mode).
    const authHeader = c.req.header('Authorization');
    const queryToken = c.req.query('token');

    let token: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (options?.allowQueryToken && queryToken !== undefined && queryToken !== '') {
      token = queryToken;
    }

    if (token === undefined) {
      return c.json({ error: 'Missing reporter authentication token' }, 401);
    }

    if (!safeCompare(token, reporterSecret)) {
      return c.json({ error: 'Invalid reporter authentication token' }, 403);
    }

    await next();
  });

  // ------------------------------------------------------------------
  // POST /api/v1/reporter/events
  // ------------------------------------------------------------------
  app.post('/api/v1/reporter/events', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return c.json({ error: 'Request body must be a JSON object' }, 400);
    }

    const raw = body as Record<string, unknown>;
    let normalized: NormalizedReporterEvent;

    if (isLegacyShape(raw)) {
      // ── Compatibility path ──────────────────────────────────────────
      const result = LegacyReporterEventSchema.safeParse(raw);
      if (!result.success) {
        return c.json(
          { error: 'Invalid legacy reporter event', details: result.error.flatten().fieldErrors },
          400,
        );
      }
      normalized = adaptLegacyEvent(result.data);
    } else {
      // ── Versioned path ──────────────────────────────────────────────
      const result = VersionedReporterEventSchema.safeParse(raw);
      if (!result.success) {
        return c.json(
          {
            error: 'Invalid versioned reporter event',
            details: result.error.flatten().fieldErrors,
            supportedVersions: VERSIONED_EVENT_VERSIONS,
            legacyContract: LEGACY_FLAT_V1_CONTRACT_ID,
          },
          400,
        );
      }
      normalized = result.data as NormalizedReporterEvent;
    }

    // T14: persist normalized event to repository (if one is configured)
    if (options?.repository) {
      const runUpdated = await persistReporterEvent(normalized, options.repository);

      // T15: broadcast a safe run:updated event after every run-level persistence
      // operation.  Only fires when:
      //   1. A repository is configured (persistence is active)
      //   2. A bus is configured
      //   3. persistReporterEvent returned true (run row was created/updated)
      //   4. The run row exists in the repository (safety guard)
      // The payload contains ONLY { type, version, runId, status, timestamp } —
      // user-supplied event payload fields are never forwarded.
      if (runUpdated && options.bus) {
        const run = await options.repository.getRun(normalized.runId);
        if (run !== null) {
          await await options.bus.publish({
            type: 'run:updated',
            version: '1',
            runId: run.id,
            status: run.status,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    return c.json(
      {
        ok: true,
        runId: normalized.runId,
        type: normalized.type,
        version: normalized.version,
      },
      202,
    );
  });

  // ------------------------------------------------------------------
  // POST /api/v1/reporter/upload
  // ------------------------------------------------------------------
  app.post('/api/v1/reporter/upload', async (c) => {
    if (!options?.repository) {
      return c.json({ error: 'Reporter upload persistence is not configured' }, 503);
    }

    const rawBody = c.req.raw.clone();
    let payload: ReporterUploadPayload;
    try {
      payload = await parseReporterUpload(c);
    } catch {
      return c.json({ error: 'Invalid reporter upload payload' }, 400);
    }

    if (options.artifactStore) {
      const rawBytes = new Uint8Array(await rawBody.arrayBuffer());
      const safeRunId = payload.runId.replaceAll('\\', '/').replace(/[^a-zA-Z0-9._-]/g, '_');
      await options.artifactStore.putAt(`legacy/${safeRunId}/raw/${randomUUID()}`, rawBytes);
    }

    const persisted = await persistUploadPayload(payload, options.repository, options.bus);

    return c.json(
      {
        ok: true,
        runId: persisted.runId,
        type: 'run:upload',
        status: persisted.status,
        ingestedTests: persisted.ingestedTests,
      },
      202,
    );
  });

  return app;
}
