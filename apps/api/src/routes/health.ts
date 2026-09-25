import { Hono, type Context } from 'hono';
import { sql } from 'drizzle-orm';
import { createDbClient } from '@automate/db';

export interface HealthRouteOptions {
  databaseUrl?: string;
  checkDatabase?: () => Promise<void>;
}

export function createHealthRoutes(options: HealthRouteOptions = {}): Hono {
  const health = new Hono();

  health.get('/health', (c) => {
    return c.json({
      status: 'healthy',
      service: 'automate-api',
      timestamp: new Date().toISOString(),
    });
  });

  health.get('/api/v1/health', (c) => {
    return c.json({
      status: 'healthy',
      version: '1',
      service: 'automate-api',
      timestamp: new Date().toISOString(),
    });
  });

  const readiness = async (c: Context): Promise<Response> => {
    const databaseUrl = options.databaseUrl ?? process.env['DATABASE_URL'];
    if (!databaseUrl)
      return c.json({ status: 'not_ready', reason: 'DATABASE_URL is not configured' }, 503);
    try {
      if (options.checkDatabase) await options.checkDatabase();
      else await createDbClient(databaseUrl).execute(sql`SELECT 1`);
      return c.json({ status: 'ready', service: 'automate-api' });
    } catch {
      return c.json({ status: 'not_ready', reason: 'database is unavailable' }, 503);
    }
  };

  health.get('/api/v1/ready', readiness);
  health.get('/ready', readiness);

  health.get('/api/v1/features', (c) => {
    return c.json({
      features: {} as Record<string, boolean>,
      version: '1',
    });
  });

  return health;
}

export const healthRoutes = createHealthRoutes();
