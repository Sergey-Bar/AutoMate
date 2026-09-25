import type { FastifyInstance } from 'fastify';
import { requireFeature } from '../services/feature-flags.js';

export interface HealthUnifiedOptions {
  dashboardUrl: string;
}

export async function healthUnifiedRoutes(app: FastifyInstance, options: HealthUnifiedOptions): Promise<void> {
  app.get('/api/health/unified', {
    preHandler: requireFeature('unified-health'),
    config: { rateLimit: false },
  }, async () => {
    const automateHealthPromise = (async () => {
      let ollamaStatus = 'unknown';
      try {
        const res = await fetch(
          `${process.env.OLLAMA_HOST ?? 'http://localhost:11434'}/api/tags`,
          { signal: AbortSignal.timeout(3000) },
        );
        ollamaStatus = res.ok ? 'connected' : 'error';
      } catch {
        ollamaStatus = 'disconnected';
      }

      return {
        status: 'ok' as const,
        db: 'connected',
        ollama: ollamaStatus,
      };
    })();

    const dashboardHealthPromise = (async () => {
      try {
        const res = await fetch(`${options.dashboardUrl}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          return await res.json() as { status: string; db?: string; reporter?: string };
        }
        return { status: 'error' };
      } catch {
        return { status: 'unreachable' };
      }
    })();

    const [automateHealth, dashboardHealth] = await Promise.all([
      automateHealthPromise,
      dashboardHealthPromise,
    ]);

    const automateOk = automateHealth.status === 'ok';
    const dashboardOk = dashboardHealth.status === 'ok';

    let unified: 'healthy' | 'degraded' | 'unhealthy';
    if (automateOk && dashboardOk) {
      unified = 'healthy';
    } else if (automateOk || dashboardOk) {
      unified = 'degraded';
    } else {
      unified = 'unhealthy';
    }

    return {
      automate: automateHealth,
      dashboard: dashboardHealth,
      unified,
    };
  });
}
