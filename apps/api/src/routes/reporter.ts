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
 * Uploads go through the canonical model (POST /api/v1/reporter/upload):
 *   the bytes are parsed by one `@automate/reporter` adapter into one
 *   `CanonicalRunResult`, that result is written to `canonical_run_results`, and
 *   `runs`/`tests` are projected from it. **This door used to parse JUnit and
 *   Playwright with its own scanner, map statuses with its own table, and write
 *   `runs`/`tests` directly** — a second ingestion system whose output nothing in
 *   `@automate/reporting` could read, and which reported a retried JUnit suite as a
 *   clean pass while the canonical adapter reported it as flaky. See ledger row P-73
 *   and `reporter-two-doors.test.ts`.
 */
import { Hono, type Context } from 'hono';
import { domainErrorResponse } from '../errors/boundary.js';
import { DomainError } from '../errors/domain-error.js';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod/v4';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  CANONICAL_REPORTER_EVENT_TYPES,
  LEGACY_FLAT_V1_CONTRACT_ID,
  REPORTER_EVENT_VERSION,
  RUN_COMPLETED_EVENT_TYPE,
  RUN_CONTRACT_VERSION,
  RUN_STARTED_EVENT_TYPE,
  RUN_UPDATED_EVENT_TYPE,
  TEST_COMPLETED_EVENT_TYPE,
  TEST_STARTED_EVENT_TYPE,
} from '@automate/shared-contracts';
import {
  junitXmlAdapter,
  legacyUploadAdapter,
  playwrightJsonAdapter,
  type ProducerAdapter,
  type ProducerContext,
} from '@automate/reporter';
import { DEFAULT_WORKSPACE_ID, type RunRepository } from '../repositories/run-repository.js';
import { ingestCanonicalResult } from '../services/canonical-ingestion.js';
import type { ReporterResultStore } from '../services/reporter-ingestion.js';
import { persistReporterEvent } from '../services/reporter-persistence.js';
import { canonicalRunFromUploadEvents } from '../services/reporter-event-canonical.js';
import { bearerToken } from '../http/bearer-token.js';
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

/**
 * The reporter SDK v1 colon vocabulary, derived from the contract's constants.
 *
 * These four were spelled out as bare strings here, in the contract's own schemas,
 * in `packages/realtime`'s flat broadcast schemas, and in the reporter adapters — so
 * adding or renaming an event meant finding all of them, and missing one produced an
 * event that was valid under its writer and silently dropped by its reader. The
 * contract owns the strings (`event-type-ownership.test.ts` fails if one is written
 * as a literal outside it); this list says only which of them belong to the v1 wire
 * shape, because that is a statement about *this* route, not about the vocabulary.
 */
const REPORTER_V1_EVENT_TYPES = [
  RUN_STARTED_EVENT_TYPE,
  TEST_STARTED_EVENT_TYPE,
  TEST_COMPLETED_EVENT_TYPE,
  RUN_COMPLETED_EVENT_TYPE,
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

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

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
// Upload: bytes in, one canonical result out
// ---------------------------------------------------------------------------

/** The producer version this door claims when the producer declared none. */
const UNKNOWN_PRODUCER_VERSION = 'unreported';

/**
 * The adapter version, which is what makes a *trend* across an adapter upgrade readable.
 *
 * Recorded in `provenance.adapterVersion` and therefore in the canonical row's fingerprint,
 * so a result parsed by v1 and a result parsed by v2 are distinguishable after the fact.
 * Two adapters that both claim `1` cannot be told apart in a window that straddles a
 * change, and the chart lies in a way no tile can warn about.
 */
const ADAPTER_VERSION = '2';

/**
 * Which adapter reads this body.
 *
 * **The declared format wins; the filename is the fallback; the content decides only when
 * nothing is declared.** That order matters because callers are inconsistent in what they
 * send — `format: junit`, `artifactType: junit`, `artifactType: playwright-json` are all in
 * the wild, and a rejected spelling means a real report gets "this document contains no
 * test cases", a message about the wrong file.
 *
 * A body that looks like XML and declares nothing goes to the JUnit adapter: the sniffing
 * exists because a reporter posting `application/xml` without a format field is common, and
 * `JSON.parse` on it produces a syntax error rather than an answer.
 */
function pickAdapter(document: UploadDocument): ProducerAdapter {
  const declared = declaredFormat(document);
  if (declared === 'junit') return junitXmlAdapter;
  if (declared === 'playwright') return playwrightJsonAdapter;
  if (document.fields['fileName']?.toLowerCase().endsWith('.xml') === true) return junitXmlAdapter;
  if (document.fields['fileName']?.toLowerCase().endsWith('.json') === true) {
    return looksLikeXml(document) ? junitXmlAdapter : playwrightJsonAdapter;
  }
  return looksLikeXml(document) ? junitXmlAdapter : legacyUploadAdapter;
}

/**
 * The format the caller declared, normalised.
 *
 * Two spellings per format because both are in use and neither is wrong: `format` and
 * `artifactType` are two field names for one piece of information, and the adapter would
 * rather have one answer than two rules about which name wins.
 */
function declaredFormat(document: UploadDocument): 'junit' | 'playwright' | '' {
  const raw = (document.fields['format'] ?? document.fields['artifactType'] ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'junit' || raw === 'xml') return 'junit';
  if (raw === 'playwright' || raw === 'playwright-json') return 'playwright';
  return '';
}

/** Whether the body's first bytes are an XML document. The first 64 is enough. */
function looksLikeXml(document: UploadDocument): boolean {
  const head = new TextDecoder().decode(document.bytes.slice(0, 64));
  return /^\s*<(?:\?xml|testsuites?|testsuite)\b/i.test(head);
}

/**
 * Reject a declared format whose bytes are the other format.
 *
 * Refusing rather than guessing: the two parsers fail in opposite ways, and a caller who
 * mislabelled a Playwright report as JUnit would otherwise get "this document contains no
 * test cases" — a message about the wrong file.
 */
function assertFormatMatches(adapter: ProducerAdapter, document: UploadDocument): void {
  const declared = declaredFormat(document);
  const xml = looksLikeXml(document);
  if (declared === 'playwright' && xml) {
    throw new Error('The uploaded body is XML; declare format=junit so the right adapter reads it');
  }
  if (declared === 'junit' && !xml) {
    throw new Error('A JUnit upload must be XML; the uploaded body is not');
  }
  // The legacy upload payload is JSON by definition, and so is a Playwright report. Neither
  // is XML, and a mismatch is a caller error rather than a routing ambiguity.
  if (xml && adapter !== junitXmlAdapter) {
    throw new Error('The uploaded body is XML; declare format=junit so the right adapter reads it');
  }
}

function optionalField(fields: Record<string, string>, key: string): string | undefined {
  const value = fields[key]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function producerContextFor(document: UploadDocument, workspaceId: string): ProducerContext {
  const nowIso = new Date().toISOString();
  const startedAt = optionalField(document.fields, 'startedAt') ?? nowIso;
  const finishedAt = optionalField(document.fields, 'finishedAt');
  return {
    workspaceId,
    // The caller's run identity, or a name derived from the document rather than invented:
    // `uploaded-run` was the old fallback and a *third* identity for the same run when the
    // body did not carry one. A document with no run id is still identifiable — by its own
    // digest — and the digest is what makes the replay a replay.
    runId: optionalField(document.fields, 'runId') ?? `sha256:${documentDigest(document.bytes)}`,
    sourceUri: optionalField(document.fields, 'sourceUri') ?? 'reporter/upload',
    sourceDigest: documentDigest(document.bytes),
    producerVersion:
      optionalField(document.fields, 'producerVersion') ??
      optionalField(document.fields, 'format') ??
      UNKNOWN_PRODUCER_VERSION,
    adapterVersion: ADAPTER_VERSION,
    startedAt,
    finishedAt,
    branch: optionalField(document.fields, 'branch'),
    commitSha: optionalField(document.fields, 'commitSha'),
    environment: optionalField(document.fields, 'environment'),
    declaredRunStatus: optionalField(document.fields, 'status'),
  };
}

/** SHA-256 over the uploaded bytes, so a replayed upload fingerprints identically. */
function documentDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface UploadDocument {
  bytes: Uint8Array;
  /** Multipart form fields, which carry the cohort and the caller's run identity. */
  fields: Record<string, string>;
}

/**
 * Read the request body as bytes plus its multipart fields.
 *
 * Bytes rather than a parsed value, because `ProducerAdapter.parse` takes bytes and
 * because `sourceDigest` has to be over exactly what arrived — a digest computed from a
 * re-serialised object is a digest of the parse, not of the upload, and two byte-different
 * documents that parse to the same value would fingerprint as one.
 */
async function readUploadDocument(c: Context): Promise<UploadDocument> {
  const contentType = c.req.header('content-type') ?? '';
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    throw new DomainError('PAYLOAD_TOO_LARGE', 'Request body too large');
  }

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const fields: Record<string, string> = {};
    let bytes: Uint8Array | undefined;
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') {
        fields[key] = value;
        continue;
      }
      // One file, and the only one: a second part is a body the contract has no field for,
      // and silently taking the first would ingest one of two reports.
      if (key !== 'file') throw new Error(`Unexpected multipart field "${key}"`);
      if (bytes !== undefined) throw new Error('An upload carries one file part');
      bytes = new Uint8Array(await value.arrayBuffer());
      fields['fileName'] = value.name;
    }
    if (bytes === undefined) throw new Error('file field is required for multipart uploads');
    if (new TextEncoder().encode(new TextDecoder().decode(bytes)).byteLength > MAX_UPLOAD_BYTES) {
      throw new DomainError('PAYLOAD_TOO_LARGE', 'Request body too large');
    }
    return { bytes, fields };
  }

  return { bytes: new Uint8Array(await c.req.arrayBuffer()), fields: {} };
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
   * The canonical store. **Required for uploads** and what makes this door readable by
   * the reporting package at all: without it an upload has nowhere canonical to land, and
   * the only honest answer is to refuse rather than write a row that
   * `GET /api/v1/reporting/kpis` will never see.
   */
  canonicalStore?: ReporterResultStore;
  /**
   * The workspace reporter-written runs belong to.
   *
   * Absent, this uses {@link DEFAULT_WORKSPACE_ID}, which is what
   * `GET /api/v1/runs` resolves for a single-tenant install — so the two agree without
   * either being told about the other. Set it to `WORKSPACE_ID` and both move together.
   */
  workspaceId?: string;
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
      // A hook must *return*, so it renders through the boundary's one exported
      // renderer rather than throwing — and the body is the same shape every other
      // refusal in this API produces.
      onError: (c) =>
        domainErrorResponse(c, new DomainError('PAYLOAD_TOO_LARGE', 'Request body too large')),
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
    const queryToken = c.req.query('token');

    const headerToken = bearerToken(c.req.header('Authorization'));
    const token =
      headerToken ??
      (options?.allowQueryToken && queryToken !== undefined && queryToken !== ''
        ? queryToken
        : undefined);

    if (token === undefined) {
      throw new DomainError('MISSING_REPORTER_TOKEN', 'Missing reporter authentication token');
    }

    if (!safeCompare(token, reporterSecret)) {
      throw new DomainError('INVALID_REPORTER_TOKEN', 'Invalid reporter authentication token');
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
      throw new DomainError('INVALID_JSON', 'Invalid JSON body');
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new DomainError('INVALID_REQUEST_BODY', 'Request body must be a JSON object');
    }

    const raw = body as Record<string, unknown>;
    let normalized: NormalizedReporterEvent;

    if (isLegacyShape(raw)) {
      // ── Compatibility path ──────────────────────────────────────────
      const result = LegacyReporterEventSchema.safeParse(raw);
      if (!result.success) {
        throw new DomainError('INVALID_LEGACY_REPORTER_EVENT', 'Invalid legacy reporter event', {
          details: { fieldErrors: result.error.flatten().fieldErrors },
        });
      }
      normalized = adaptLegacyEvent(result.data);
    } else {
      // ── Versioned path ──────────────────────────────────────────────
      const result = VersionedReporterEventSchema.safeParse(raw);
      if (!result.success) {
        throw new DomainError(
          'INVALID_VERSIONED_REPORTER_EVENT',
          'Invalid versioned reporter event',
          {
            details: {
              fieldErrors: result.error.flatten().fieldErrors,
              supportedVersions: VERSIONED_EVENT_VERSIONS,
              legacyContract: LEGACY_FLAT_V1_CONTRACT_ID,
            },
          },
        );
      }
      normalized = result.data as NormalizedReporterEvent;
    }

    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;

    // T14: persist normalized event to repository (if one is configured)
    if (options?.repository) {
      const runUpdated = await persistReporterEvent(normalized, options.repository, {
        workspaceId,
      });

      // A terminal event also closes the canonical row. The events door is a stream, and a
      // stream has to be turned into one result before it can be canonical — see
      // `reporter-event-canonical.ts` for why the accumulation lives there and not here.
      if (options.canonicalStore && isTerminalReporterEvent(normalized.type)) {
        const canonical = await canonicalRunFromUploadEvents(options.repository, {
          workspaceId,
          runId: normalized.runId,
        });
        if (canonical) {
          await ingestCanonicalResult(canonical, {
            store: options.canonicalStore,
            repository: options.repository,
            bus: options.bus,
            triggeredBy: 'reporter',
          });
        }
      }

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
          await options.bus.publish({
            type: RUN_UPDATED_EVENT_TYPE,
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
    if (!options?.repository || !options.canonicalStore) {
      // `callerSafe`: a reporter whose upload store is unconfigured needs to be told
      // *that*, not "internal error". The message names the missing thing and the
      // operator can act on it; a blanked 503 is a support ticket instead.
      throw new DomainError('NOT_CONFIGURED', 'Reporter upload persistence is not configured', {
        callerSafe: true,
      });
    }

    const document = await readUploadDocument(c);
    const adapter = pickAdapter(document);
    assertFormatMatches(adapter, document);

    let result: ReturnType<ProducerAdapter['parse']>;
    try {
      result = adapter.parse(
        document.bytes,
        producerContextFor(document, options.workspaceId ?? DEFAULT_WORKSPACE_ID),
      );
    } catch (cause) {
      // **The adapter's refusal travels, because it is about the caller's own document.**
      // Every adapter names its refusals — "JUnit report contains no test cases",
      // "Reporter upload declares no test rows" — and this door used to answer *every*
      // malformed report with "invalid payload", which gave the person fixing it nothing
      // to act on and turned a one-line fix into a support ticket. `cause` is never
      // returned; the message is copied into `details`, and both come from the bytes the
      // caller just sent, so there is nothing here the caller has not already seen.
      const message = cause instanceof Error ? cause.message : 'Unreadable reporter upload';
      throw new DomainError('INVALID_REPORTER_UPLOAD', 'Invalid reporter upload payload', {
        details: { adapterMessage: message },
        cause,
      });
    }

    const ingested = await ingestCanonicalResult(result, {
      store: options.canonicalStore,
      repository: options.repository,
      bus: options.bus,
      triggeredBy: 'upload',
    });

    // **Archived after the parse, keyed by the run the document actually named.** For a
    // JSON body the run id is inside the payload, so archiving first meant the key was
    // derived from the multipart fields — which for that shape are absent, and the raw
    // report was filed under `legacy/upload/`. A raw report nobody can find is not a
    // retained raw report.
    if (options.artifactStore) {
      const safeRunId = result.identity.runId
        .replaceAll('\\', '/')
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      await options.artifactStore.putAt(`legacy/${safeRunId}/raw/${randomUUID()}`, document.bytes);
    }

    if (ingested.status === 'conflict') {
      // A row already exists for this run id with a different fingerprint. Writing the
      // newer projection would replace the dashboard's view of a run whose canonical
      // evidence is the older one, so nothing is written and the conflict is reported.
      throw new DomainError('CONFLICT', 'Conflicting result for this run', {
        callerSafe: true,
        details: { reason: 'conflicting-canonical-result', runId: result.identity.runId },
      });
    }

    return c.json(
      {
        ok: true,
        runId: result.identity.runId,
        type: 'run:upload',
        status: ingested.projection.run.status,
        // The canonical status, beside the persisted one. The persisted `status` is a
        // four-value narrowing chosen by `projectCanonicalRun`, and a caller that
        // disagrees with it needs to see what the authority actually said.
        canonicalStatus: result.status,
        ingested: ingested.status,
        ingestedTests: ingested.projection.tests.length,
      },
      202,
    );
  });

  return app;
}

/**
 * Whether an event ends the run.
 *
 * Both vocabularies are checked, because both reach this route: the legacy SDK emits
 * `run:end` and the versioned contract emits `run.completed`, and a canonical result is
 * only written at a terminal moment — a result built from a half-finished stream would be
 * a claim about a run that is still going.
 */
function isTerminalReporterEvent(type: string): boolean {
  return type === 'run:end' || type === RUN_COMPLETED_EVENT_TYPE;
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
