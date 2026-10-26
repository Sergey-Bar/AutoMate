import { describe, expect, it } from 'vitest';
import { Hono, type MiddlewareHandler } from 'hono';
import { TestReportVerdictSchema, testIdentity } from '@automate/shared-contracts';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import { ReporterIngestionService } from '../services/reporter-ingestion.js';
import { boundQuarantineSource, type QuarantineMatch } from '../execution/quarantine-excusal.js';
import { createTestReportRoutes } from './test-reports.js';

/**
 * `POST /api/v1/projects/:id/tests/reports` — what `automate test` asks when the test
 * command failed. The answer is the server's, from the report it parsed and the quarantine
 * it holds; these cases are the exit rules the CLI applies, seen from the server.
 */

const WORKSPACE = 'ws-tests';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const COMMIT = 'abcdef1234567';
const pass: MiddlewareHandler = async (_context, next) => next();

const FLAKY = testIdentity({
  file: 'tests/pay.spec.ts',
  describePath: ['Checkout'],
  title: 'pays',
});
const BROKEN = testIdentity({
  file: 'tests/pay.spec.ts',
  describePath: ['Checkout'],
  title: 'refunds',
});

const approved = (stableId: string): QuarantineMatch => ({
  stableId,
  testTitle: 'pays',
  testFile: 'tests/pay.spec.ts',
  status: 'approved',
});

function junit(failing: readonly string[]): string {
  const cases = ['pays', 'refunds', 'lists']
    .map((name) =>
      failing.includes(name)
        ? `<testcase classname="Checkout" file="tests/pay.spec.ts" name="${name}"><failure message="boom">boom</failure></testcase>`
        : `<testcase classname="Checkout" file="tests/pay.spec.ts" name="${name}"/>`,
    )
    .join('');
  return `<testsuite>${cases}</testsuite>`;
}

function harness(
  entries: readonly QuarantineMatch[] = [],
  options: { entriesFor?: string; projects?: readonly string[] } = {},
) {
  const repository = new InMemoryRunRepository();
  const app = withErrorBoundary(
    new Hono().route(
      '/',
      createTestReportRoutes({
        uploader: pass,
        workspaceId: WORKSPACE,
        sink: {
          repository,
          canonicalStore: new ReporterIngestionService(WORKSPACE),
          quarantined: boundQuarantineSource(options.entriesFor ?? WORKSPACE, async () => entries),
        },
        projectExists: async (id) => (options.projects ?? [PROJECT]).includes(id),
      }),
    ),
  );
  const send = (body: string, query = 'format=junit') =>
    app.request(`/api/v1/projects/${PROJECT}/tests/reports?${query}&commit=${COMMIT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body,
    });
  return { app, repository, send };
}

async function verdictOf(response: Response) {
  expect(response.status).toBe(200);
  return TestReportVerdictSchema.parse(await response.json());
}

describe('POST /api/v1/projects/:id/tests/reports', () => {
  it('excuses a run whose only failure is an approved quarantined test', async () => {
    const { send, repository } = harness([approved(FLAKY)]);
    const verdict = await verdictOf(await send(junit(['pays'])));
    expect(verdict.quarantine).toEqual({
      excused: true,
      excusedTests: [FLAKY],
      unexcusedFailures: [],
    });
    expect(verdict.tests).toMatchObject({ total: 3, passed: 2, failed: 1 });
    // The run is recorded as it happened, for this project and commit.
    const run = await repository.latestRunForCommit(PROJECT, COMMIT);
    expect(run?.id).toBe(verdict.runId);
    expect(run?.status).toBe('failed');
  });

  it('does not excuse a failure no entry covers, and names it', async () => {
    const { send } = harness([approved(FLAKY)]);
    const verdict = await verdictOf(await send(junit(['pays', 'refunds'])));
    expect(verdict.quarantine.excused).toBe(false);
    expect(verdict.quarantine.unexcusedFailures).toEqual([BROKEN]);
  });

  it('does not excuse a report with an error outside its tests', async () => {
    const { send } = harness([
      {
        stableId: testIdentity({ file: 'a.spec.ts', title: 'pays', project: 'webkit' }),
        testTitle: 'pays',
        testFile: 'a.spec.ts',
        status: 'approved',
      },
    ]);
    const report = JSON.stringify({
      errors: [{ message: 'Error: global teardown threw' }],
      suites: [
        {
          title: 'a.spec.ts',
          file: 'a.spec.ts',
          specs: [
            {
              title: 'pays',
              file: 'a.spec.ts',
              tests: [
                { projectName: 'chromium', status: 'expected', results: [{ status: 'passed' }] },
                { projectName: 'webkit', status: 'unexpected', results: [{ status: 'failed' }] },
              ],
            },
          ],
        },
      ],
    });
    const verdict = await verdictOf(await send(report, 'format=playwright-json'));
    expect(verdict.reportErrors).toBe(1);
    expect(verdict.quarantine.excused).toBe(false);
  });

  it('runs the project policy before the verdict, so this run can be excused by it', async () => {
    const entries: QuarantineMatch[] = [];
    const repository = new InMemoryRunRepository();
    const app = withErrorBoundary(
      new Hono().route(
        '/',
        createTestReportRoutes({
          uploader: pass,
          workspaceId: WORKSPACE,
          sink: {
            repository,
            canonicalStore: new ReporterIngestionService(WORKSPACE),
            quarantined: async () => entries,
            applyPolicy: async () => {
              entries.push(approved(FLAKY));
              return { quarantined: [FLAKY], released: [] };
            },
          },
          projectExists: async () => true,
        }),
      ),
    );
    const response = await app.request(
      `/api/v1/projects/${PROJECT}/tests/reports?format=junit&commit=${COMMIT}`,
      { method: 'POST', body: junit(['pays']) },
    );
    const verdict = await verdictOf(response);
    expect(verdict.autoQuarantine).toEqual({ quarantined: [FLAKY], released: [] });
    expect(verdict.quarantine.excused).toBe(true);
  });

  it("never reads another workspace's quarantine", async () => {
    const { send } = harness([approved(FLAKY)], { entriesFor: 'ws-other' });
    expect((await verdictOf(await send(junit(['pays'])))).quarantine.excused).toBe(false);
  });

  it('answers the same run for the same report sent twice', async () => {
    const { send } = harness();
    const query = 'format=junit&startedAt=2026-10-26T12:00:00.000Z';
    const first = await verdictOf(await send(junit([]), query));
    const second = await verdictOf(await send(junit([]), query));
    expect(second.runId).toBe(first.runId);
    expect([first.ingested, second.ingested]).toEqual(['accepted', 'duplicate']);
    expect(first.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it('refuses a project that is not registered, a format it cannot read, and a broken report', async () => {
    const { app } = harness([], { projects: [] });
    const unknown = await app.request(`/api/v1/projects/${PROJECT}/tests/reports?format=junit`, {
      method: 'POST',
      body: junit([]),
    });
    expect(unknown.status).toBe(404);
    const { send } = harness();
    expect((await send(junit([]), 'format=k6')).status).toBe(400);
    const broken = await send('<testsuite>');
    expect(broken.status).toBe(400);
  });

  it('answers NOT_CONFIGURED without its stores, rather than pretending to record', async () => {
    const app = withErrorBoundary(
      new Hono().route(
        '/',
        createTestReportRoutes({
          uploader: pass,
          workspaceId: WORKSPACE,
          sink: undefined,
          projectExists: async () => true,
        }),
      ),
    );
    const response = await app.request(`/api/v1/projects/${PROJECT}/tests/reports?format=junit`, {
      method: 'POST',
      body: junit([]),
    });
    expect(response.status).toBe(503);
  });
});
