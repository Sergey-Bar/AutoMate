import { Hono } from 'hono';

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

health.get('/api/v1/features', (c) => {
  return c.json({
    features: {} as Record<string, boolean>,
    version: '1',
  });
});

export { health as healthRoutes };
