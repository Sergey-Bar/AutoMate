import type { Hono } from 'hono';
import type { Role } from '../services/access-service.js';
import { requireRole, type CallerResolver } from './roles.js';

/**
 * Who may call each route group that does not carry its own guard, written as one table.
 *
 * Until LAN mode, `ACCESS_CONTROL=enforced` reached the project and repository-health routes
 * only: runs, artifacts, the dashboard, events and chat answered anyone, because ADR-006's
 * single operator had no second party to keep out. An install on a shared network has one,
 * so every route is now either here, guarded where it is declared (reporter, runner,
 * project), or in {@link PUBLIC_ROUTES} — and `authz-matrix.test.ts` fails on a route that
 * is in none of them, because the generated matrix would show it `open`.
 *
 * A table rather than a wildcard for one reason: `/api/v1/jobs/:jobId/complete` is a runner
 * route under the same prefix as `/api/v1/jobs`, and a `jobs/*` guard would ask a runner
 * for a viewer role. Each row names exactly one method and path.
 *
 * With `ACCESS_CONTROL=open` every guard admits the caller as the operator, so this changes
 * nothing for a single-machine install.
 */
export const ROUTE_ROLES: ReadonlyArray<
  readonly ['GET' | 'POST' | 'PATCH' | 'DELETE', string, Role]
> = [
  // Reading is viewing.
  ['GET', '/api/v1/agents', 'viewer'],
  ['GET', '/api/v1/agents/:domain', 'viewer'],
  ['GET', '/api/v1/artifacts/:artifactId', 'viewer'],
  ['GET', '/api/v1/automations', 'viewer'],
  ['GET', '/api/v1/chat/models', 'viewer'],
  ['GET', '/api/v1/dashboard/analytics/summary', 'viewer'],
  ['GET', '/api/v1/dashboard/analytics/trend', 'viewer'],
  ['GET', '/api/v1/dashboard/insights', 'viewer'],
  ['GET', '/api/v1/dashboard/quality-gates', 'viewer'],
  ['GET', '/api/v1/dashboard/quality-gates/:id', 'viewer'],
  ['GET', '/api/v1/dashboard/quarantine', 'viewer'],
  ['GET', '/api/v1/dashboard/runs/:id', 'viewer'],
  ['GET', '/api/v1/dashboard/runs/:runId/tests', 'viewer'],
  ['GET', '/api/v1/dashboard/suites', 'viewer'],
  ['GET', '/api/v1/dashboard/tests', 'viewer'],
  ['GET', '/api/v1/events', 'viewer'],
  ['GET', '/api/v1/integrations/maturity', 'viewer'],
  ['GET', '/api/v1/jobs', 'viewer'],
  ['GET', '/api/v1/quality-policies', 'viewer'],
  ['GET', '/api/v1/releases/:releaseId/readiness', 'viewer'],
  ['GET', '/api/v1/reporting/kpis', 'viewer'],
  ['GET', '/api/v1/reporting/runs/:runId', 'viewer'],
  ['GET', '/api/v1/runs', 'viewer'],
  ['GET', '/api/v1/runs/:runId', 'viewer'],
  ['GET', '/api/v1/runs/:runId/artifacts', 'viewer'],
  ['GET', '/api/v1/runs/:runId/artifacts/:artifactId', 'viewer'],
  ['GET', '/api/v1/runs/:runId/events', 'viewer'],
  ['GET', '/api/v1/runs/:runId/gate', 'viewer'],
  ['GET', '/api/v1/schedules', 'viewer'],
  // Starting, stopping and triaging work is operating. Chat is here because a completion
  // spends the installation's model budget.
  ['POST', '/api/v1/agents/:domain/:action', 'operator'],
  ['POST', '/api/v1/automations', 'operator'],
  ['POST', '/api/v1/automations/:id/jobs', 'operator'],
  ['POST', '/api/v1/chat/completions', 'operator'],
  ['POST', '/api/v1/dashboard/quarantine', 'operator'],
  ['PATCH', '/api/v1/dashboard/quarantine/:id', 'operator'],
  ['DELETE', '/api/v1/dashboard/quarantine/:id', 'operator'],
  ['PATCH', '/api/v1/dashboard/runs/:id/status', 'operator'],
  ['POST', '/api/v1/jobs/:id/cancel', 'operator'],
  ['POST', '/api/v1/runs', 'operator'],
  ['POST', '/api/v1/runs/:runId/cancel', 'operator'],
  ['POST', '/api/v1/runs/:runId/retry', 'operator'],
  ['POST', '/api/v1/schedules', 'operator'],
  // Changing what "passing" means for everyone is configuration.
  ['POST', '/api/v1/dashboard/quality-gates', 'admin'],
  ['POST', '/api/v1/quality-policies', 'admin'],
];

/**
 * The routes nobody needs a credential for: the probes a load balancer and a scraper call,
 * and the credential exchange itself. Anything else that is `open` in the matrix is a
 * route someone forgot to classify.
 */
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  'GET /health',
  'GET /ready',
  'GET /metrics',
  'GET /api/v1/health',
  'GET /api/v1/ready',
  'GET /api/v1/features',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/logout',
  'GET /api/v1/auth/session',
  'POST /api/v1/auth/token-login',
  'POST /api/v1/auth/token-logout',
  'GET /api/v1/auth/whoami',
  // A device being paired has no credential yet; the code is the credential, and the route
  // is rate-limited per client and installation-wide (`routes/pairing.ts`).
  'POST /api/v1/pair',
]);

/**
 * Registers the guards in {@link ROUTE_ROLES}. Call it before the routes are mounted: Hono
 * runs matching handlers in registration order, so a guard registered after its route
 * would never be reached.
 */
export function applyRouteAccess(app: Hono, resolver: CallerResolver): void {
  for (const [method, path, role] of ROUTE_ROLES) {
    app.on(method, path, requireRole(role, resolver));
  }
}
