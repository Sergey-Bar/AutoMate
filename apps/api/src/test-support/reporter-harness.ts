/**
 * reporter-harness.ts — the reporter routes, wired the way `index.ts` wires them.
 *
 * `createReporterRoutes` takes a `repository` **and** a `canonicalStore`, and the second
 * one is not optional decoration: it is where a `CanonicalRunResult` lands, and
 * `GET /api/v1/reporting/kpis` reads nothing else. A test that wires only the repository
 * gets a `503 NOT_CONFIGURED` from the upload door, which is the honest answer — but it
 * means a suite that predates the canonical store cannot be fixed by adding an argument to
 * a constructor call. It has to be fixed by wiring the system it is testing.
 *
 * So the wiring lives here, once, and every reporter suite composes it. That is also what
 * keeps the suites honest about the property they exist to protect: a test that posts a
 * report and reads `runs` is testing the projection, and can only do so if the canonical
 * row really was written underneath it.
 */

import { Hono } from 'hono';
import { withErrorBoundary } from './error-boundary-app.js';
import { createReporterRoutes, type ReporterRouteOptions } from '../routes/reporter.js';
import { createReportingRoutes } from '../routes/reporting.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import { InMemoryRealtimeBus } from '../realtime/realtime-bus.js';
import { ReporterIngestionService } from '../services/reporter-ingestion.js';

/** The workspace every reporter harness runs in. One, so the two stores agree. */
export const HARNESS_WORKSPACE_ID = 'default-workspace';

/** Everything a reporter suite may vary, and nothing it may not. */
export interface ReporterHarnessOptions extends Omit<
  ReporterRouteOptions,
  'canonicalStore' | 'workspaceId'
> {
  /** Defaults to a fresh `InMemoryRunRepository`, returned so the test can read it. */
  repository?: ReporterRouteOptions['repository'];
  workspaceId?: string;
}

export interface ReporterHarness {
  app: Hono;
  runs: InMemoryRunRepository;
  store: ReporterIngestionService;
  /** The bus the routes publish through, whether the caller supplied one or not. */
  bus: InMemoryRealtimeBus;
  /** The KPI endpoint, over the *same* store — the point of the harness. */
  reporting: Hono;
}

export function reporterHarness(
  secret: string | undefined,
  options: ReporterHarnessOptions = {},
): ReporterHarness {
  const runs = (options.repository ?? new InMemoryRunRepository()) as InMemoryRunRepository;
  const workspaceId = options.workspaceId ?? HARNESS_WORKSPACE_ID;
  const store = new ReporterIngestionService(workspaceId);
  const bus = (options.bus as InMemoryRealtimeBus | undefined) ?? new InMemoryRealtimeBus();
  const app = withErrorBoundary(
    createReporterRoutes(secret, {
      ...options,
      repository: runs,
      canonicalStore: store,
      workspaceId,
      bus,
    }),
  );
  return { app, runs, store, bus, reporting: withErrorBoundary(createReportingRoutes(store)) };
}
