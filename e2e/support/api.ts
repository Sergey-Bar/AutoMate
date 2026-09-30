/**
 * API helpers for the E2E suite.
 *
 * Every call goes over HTTP to the server `playwright.config.ts` started. Nothing
 * here reaches into the database: a spec that inserts rows directly is asserting
 * about the schema it wrote, not about what a reporter or a runner can actually
 * do through the product's own boundary.
 */
import { expect, type APIRequestContext } from '@playwright/test';
import { API_AUTH_HEADERS, API_BASE, RUNNER_REGISTRATION_HEADERS } from './config.js';

export interface CanonicalRun {
  id: string;
  phase: string;
  outcome: string | null;
  releaseId: string | null;
  projectId: string | null;
  branch: string | null;
  commit: string | null;
  summary: { total: number; passed: number; failed: number; durationMs: number | null };
  artifacts: Array<{ id: string; name: string; kind: string; sizeBytes: number }>;
  policyEvaluation: { status: string; decision: string } | null;
}

export interface ArtifactDescriptor {
  id: string;
  runId: string;
  name: string;
  kind: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
}

export interface JobClaim {
  jobId: string;
  runId: string;
  leaseId: string;
  fencingToken: number;
}

export interface RunnerIdentity {
  runnerId: string;
  token: string;
}

function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...API_AUTH_HEADERS, 'Content-Type': 'application/json', ...extra };
}

async function readJson(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `Expected JSON from ${response.url()} but got ${JSON.stringify(text.slice(0, 300))}`,
    );
  }
}

/**
 * A run id the API will accept.
 *
 * The reporter route validates `runId` as any non-empty string
 * (`z.string().min(1)`), but `runs.id` is a `uuid` column, so a readable id such
 * as `e2e-prod-ready-run-001` is rejected by PostgreSQL with `22P02` and surfaces
 * as a 400 "invalid text representation for a column type". Until the route
 * narrows its own contract, the specs use ids the column accepts.
 */
export function uniqueRunId(): string {
  return crypto.randomUUID();
}

export async function postReporterEvent(
  request: APIRequestContext,
  event: { type: string; runId: string; payload: Record<string, unknown> },
): Promise<void> {
  const response = await request.post(`${API_BASE}/api/v1/reporter/events`, {
    headers: API_AUTH_HEADERS,
    data: event,
  });
  expect(
    response.status(),
    `reporter event ${event.type} for ${event.runId} must be accepted: ${response.status()} ${await response.text()}`,
  ).toBe(202);
}

/**
 * Report one test result.
 *
 * `run:end` accepts `passed` and `failed` in its payload and persists neither: the
 * run's counters are accumulated from `test:end` status transitions, one per test.
 * A spec that seeds only `run:start` and `run:end` therefore gets a completed run
 * whose summary says nothing ran, which is a real gap in the reporter contract
 * and not what a reporter does.
 */
export async function reportTest(
  request: APIRequestContext,
  runId: string,
  test: {
    testId: string;
    title: string;
    file: string;
    status: 'passed' | 'failed';
    durationMs?: number;
  },
): Promise<void> {
  await postReporterEvent(request, {
    type: 'test:begin',
    runId,
    payload: { testId: test.testId, title: test.title, file: test.file },
  });
  await postReporterEvent(request, {
    type: 'test:end',
    runId,
    payload: {
      testId: test.testId,
      status: test.status,
      ...(test.durationMs === undefined ? {} : { durationMs: test.durationMs }),
    },
  });
}

export async function getRun(
  request: APIRequestContext,
  runId: string,
): Promise<CanonicalRun | undefined> {
  const response = await request.get(`${API_BASE}/api/v1/runs/${runId}`, {
    headers: API_AUTH_HEADERS,
  });
  if (response.status() === 404) return undefined;
  expect(response.status(), `GET /api/v1/runs/${runId} -> ${response.status()}`).toBe(200);
  return (await readJson(response)) as CanonicalRun;
}

export async function listRuns(request: APIRequestContext): Promise<CanonicalRun[]> {
  const response = await request.get(`${API_BASE}/api/v1/runs`, { headers: API_AUTH_HEADERS });
  expect(response.status(), `GET /api/v1/runs -> ${response.status()}`).toBe(200);
  return (await readJson(response)) as CanonicalRun[];
}

/**
 * Wait for a run to reach one of `phases`, reading the API directly.
 *
 * The point of waiting on the API and not on the page is that a browser
 * assertion which passes only because the page is still loading is not an
 * assertion. The page is checked separately, against a state the API has already
 * committed.
 */
export async function waitForRunPhase(
  request: APIRequestContext,
  runId: string,
  phases: readonly string[],
  timeoutMs = 15_000,
): Promise<CanonicalRun> {
  let latest: CanonicalRun | undefined;
  let observedPhase: string | null = null;
  await expect
    .poll(
      async () => {
        latest = await getRun(request, runId);
        observedPhase = latest?.phase ?? null;
        return observedPhase !== null && phases.includes(observedPhase);
      },
      {
        message: `run ${runId} should reach ${phases.join(' or ')} (last seen: ${String(observedPhase)})`,
        timeout: timeoutMs,
      },
    )
    .toBe(true);
  return latest as CanonicalRun;
}

/**
 * Queue a run the way the Command Center form does.
 *
 * `projectId`, `environmentId` and `releaseId` are omitted on purpose: they are
 * foreign keys onto rows that no route creates, so a run that names one is
 * refused with `23503`. A spec cannot seed a release through the product's own
 * boundary, and inventing one in the database would test the insert.
 */
export async function createRun(
  request: APIRequestContext,
  overrides: { branch?: string; commit?: string } = {},
): Promise<CanonicalRun> {
  const response = await request.post(`${API_BASE}/api/v1/runs`, {
    headers: API_AUTH_HEADERS,
    data: {
      source: 'e2e',
      framework: 'playwright',
      testType: 'browser',
      branch: overrides.branch ?? 'main',
      commit: overrides.commit ?? 'e2efixture',
      requiredCapabilities: ['playwright'],
      idempotencyKey: uniqueRunId(),
    },
  });
  expect(
    response.status(),
    `POST /api/v1/runs -> ${response.status()} ${await response.text()}`,
  ).toBe(202);
  return (await readJson(response)) as CanonicalRun;
}

/**
 * Enrol a runner, the first step of the job lifecycle.
 *
 * The runner id is a UUID for the same reason as `uniqueRunId`: `runners.id` is a
 * uuid column.
 */
export async function registerRunner(
  request: APIRequestContext,
  capabilities: readonly string[] = ['playwright'],
): Promise<RunnerIdentity> {
  // The name has to be unique too, not just the id: `runners` carries a unique
  // index on the identity, and reusing one name across tests is a 23505 that
  // reads as "the runner API is broken".
  const runnerId = uniqueRunId();
  const response = await request.post(`${API_BASE}/api/v1/runners/register`, {
    headers: { ...API_AUTH_HEADERS, ...RUNNER_REGISTRATION_HEADERS },
    data: {
      runnerId,
      name: `e2e-runner-${runnerId.slice(0, 8)}`,
      version: 'e2e',
      capabilities: [...capabilities],
      slots: 1,
    },
  });
  expect(
    response.status(),
    `POST /api/v1/runners/register -> ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const identity = (await readJson(response)) as RunnerIdentity;
  expect(identity.token, 'a registered runner must be issued a token').toBeTruthy();
  return identity;
}

export async function claimJob(
  request: APIRequestContext,
  runner: RunnerIdentity,
  capabilities: readonly string[] = ['playwright'],
  wantRunId?: string,
): Promise<JobClaim> {
  // A runner claims off a **shared** queue, so the first claim a test makes is whatever
  // job was queued earliest — including one an earlier spec enqueued. Asserting that the
  // first claim is *this* test's run is asserting that the suite ran in an order, which
  // is why two of the six failures here reported a `runId` belonging to a different
  // spec.
  //
  // So when the caller says which run it is leasing, the claim loops until it gets that
  // one. That is what a runner actually does, and it makes the specs order-independent
  // rather than dependent on a queue that happens to be empty. Bounded, and the message
  // names the run it was looking for: an unbounded loop here would hang the lane rather
  // than fail it.
  const attempts = wantRunId === undefined ? 1 : 25;
  let last: JobClaim | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await request.post(
      `${API_BASE}/api/v1/runners/${runner.runnerId}/jobs/claim`,
      {
        headers: jsonHeaders({ Authorization: `Bearer ${runner.token}` }),
        data: { capabilities: [...capabilities] },
      },
    );
    // 204 is the API's "nothing to claim", which is a legitimate answer to a single
    // attempt and is what a flaky claim would look like.
    expect(
      response.status(),
      `POST /api/v1/runners/${runner.runnerId}/jobs/claim -> ${response.status()}`,
    ).toBe(200);
    const claim = (await readJson(response)) as JobClaim;
    if (wantRunId === undefined || claim.runId === wantRunId) return claim;
    last = claim;
  }
  throw new Error(
    `no claim returned run ${String(wantRunId)} after ${String(attempts)} attempt(s); the last ` +
      `claim was for ${String(last?.runId)}. Either the run's job was never enqueued, or the ` +
      'queue holds more unclaimed jobs than the attempt bound.',
  );
}

export async function uploadArtifact(
  request: APIRequestContext,
  runner: RunnerIdentity,
  job: JobClaim,
  artifact: { name: string; kind?: string; contentType: string; body: string },
): Promise<ArtifactDescriptor> {
  const response = await request.post(`${API_BASE}/api/v1/jobs/${job.jobId}/artifacts`, {
    headers: jsonHeaders({ Authorization: `Bearer ${runner.token}` }),
    data: {
      name: artifact.name,
      kind: artifact.kind ?? 'log',
      contentType: artifact.contentType,
      bytesBase64: Buffer.from(artifact.body, 'utf-8').toString('base64'),
      leaseId: job.leaseId,
      fencingToken: job.fencingToken,
    },
  });
  expect(
    response.status(),
    `POST /api/v1/jobs/${job.jobId}/artifacts -> ${response.status()} ${await response.text()}`,
  ).toBe(201);
  return (await readJson(response)) as ArtifactDescriptor;
}

export async function completeJob(
  request: APIRequestContext,
  runner: RunnerIdentity,
  job: JobClaim,
  completion: {
    outcome: 'passed' | 'failed' | 'partial';
    summary: { total: number; passed: number; failed: number };
    tests?: Array<{
      id: string;
      title: string;
      file: string;
      status: 'passed' | 'failed';
      durationMs?: number;
      error?: { code: string; message: string };
    }>;
  },
): Promise<CanonicalRun> {
  const response = await request.post(`${API_BASE}/api/v1/jobs/${job.jobId}/complete`, {
    headers: jsonHeaders({ Authorization: `Bearer ${runner.token}` }),
    data: {
      leaseId: job.leaseId,
      fencingToken: job.fencingToken,
      phase: 'complete',
      outcome: completion.outcome,
      summary: completion.summary,
      ...(completion.tests ? { tests: completion.tests } : {}),
    },
  });
  expect(
    response.status(),
    `POST /api/v1/jobs/${job.jobId}/complete -> ${response.status()} ${await response.text()}`,
  ).toBe(200);
  return (await readJson(response)) as CanonicalRun;
}

export async function cancelRun(request: APIRequestContext, runId: string): Promise<CanonicalRun> {
  const response = await request.post(`${API_BASE}/api/v1/runs/${runId}/cancel`, {
    headers: API_AUTH_HEADERS,
  });
  expect(
    response.status(),
    `POST /api/v1/runs/${runId}/cancel -> ${response.status()} ${await response.text()}`,
  ).toBe(200);
  return (await readJson(response)) as CanonicalRun;
}

export async function getReleaseReadiness(
  request: APIRequestContext,
  releaseId: string,
): Promise<{
  releaseId: string;
  decision: string;
  browser: string;
  domains: Record<string, string>;
  latestRunId: string | null;
}> {
  const response = await request.get(`${API_BASE}/api/v1/releases/${releaseId}/readiness`, {
    headers: API_AUTH_HEADERS,
  });
  expect(response.status(), `GET readiness for ${releaseId} -> ${response.status()}`).toBe(200);
  return (await readJson(response)) as {
    releaseId: string;
    decision: string;
    browser: string;
    domains: Record<string, string>;
    latestRunId: string | null;
  };
}
