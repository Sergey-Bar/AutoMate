/**
 * `POST /api/v1/projects/:id/tests/reports` — a CI job's test report, recorded as a run of the
 * project, and the quarantine verdict on it.
 *
 * `automate test -- <command>` posts here after the command exits non-zero, and keeps the
 * command's exit code unless the answer is `quarantine.excused: true`. So this route is the
 * one place a CI job learns whether a failure is excused, and it answers from the same two
 * functions the gate reads: `parseUploadDocument` reads the report as
 * `/api/v1/reporter/upload` does, and `excusesRun` decides as `evaluateQualityGate` does.
 *
 * **The run id is derived, not invented**: a UUID from the project and the report's digest,
 * so a CLI that re-sends the same report after a dropped connection gets the same run as a
 * `duplicate` rather than a second run. The caller sends `startedAt` for the same reason —
 * the canonical fingerprint covers it, and a fresh `now` would make the retry a conflict.
 */

import { createHash } from 'node:crypto';
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  TestReportQuerySchema,
  storedTestIdentity,
  type TestReportVerdict,
} from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { domainErrorResponse } from '../errors/boundary.js';
import { excusesRun, type QuarantineMatch } from '../execution/quarantine-excusal.js';
import type { ExecutionTestResult } from '../execution/types.js';
import type { RealtimeBus } from '../realtime/realtime-bus.js';
import type { RunRepository } from '../repositories/run-repository.js';
import { ingestCanonicalResult } from '../services/canonical-ingestion.js';
import type { ReporterResultStore } from '../services/reporter-ingestion.js';
import { parseUploadDocument } from './reporter.js';

const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const MAX_LISTED = 50;

/** The canonical format each accepted spelling is read as. */
const FORMAT_FIELD: Record<(typeof TestReportQuerySchema.shape.format.options)[number], string> = {
  junit: 'junit-xml',
  'playwright-json': 'playwright-json',
};

export interface TestReportSink {
  repository: RunRepository;
  canonicalStore: ReporterResultStore;
  bus?: RealtimeBus;
  /** The workspace's quarantine entries — the source every gate evaluation reads. */
  quarantined: (workspaceId: string) => Promise<readonly QuarantineMatch[]>;
}

export interface TestReportRouteOptions {
  /** `uploaderGuard`: the reporter secret, or an access token pinned to the project. */
  uploader: MiddlewareHandler;
  workspaceId: string;
  /**
   * Where the run is recorded and what quarantine it is judged against. Absent, the route
   * is still registered — so the authz matrix lists it — and answers `NOT_CONFIGURED`.
   */
  sink: TestReportSink | undefined;
  /** Whether the project is registered in this workspace. */
  projectExists: (projectId: string) => Promise<boolean>;
}

/** A UUID (version 5 layout) from a digest, so one report is one run id. */
export function runIdFor(projectId: string, digest: string): string {
  const hex = createHash('sha256').update(`${projectId}:${digest}`).digest('hex');
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

export function createTestReportRoutes(options: TestReportRouteOptions): Hono {
  const app = new Hono();
  app.post(
    '/api/v1/projects/:id/tests/reports',
    options.uploader,
    bodyLimit({
      maxSize: MAX_REPORT_BYTES,
      onError: (context) =>
        domainErrorResponse(
          context,
          new DomainError('PAYLOAD_TOO_LARGE', 'Request body too large'),
        ),
    }),
    async (context) => {
      const sink = options.sink;
      if (sink === undefined) {
        throw new DomainError(
          ErrorCode.NOT_CONFIGURED,
          'Test report persistence is not configured',
          {
            callerSafe: true,
          },
        );
      }
      const projectId = context.req.param('id');
      const query = TestReportQuerySchema.safeParse(context.req.query());
      if (!query.success) {
        throw new DomainError(ErrorCode.INVALID_REQUEST, 'Invalid test report query', {
          details: { issues: query.error.issues },
        });
      }
      if (!(await options.projectExists(projectId))) {
        throw new DomainError(ErrorCode.NOT_FOUND, `No project ${projectId}`);
      }
      const bytes = new Uint8Array(await context.req.arrayBuffer());
      const digest = createHash('sha256').update(bytes).digest('hex');
      const result = parseUploadDocument(
        {
          bytes,
          fields: {
            format: FORMAT_FIELD[query.data.format],
            runId: runIdFor(projectId, digest),
            projectId,
            sourceUri: 'automate-cli/test',
            ...(query.data.branch === undefined ? {} : { branch: query.data.branch }),
            ...(query.data.commit === undefined ? {} : { commitSha: query.data.commit }),
            ...(query.data.startedAt === undefined ? {} : { startedAt: query.data.startedAt }),
          },
        },
        options.workspaceId,
      );
      const ingested = await ingestCanonicalResult(result, {
        store: sink.canonicalStore,
        repository: sink.repository,
        ...(sink.bus === undefined ? {} : { bus: sink.bus }),
        triggeredBy: 'ci',
      });
      if (ingested.status === 'conflict') {
        throw new DomainError('CONFLICT', 'Conflicting result for this run', {
          callerSafe: true,
          details: { reason: 'conflicting-canonical-result', runId: result.identity.runId },
        });
      }
      const { run, tests } = ingested.projection;
      const asResults: ExecutionTestResult[] = tests.map((test) => ({
        id: test.id,
        title: test.title,
        file: test.file,
        stableId: test.stableId,
        status: test.status === 'queued' || test.status === 'running' ? 'unknown' : test.status,
      }));
      const reportErrors = result.reportErrors?.length ?? 0;
      const failed = asResults.filter(
        (test) => test.status === 'failed' || test.status === 'timed_out',
      );
      const { excused, excusal } = excusesRun(
        {
          tests: asResults,
          summary: {
            total: run.total,
            passed: run.passed,
            failed: failed.length,
            flaky: run.flaky,
            skipped: run.skipped,
            blocked: 0,
            unknown: 0,
            durationMs: run.durationMs,
          },
          error:
            reportErrors === 0
              ? null
              : { code: 'REPORT_ERROR', message: 'The report has errors outside its tests' },
        },
        await sink.quarantined(options.workspaceId),
      );
      const excusedTests = new Set(excusal.tests);
      const verdict: TestReportVerdict = {
        runId: run.id,
        ingested: ingested.status,
        status: run.status,
        tests: {
          total: run.total,
          passed: run.passed,
          failed: failed.length,
          flaky: run.flaky,
          skipped: run.skipped,
        },
        reportErrors,
        quarantine: {
          excused,
          excusedTests: excusal.tests.slice(0, MAX_LISTED),
          unexcusedFailures: failed
            .map((test) => storedTestIdentity(test))
            .filter((identity) => !excusedTests.has(identity))
            .slice(0, MAX_LISTED),
        },
      };
      return context.json(verdict);
    },
  );
  return app;
}
