import { Hono, type Context } from 'hono';
import { sql } from 'drizzle-orm';
import { createDbResources } from '@automate/db';
import { AGENT_DOMAINS, agentAvailability } from './agent-registry.js';
import { PROMETHEUS_CONTENT_TYPE, collect, renderExposition } from '../observability/metrics.js';

export interface HealthRouteOptions {
  databaseUrl?: string;
  /**
   * Probe the shared pool. The composition root injects this so a readiness
   * probe does not construct a fresh `pg.Pool` on every call — doing so leaked
   * a pool per request until the process ran out of sockets.
   */
  checkDatabase?: () => Promise<void>;
  /**
   * The store's own view of which of its dependencies have lapsed.
   *
   * **Ledger O-5b.** Readiness knew exactly two conditions — `DATABASE_URL` unset,
   * and the `SELECT 1` failing — so an instance whose database was perfectly
   * reachable while the realtime bus had stopped sweeping was reported `ready`. The
   * bus's own last error was a function-local variable that only ever reached a
   * `console.error`, and `lastSweepError` appeared nowhere but the ledger row.
   *
   * Injected for the same reason `checkDatabase` is: a readiness probe that opens
   * its own connection to ask "is the connection working" cannot see a dependency
   * that *is* connected and is nonetheless failing. The store knows; the probe has
   * to be told.
   *
   * Optional, and omitting it means "nothing to report" — which is the honest
   * answer for a deployment that has no such store, and keeps every existing
   * caller and test working unchanged.
   */
  degraded?: () => Record<string, string>;
}

/**
 * One builder for the two health bodies, parameterised by the version flag.
 *
 * The bodies differ only by `version: '1'`, and **the difference is deliberate**:
 * `health.test.ts:55-69` asserts `plain['version']` is `undefined` and
 * `versioned['version']` is `'1'`, with a comment saying this is stated so that
 * harmonising them is a decision somebody makes rather than a diff. This factory
 * preserves it: the unversioned path omits the key entirely rather than setting it to
 * `undefined`, because `c.json` drops an `undefined` value and the key order is
 * asserted.
 *
 * The `timestamp` asymmetry is left alone for the same reason
 * (`health.test.ts:217-231`): each handler calls `new Date()` at its own moment.
 *
 * The precedent for one function bound to two paths is the readiness handler below,
 * which `health.test.ts:226-230` holds to byte-identical output.
 */
function healthBody(version?: '1'): Record<string, unknown> {
  return {
    status: 'healthy',
    ...(version === undefined ? {} : { version }),
    service: 'automate-api',
    timestamp: new Date().toISOString(),
  };
}

export function createHealthRoutes(options: HealthRouteOptions = {}): Hono {
  const health = new Hono();

  health.get('/health', (c) => c.json(healthBody()));
  health.get('/api/v1/health', (c) => c.json(healthBody('1')));

  const readiness = async (c: Context): Promise<Response> => {
    const databaseUrl = options.databaseUrl ?? process.env['DATABASE_URL'];
    if (!databaseUrl)
      return c.json({ status: 'not_ready', reason: 'DATABASE_URL is not configured' }, 503);
    try {
      if (options.checkDatabase) await options.checkDatabase();
      else {
        // Standalone use only (tests, scripts). The composition root always
        // injects `checkDatabase` so this path is not taken in a server.
        const resources = createDbResources(databaseUrl);
        try {
          await resources.db.execute(sql`SELECT 1`);
        } finally {
          await resources.close();
        }
      }
      return c.json({ status: 'ready', service: 'automate-api' });
    } catch {
      return c.json({ status: 'not_ready', reason: 'database is unavailable' }, 503);
    }
  };

  /**
   * Readiness, with the store's own dependencies included.
   *
   * Split from the database probe rather than merged into it, because a degraded
   * dependency is a different claim from an unreachable one: a load balancer that
   * cannot tell them apart keeps routing to an instance that is up and not
   * working, which is the failure mode this row exists to end.
   */
  const readinessWithStore = async (c: Context): Promise<Response> => {
    const degraded = options.degraded?.() ?? {};
    if (Object.keys(degraded).length === 0) return readiness(c);
    // `degraded` carries the store's own reason for each dependency, which is
    // derived from the failure and not from the connection string. The database
    // probe still runs afterwards, so a request that is *both* degraded and
    // unreachable reports the unreachable one — the harder fact.
    const unreachable = await readiness(c);
    if (unreachable.status === 503) return unreachable;
    return c.json(
      {
        status: 'not_ready',
        service: 'automate-api',
        reason: 'one or more store dependencies are degraded',
        degraded,
      },
      503,
    );
  };

  health.get('/api/v1/ready', readinessWithStore);
  health.get('/ready', readinessWithStore);

  health.get('/api/v1/features', (c) => {
    // Derived from the agent contracts rather than a literal.
    //
    // This returned `features: {}` from a hard-coded object, which is a hard-coded
    // answer to "what can this build do?" — it reported none of the five agent
    // domains the same process serves on `/api/v1/agents`, so the two endpoints
    // contradicted each other and both were wrong. Deriving it means a domain
    // added to `AgentDomainSchema` is advertised the moment the contract changes.
    //
    // `available` is what a client can act on: no domain has a configured
    // execution adapter, so every entry is `false`. That is the honest answer and it
    // is derived from the same registry the dispatch uses, not typed in twice.
    const features: Record<string, boolean> = {};
    for (const domain of AGENT_DOMAINS) features[`agent.${domain}`] = agentAvailability(domain);
    return c.json({ features, version: '1' });
  });

  /**
   * `/metrics` — the Prometheus text exposition format.
   *
   * Mounted beside health rather than under `/api/v1`, because a scraper is not an API
   * client: it has no workspace, no run, and no session, and putting it on the versioned
   * surface would imply those exist. The content decision — process state and two
   * in-memory counters, no run or tenant data, and no database query — is written down
   * at `apps/api/src/observability/metrics.ts` and in the register row
   * `ops.metrics-endpoint`, which is the authority. A scrape costs a memory read.
   *
   * Unauthenticated on purpose, and the reason that is defensible is the content
   * decision rather than the route: there is nothing here to authenticate for. The first
   * metric that would need a scope of its own goes on its own path with its own gate,
   * which is a decision to make with evidence rather than a policy to pre-empt here.
   */
  // The third argument to `c.body` is a headers *object*. Passing the content-type
  // string itself — which is the shape `res.send` takes — silently leaves Hono's own
  // `text/plain;charset=UTF-8` in place, so the route answers without the version a
  // scraper negotiates on. `health.test.ts` asserts the exact string, because the
  // failure is invisible in a browser.
  health.get('/metrics', (c) =>
    c.body(renderExposition(collect()), 200, { 'content-type': PROMETHEUS_CONTENT_TYPE }),
  );

  return health;
}

export const healthRoutes = createHealthRoutes();
