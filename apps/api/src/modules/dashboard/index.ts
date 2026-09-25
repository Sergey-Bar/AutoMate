/**
 * index.ts — Dashboard Hono sub-app
 *
 * Combines all dashboard route modules under a single Hono instance.
 * Mount in apps/api/src/index.ts via: app.route('/', createDashboardModule({ repository }))
 */
import { Hono } from 'hono';
import type { RunRepository } from '../../repositories/run-repository.js';
import type { QuarantineStore } from './quarantine.js';
import type { QualityGateStore } from './quality-gates.js';
import { createDashboardRunsRoutes } from './runs.js';
import { createDashboardTestsRoutes } from './tests.js';
import { createDashboardAnalyticsRoutes } from './analytics.js';
import {
  createDashboardQuarantineRoutes,
  InMemoryQuarantineStore,
} from './quarantine.js';
import {
  createDashboardQualityGatesRoutes,
  InMemoryQualityGateStore,
} from './quality-gates.js';

// ---------------------------------------------------------------------------
// Module options
// ---------------------------------------------------------------------------

export interface DashboardModuleOptions {
  /**
   * Shared run repository — must be the same instance used by the reporter
   * and runs routes so dashboard reads reflect ingested data immediately.
   */
  repository: RunRepository;
  /** Optional quarantine store (for production DB-backed wiring or tests) */
  quarantineStore?: QuarantineStore;
  /** Optional quality gate store (for production DB-backed wiring or tests) */
  qualityGateStore?: QualityGateStore;
}

// ---------------------------------------------------------------------------
// Module factory
// ---------------------------------------------------------------------------

export function createDashboardModule(options: DashboardModuleOptions): Hono {
  const app = new Hono();

  // Shared in-memory stores (per-process lifetime, temporary until Postgres layer)
  const quarantineStore = options.quarantineStore ?? new InMemoryQuarantineStore();
  const qualityGateStore = options.qualityGateStore ?? new InMemoryQualityGateStore();

  app.route('/', createDashboardRunsRoutes({ repository: options.repository }));
  app.route('/', createDashboardTestsRoutes({ repository: options.repository }));
  app.route('/', createDashboardAnalyticsRoutes({ repository: options.repository }));
  app.route('/', createDashboardQuarantineRoutes({ store: quarantineStore }));
  app.route('/', createDashboardQualityGatesRoutes({ store: qualityGateStore }));

  return app;
}

// Re-export store types so callers can inject custom stores for testing
export type { QuarantineStore } from './quarantine.js';
export type { QualityGateStore } from './quality-gates.js';
export { InMemoryQuarantineStore } from './quarantine.js';
export { InMemoryQualityGateStore } from './quality-gates.js';
