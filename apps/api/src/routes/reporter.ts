/**
 * reporter.ts — Unified API reporter ingestion route
 *
 * Accepts reporter events in two formats:
 *
 * 1. Legacy compatibility format (@automate/reporter v1):
 *    { type: 'run:start' | 'test:begin' | ..., runId: string, payload: unknown }
 *
 * 2. New versioned format:
 *    { version: string, type: string, runId: string, timestamp: string, payload: unknown }
 *
 * Detection: if the body lacks both `version` and `timestamp`, it is treated as legacy.
 *
 * Auth: when REPORTER_SECRET is configured, requests must supply the secret via
 *   - Authorization: Bearer <token>
 *   - ?token=<value>  (compatible with the existing ws-reporter query-param behaviour)
 * If no secret is configured the endpoint is open (development / test mode).
 */
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod/v4';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import type { RunRepository } from '../repositories/run-repository.js';
import { persistReporterEvent } from '../services/reporter-persistence.js';
import type { RealtimeBus } from '../realtime/realtime-bus.js';
import type { TestStatus } from '../repositories/run-repository.js';

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

const VersionedReporterEventSchema = z.object({
  version: z.string().min(1),
  type: z.string().min(1),
  runId: z.string().min(1),
  timestamp: z.string().min(1),
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
    status: z.enum(['running', 'passed', 'failed', 'flaky', 'skipped', 'timedOut', 'queued']),
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
  runId: z.string().min(1),
  status: z.enum(['running', 'passed', 'failed', 'interrupted']).default('passed'),
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
    if (test.status === 'failed' || test.status === 'timedOut') failed += 1;
    if (test.status === 'flaky') flaky += 1;
    if (test.status === 'skipped') skipped += 1;
  }
  return { total: tests.length, passed, failed, flaky, skipped };
}

function normalizeUploadPayload(payload: ReporterUploadPayload): ReporterUploadPayload {
  const tests = payload.tests.map((test) => ({
    id: test.id,
    testId: test.testId,
    title: test.title,
    file: sanitizePath(test.file),
    status: test.status,
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

function convertPlaywrightJsonToUpload(
  runIdFromField: string,
  report: Record<string, unknown>,
): ReporterUploadPayload {
  const runId =
    runIdFromField || (typeof report['runId'] === 'string' ? report['runId'] : 'uploaded-run');
  const tests: Array<z.infer<typeof UploadedTestSchema>> = [];

  const collectSuite = (suite: Record<string, unknown>, parentTitle = ''): void => {
    const suiteTitle = typeof suite['title'] === 'string' ? suite['title'] : '';
    const fullTitlePrefix = [parentTitle, suiteTitle].filter(Boolean).join(' > ');

    const specs = Array.isArray(suite['specs']) ? suite['specs'] : [];
    for (const spec of specs) {
      if (typeof spec !== 'object' || spec === null) continue;
      const specObject = spec as Record<string, unknown>;
      const title = typeof specObject['title'] === 'string' ? specObject['title'] : 'Unnamed spec';
      const testsArray = Array.isArray(specObject['tests']) ? specObject['tests'] : [];
      const primary = testsArray[0];

      let status: TestStatus = 'queued';
      let durationMs: number | null = null;
      if (typeof primary === 'object' && primary !== null) {
        const testObject = primary as Record<string, unknown>;
        const results = Array.isArray(testObject['results']) ? testObject['results'] : [];
        const lastResult = results.length > 0 ? results[results.length - 1] : undefined;
        if (typeof lastResult === 'object' && lastResult !== null) {
          const resultObject = lastResult as Record<string, unknown>;
          const rawStatus =
            typeof resultObject['status'] === 'string' ? resultObject['status'] : 'queued';
          status = mapPlaywrightStatus(rawStatus);
          durationMs =
            typeof resultObject['duration'] === 'number' ? resultObject['duration'] : null;
        }
      }

      const file = typeof suite['file'] === 'string' ? suite['file'] : '';
      const fullTitle = fullTitlePrefix ? `${fullTitlePrefix} > ${title}` : title;
      tests.push({
        id: `${file || 'unknown'}::${fullTitle}`,
        title: fullTitle,
        file,
        status,
        durationMs,
      });
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

  const summary = countStatuses(tests);
  const status: ReporterUploadPayload['status'] = summary.failed > 0 ? 'failed' : 'passed';

  return {
    runId,
    status,
    tests,
    summary,
  };
}

function mapPlaywrightStatus(status: string): TestStatus {
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  if (status === 'timedOut') return 'timedOut';
  if (status === 'skipped') return 'skipped';
  if (status === 'interrupted') return 'failed';
  return 'queued';
}

function parseJunitUpload(runIdFromField: string, xml: string): ReporterUploadPayload {
  const runId = runIdFromField || 'uploaded-junit-run';
  const testcaseRegex = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  const tests: Array<z.infer<typeof UploadedTestSchema>> = [];
  let index = 0;

  const parseAttribute = (attrs: string, key: string): string | null => {
    const regex = new RegExp(`${key}="([^"]*)"`);
    const match = attrs.match(regex);
    return match?.[1] ?? null;
  };

  for (const match of xml.matchAll(testcaseRegex)) {
    index += 1;
    const attrs = (match[1] ?? '').trim();
    const body = (match[2] ?? '').trim();
    const name = parseAttribute(attrs, 'name') ?? 'Unnamed testcase';
    const className = parseAttribute(attrs, 'classname');
    const file = parseAttribute(attrs, 'file') ?? className ?? '';
    const durationSeconds = Number(parseAttribute(attrs, 'time') ?? '0');
    const durationMs = Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : null;

    let status: z.infer<typeof UploadedTestSchema>['status'] = 'passed';
    if (/<skipped[\s>]/.test(body)) status = 'skipped';
    if (/<failure[\s>]/.test(body) || /<error[\s>]/.test(body)) status = 'failed';

    const title = className ? `${className} :: ${name}` : name;
    tests.push({
      id: `${file || 'junit'}::${name}::${index}`,
      title,
      file,
      status,
      durationMs,
    });
  }

  const summary = countStatuses(tests);
  const status: ReporterUploadPayload['status'] = summary.failed > 0 ? 'failed' : 'passed';

  return {
    runId,
    status,
    tests,
    summary,
  };
}

async function persistUploadPayload(
  payload: ReporterUploadPayload,
  repository: RunRepository,
  bus?: RealtimeBus,
): Promise<{ runId: string; status: ReporterUploadPayload['status']; ingestedTests: number }> {
  const derived = countStatuses(payload.tests);
  const summary = payload.summary ?? {};
  const nowIso = new Date().toISOString();
  const startedAt = payload.startedAt ?? nowIso;

  await repository.upsertRun({
    id: payload.runId,
    startedAt,
    finishedAt: payload.finishedAt ?? (payload.status === 'running' ? null : nowIso),
    status: payload.status,
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
      status: test.status,
      durationMs: test.durationMs ?? null,
    });
  }

  if (bus) {
    bus.publish({
      type: 'run:updated',
      version: '1',
      runId: payload.runId,
      status: payload.status,
      timestamp: nowIso,
    });
  }

  return {
    runId: payload.runId,
    status: payload.status,
    ingestedTests: payload.tests.length,
  };
}

/** Promote a legacy event to the normalised shape. */
export function adaptLegacyEvent(raw: LegacyReporterEvent): NormalizedReporterEvent {
  return {
    version: '1',
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
          options.bus.publish({
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
        ingestedTests: persisted.ingestedTests,
      },
      202,
    );
  });

  return app;
}
