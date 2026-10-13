/**
 * The canonical `(method, path)` set, one line per route the product serves.
 *
 * Every route the app answers must appear here. `route-manifest.test.ts` fails on
 * a route that is registered but missing from this list, so a new route cannot be
 * added without being claimed as canonical — which is the moment to notice that
 * nothing tests it.
 *
 * ## Why this is a module and not a constant inside its own test
 *
 * It was a literal in `route-manifest.test.ts`, which was fine while the only
 * reader was that test. It stopped being fine the moment two generators needed
 * the same list: the OpenAPI document (`scripts/openapi.mjs`) and the authz
 * matrix generator both need "which paths this product serves", and a constant
 * private to a test file cannot be imported by either without copying it. A
 * second copy of the list is a second authority — a route added to one and not
 * the other is a document that describes a product this is not, and nothing
 * fails because nothing compares them.
 *
 * The test still proves the list against the app: it mounts every route module in
 * the order `index.ts` mounts them and asserts the two sets are equal in both
 * directions, plus that no `(method, path)` is registered twice. So this module
 * is not a claim the test repeats — it is the *one* place the claim lives, and
 * every reader of it is checked against the running app by the test that was
 * already here.
 *
 * ## Hono's duplicate registration is silent
 *
 * A route declared twice resolves by registration order, so the first wins and
 * the second is unreachable — which is how a dead route file survives with its
 * own passing test. Only the union of every module can see that, so the manifest
 * is the union's record and the duplicate assertion reads it back from the app.
 */
export const CANONICAL_API_ROUTES: ReadonlyArray<readonly [string, string]> = [
  // Health and capability manifest.
  ['GET', '/health'],
  ['GET', '/api/v1/health'],
  ['GET', '/api/v1/ready'],
  ['GET', '/ready'],
  ['GET', '/api/v1/features'],
  ['GET', '/metrics'],
  // Sessions.
  ['POST', '/api/v1/auth/login'],
  ['GET', '/api/v1/auth/session'],
  ['POST', '/api/v1/auth/logout'],
  // Ingestion.
  ['POST', '/api/v1/reporter/events'],
  ['POST', '/api/v1/reporter/upload'],
  ['POST', '/api/v1/reporter/results'],
  // Runs.
  ['GET', '/api/v1/runs'],
  ['POST', '/api/v1/runs'],
  ['GET', '/api/v1/runs/:runId'],
  ['GET', '/api/v1/runs/:runId/events'],
  ['POST', '/api/v1/runs/:runId/cancel'],
  ['POST', '/api/v1/runs/:runId/retry'],
  ['GET', '/api/v1/runs/:runId/gate'],
  ['GET', '/api/v1/runs/:runId/artifacts'],
  ['GET', '/api/v1/runs/:runId/artifacts/:artifactId'],
  // Releases and policies.
  ['GET', '/api/v1/releases/:releaseId/readiness'],
  ['GET', '/api/v1/quality-policies'],
  ['POST', '/api/v1/quality-policies'],
  ['GET', '/api/v1/integrations/maturity'],
  // Runners and jobs.
  ['POST', '/api/v1/runners/register'],
  ['POST', '/api/v1/runners/:runnerId/heartbeat'],
  ['POST', '/api/v1/runners/:runnerId/jobs/claim'],
  ['POST', '/api/v1/jobs/:jobId/events'],
  ['POST', '/api/v1/jobs/:jobId/events/batch'],
  ['POST', '/api/v1/jobs/:jobId/artifacts'],
  ['POST', '/api/v1/jobs/:jobId/complete'],
  // The queue, at `/execution/jobs` rather than `/api/v1/jobs`: the orchestration
  // module owns that path for its own in-process envelope list, and a collision
  // there would have been a silent 404 rather than a mount-time failure.
  ['GET', '/api/v1/execution/jobs'],
  // Artifacts.
  ['GET', '/api/v1/artifacts/:artifactId'],
  // Reporting.
  ['GET', '/api/v1/reporting/runs/:runId'],
  ['GET', '/api/v1/reporting/kpis'],
  // Realtime.
  ['GET', '/api/v1/events'],
  // Agents.
  ['GET', '/api/v1/agents'],
  ['GET', '/api/v1/agents/:domain'],
  ['POST', '/api/v1/agents/:domain/:action'],
  // Chat — the consumer `packages/automation` had no route for until now.
  ['GET', '/api/v1/chat/models'],
  ['POST', '/api/v1/chat/completions'],
  // Dashboard.
  ['GET', '/api/v1/dashboard/runs/:id'],
  ['PATCH', '/api/v1/dashboard/runs/:id/status'],
  ['GET', '/api/v1/dashboard/tests'],
  ['GET', '/api/v1/dashboard/suites'],
  ['GET', '/api/v1/dashboard/runs/:runId/tests'],
  ['GET', '/api/v1/dashboard/analytics/summary'],
  // The KPIs, each carrying the unit it was computed in — the endpoint that ends
  // the two-formatter guesswork (GLASS-3).
  ['GET', '/api/v1/dashboard/kpis/summary'],
  ['GET', '/api/v1/dashboard/quarantine'],
  ['POST', '/api/v1/dashboard/quarantine'],
  ['PATCH', '/api/v1/dashboard/quarantine/:id'],
  ['DELETE', '/api/v1/dashboard/quarantine/:id'],
  ['GET', '/api/v1/dashboard/quality-gates'],
  ['POST', '/api/v1/dashboard/quality-gates'],
  ['GET', '/api/v1/dashboard/quality-gates/:id'],
  // Projects: the registry, the command a run is resolved against, the run stop
  // that closes the loop, and the four derived QA reads plus the score diff.
  ['POST', '/api/v1/projects'],
  ['GET', '/api/v1/projects'],
  ['GET', '/api/v1/projects/:id'],
  // The profile edit, which the documentation site promised and nothing served.
  ['PATCH', '/api/v1/projects/:id'],
  // The decision loop: a verdict about a derived finding, recorded and read back.
  ['POST', '/api/v1/projects/:id/decisions'],
  ['GET', '/api/v1/projects/:id/decisions'],
  // The same store, asked the two questions the daily screen asks: whose work is
  // waiting, and what changed since. The timeline is the second one.
  ['GET', '/api/v1/projects/:id/decisions/timeline'],
  ['POST', '/api/v1/projects/:id/detect'],
  ['GET', '/api/v1/projects/:id/commands'],
  ['POST', '/api/v1/projects/:id/run.start'],
  ['POST', '/api/v1/runs/:runId/stop'],
  ['GET', '/api/v1/projects/:id/qa/score'],
  ['GET', '/api/v1/projects/:id/qa/gaps'],
  ['GET', '/api/v1/projects/:id/qa/hollow'],
  ['GET', '/api/v1/projects/:id/qa/flaky'],
  ['GET', '/api/v1/projects/:id/qa/structure'],
  // The probe's answer, for one project: what the repository's QA stack is,
  // with the evidence for every tool that was found.
  ['GET', '/api/v1/projects/:id/toolchain'],
  ['GET', '/api/v1/projects/:id/qa/score/diff'],
  ['POST', '/api/v1/projects/:id/copilot/answer'],
  // Legacy process-local control plane.
  ['POST', '/api/v1/runner/v1/enroll'],
  ['POST', '/api/v1/runner/v1/sync'],
  ['POST', '/api/v1/runner/v1/jobs/:jobId/events/batch'],
  ['GET', '/api/v1/automations'],
  ['POST', '/api/v1/automations'],
  ['GET', '/api/v1/schedules'],
  ['POST', '/api/v1/schedules'],
  ['GET', '/api/v1/jobs'],
  ['POST', '/api/v1/automations/:id/jobs'],
  ['POST', '/api/v1/jobs/:id/cancel'],
];

/** The routes as `METHOD /path` keys, which is how a caller compares one. */
export function canonicalRouteKey(method: string, path: string): string {
  return `${method} ${path}`;
}

/** Every canonical route as a `METHOD /path` key, in declaration order. */
export function canonicalRouteKeys(): string[] {
  return CANONICAL_API_ROUTES.map(([method, path]) => canonicalRouteKey(method, path));
}
