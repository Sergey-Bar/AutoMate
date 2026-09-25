import { Hono } from 'hono';

const a11y = new Hono();

a11y.get('/api/v1/a11y/audit', (c) => {
  return c.json({
    violations: [],
    pagesScanned: 0,
    scannedAt: new Date().toISOString(),
  });
});

export { a11y as a11yRoutes };
