/**
 * reporter-two-doors.test.ts — the two ingestion systems, and what they disagree about.
 *
 * This is ledger row **P-73**'s evidence, written before the fix and watched fail.
 *
 * The repository had two ways for a test report to get in, and they were disjoint:
 *
 *   - `POST /api/v1/reporter/upload` — authenticated, rate-limited, artifact-preserving,
 *     and the door every customer actually uses. It parsed JUnit and Playwright with its
 *     own scanner and its own status mapping, and wrote `runs` / `tests`.
 *   - `POST /api/v1/reporter/results` — the canonical door. It parsed nothing; it took a
 *     `CanonicalRunResult` and wrote `canonical_run_results`, the only table
 *     `@automate/reporting` can read.
 *
 * Three consequences were live at once, and each is a test below rather than a sentence
 * in a document:
 *
 *   1. **The same JUnit file got two answers.** `<rerunFailure>` is JUnit's documented way
 *      of saying "failed once, passed on a retry". The canonical adapter reads it and
 *      reports `flaky`; the upload scanner recognised only `<skipped>`, `<failure>` and
 *      `<error>`, so it reported `passed`. A retried suite was a clean pass on one door
 *      and a flake on the other, and which door a customer used decided which answer they
 *      got.
 *
 *   2. **The upload door's data was invisible to analytics.** The door wrote `runs`, and
 *      `GET /api/v1/reporting/kpis` reads `canonical_run_results`. A year of daily
 *      testing could arrive through the supported door and every KPI would still answer
 *      `proofCeiling: 'unknown'` — the console declaring the busiest system in the
 *      installation not knowable.
 *
 *   3. **A harness interruption was counted as a product failure.** Playwright emits
 *      `interrupted` when the *harness* stops the run. The upload door mapped it to
 *      `failed`; the canonical vocabulary has `cancelled` for exactly this, and
 *      `policy.ts` classifies it as non-product because cancelling a run yields no
 *      outcome at all. So the upload path inflated the failure rate with the runner's own
 *      cancellations.
 *
 * Every test here feeds the **same bytes** through both doors and asserts they agree.
 * Asserting on either door's own vocabulary would restate the defect rather than catch it.
 */

import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { createReporterRoutes } from './reporter.js';
import { createReportingRoutes } from './reporting.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import { ReporterIngestionService } from '../services/reporter-ingestion.js';
import { junitXmlAdapter } from '@automate/reporter';

const SECRET = 'shared-reporter-secret';
const WORKSPACE = 'workspace-1';

interface Harness {
  upload(bytes: Uint8Array, fields: Record<string, string>): Promise<Response>;
  runs: InMemoryRunRepository;
  store: ReporterIngestionService;
  kpis(runId?: string): Promise<Response>;
  repository(): Hono;
}

/** The two doors, wired to one workspace and one repository, as `index.ts` wires them. */
function harness(): Harness {
  const runs = new InMemoryRunRepository();
  const store = new ReporterIngestionService(WORKSPACE);
  const repository = withErrorBoundary(
    createReporterRoutes(SECRET, {
      repository: runs,
      workspaceId: WORKSPACE,
      canonicalStore: store,
    }),
  );
  const reporting = withErrorBoundary(createReportingRoutes(store));
  return {
    runs,
    store,
    repository: () => repository,
    kpis: async (runId) =>
      reporting.request(
        `/api/v1/reporting/kpis${runId === undefined ? '' : `?runId=${encodeURIComponent(runId)}`}`,
      ),
    upload: async (bytes, fields) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      form.set('file', new File([bytes], 'report', { type: fields['type'] ?? 'application/xml' }));
      return repository.request('/api/v1/reporter/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SECRET}` },
        body: form,
      });
    },
  };
}

/**
 * A JUnit report whose one interesting property is a retry.
 *
 * Both cases declare `status="passed"`, because that is what a CI reporter emits: the
 * suite as a whole passed, and the retry is recorded as a `rerunFailure` child. A
 * `<testcase>` with no status attribute at all is a different fixture — an *unobserved*
 * test — and asserting on it here would be asserting about a different defect.
 */
const RETRIED_JUNIT = new TextEncoder().encode(
  '<testsuite name="auth" tests="2">' +
    '<testcase classname="auth" name="login" file="tests/auth.spec.ts" time="0.12" status="passed">' +
    '<rerunFailure>attempt 1: expected 200, got 500</rerunFailure>' +
    '</testcase>' +
    '<testcase classname="auth" name="logout" file="tests/auth.spec.ts" time="0.05" status="passed"/>' +
    '</testsuite>',
);

describe('P-73 — the same JUnit document through both doors', () => {
  it('reports a retried test as flaky on the upload door, as the canonical door does', async () => {
    const doors = harness();

    // The canonical door first, because its answer is the one the whole product is built
    // on and it needs no fix: parse the bytes with the adapter, and read what it says.
    const canonical = junitXmlAdapter.parse(RETRIED_JUNIT, {
      workspaceId: WORKSPACE,
      runId: 'run-retried',
      sourceUri: 'artifact://run-retried/raw',
      sourceDigest: 'a'.repeat(64),
      producerVersion: '1.0.0',
      adapterVersion: '1.0.0',
      startedAt: '2026-10-02T00:00:00.000Z',
    });
    expect(canonical.status).toBe('flaky');

    const uploaded = await doors.upload(RETRIED_JUNIT, {
      runId: 'run-retried',
      artifactType: 'junit',
    });
    expect(uploaded.status).toBe(202);

    const run = await doors.runs.getRun('run-retried');
    // THE ASSERTION. The upload door derived a clean pass from a report whose only
    // interesting property was a retry: the `flaky` counter is 0 and the run is green.
    expect(run?.flaky, 'the upload door must record the retry it was sent').toBeGreaterThan(0);
    expect(run?.status, 'a retried suite is not a clean pass').not.toBe('passed');
  });

  it('records the same flaky verdict on the tests table as on the canonical attempts', async () => {
    const doors = harness();
    await doors.upload(RETRIED_JUNIT, { runId: 'run-retried-rows', artifactType: 'junit' });

    const tests = await doors.runs.listTests('run-retried-rows');
    const retried = tests.find((test) => test.title.includes('login'));
    expect(retried?.status).toBe('flaky');
  });
});

describe('P-73 — the upload door feeds the analytics', () => {
  it('answers GET /api/v1/reporting/kpis about a run that arrived through upload', async () => {
    const doors = harness();
    const uploaded = await doors.upload(RETRIED_JUNIT, {
      runId: 'run-kpi',
      artifactType: 'junit',
    });
    expect(uploaded.status).toBe(202);

    // **This is Wave 0's merge gate.** Before the fix the door wrote `runs` and this
    // endpoint read `canonical_run_results`, so it answered over an empty population:
    // every metric `value: null`, `proofCeiling: 'unknown'` — "nothing has been shown" —
    // about a run that had been in the database the whole time. A console built on this
    // would have declared the busiest system in the installation not knowable.
    const response = await doors.kpis('run-kpi');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      metrics: Array<{ metric: string; value: number | null; denominator: number }>;
    };
    const firstPass = body.metrics.find((metric) => metric.metric === 'first-pass-rate');
    expect(firstPass?.denominator, 'the uploaded attempts must be in the population').toBe(2);
    expect(firstPass?.value).toBe(0.5);
  });

  it('records the uploaded run in the canonical store, not only in the projection', async () => {
    const doors = harness();
    await doors.upload(RETRIED_JUNIT, { runId: 'run-canonical', artifactType: 'junit' });
    const stored = await doors.store.get('run-canonical');
    expect(stored, 'an uploaded report must be queryable as a canonical result').toBeDefined();
    expect(stored?.provenance.sourceDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(stored?.provenance.adapterVersion).toBe('2');
  });
});

describe('P-73 — a harness interruption is not a product failure', () => {
  const INTERRUPTED_PLAYWRIGHT = new TextEncoder().encode(
    JSON.stringify({
      suites: [
        {
          title: 'auth',
          file: 'tests/auth.spec.ts',
          tests: [
            {
              title: 'login',
              status: 'interrupted',
              results: [{ status: 'interrupted', duration: 12 }],
            },
          ],
        },
      ],
    }),
  );

  it('does not count an interrupted Playwright test as a product failure', async () => {
    const doors = harness();
    const uploaded = await doors.upload(INTERRUPTED_PLAYWRIGHT, {
      runId: 'run-interrupted',
      artifactType: 'playwright',
      type: 'application/json',
    });
    expect(uploaded.status).toBe(202);

    const tests = await doors.runs.listTests('run-interrupted');
    expect(tests.map((test) => test.status)).not.toContain('failed');
    const run = await doors.runs.getRun('run-interrupted');
    expect(run?.failed).toBe(0);
  });
});
