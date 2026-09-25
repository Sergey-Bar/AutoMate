/**
 * badges.ts — Embeddable SVG badge endpoints
 *
 * GET /api/badges/pass-rate.svg — pass rate percentage badge
 * GET /api/badges/status.svg    — last run status badge
 * GET /api/badges/flaky.svg     — flaky test count badge
 */
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { runs, tests } from '../db/schema.js';
import { desc, eq, sql } from 'drizzle-orm';
import { escXml } from '../utils/esc-xml.js';

function badge(label: string, value: string, color: string): string {
  const labelWidth = escXml(label).length * 6.5 + 12;
  const valueWidth = escXml(value).length * 6.5 + 12;
  const totalWidth = labelWidth + valueWidth;

  const safeLabel = escXml(label);
  const safeValue = escXml(value);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${safeLabel}: ${safeValue}">
  <title>${safeLabel}: ${safeValue}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${safeLabel}</text>
    <text x="${labelWidth / 2}" y="14">${safeLabel}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${safeValue}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${safeValue}</text>
  </g>
</svg>`;
}

function pickColor(passRate: number): string {
  if (passRate >= 95) return '#4c1';
  if (passRate >= 80) return '#a3c51c';
  if (passRate >= 60) return '#dfb317';
  return '#e05d44';
}

function statusColor(status: string): string {
  switch (status) {
    case 'passed': return '#4c1';
    case 'failed': return '#e05d44';
    case 'running': return '#2196f3';
    default: return '#9f9f9f';
  }
}

export async function badgeRoutes(app: FastifyInstance) {
  // GET /api/badges/pass-rate.svg
  app.get('/api/badges/pass-rate.svg', async (_req, reply) => {
    const [latest] = await db
      .select({ total: runs.total, passed: runs.passed })
      .from(runs)
      .where(eq(runs.status, 'passed'))
      .orderBy(desc(runs.startedAt))
      .limit(1);

    // Fall back to most recent run of any status if no passed run
    const run = latest ?? (await db
      .select({ total: runs.total, passed: runs.passed })
      .from(runs)
      .orderBy(desc(runs.startedAt))
      .limit(1)
    )[0];

    if (!run || run.total === 0) {
      reply.type('image/svg+xml').header('Cache-Control', 'no-cache, no-store');
      return badge('pass rate', 'N/A', '#9f9f9f');
    }

    const rate = (run.passed / run.total) * 100;
    reply.type('image/svg+xml').header('Cache-Control', 'max-age=60');
    return badge('pass rate', `${rate.toFixed(1)}%`, pickColor(rate));
  });

  // GET /api/badges/status.svg
  app.get('/api/badges/status.svg', async (_req, reply) => {
    const [latest] = await db
      .select({ status: runs.status })
      .from(runs)
      .orderBy(desc(runs.startedAt))
      .limit(1);

    const status = latest?.status ?? 'unknown';
    reply.type('image/svg+xml').header('Cache-Control', 'max-age=60');
    return badge('tests', status, statusColor(status));
  });

  // GET /api/badges/flaky.svg
  app.get('/api/badges/flaky.svg', async (_req, reply) => {
    const [latest] = await db
      .select({ id: runs.id })
      .from(runs)
      .orderBy(desc(runs.startedAt))
      .limit(1);

    if (!latest) {
      reply.type('image/svg+xml').header('Cache-Control', 'no-cache, no-store');
      return badge('flaky', '0', '#4c1');
    }


    const flakyInRun = await db
      .select({ count: sql<number>`count(*)` })
      .from(tests)
      .where(sql`${tests.runId} = ${latest.id} AND ${tests.status} = 'flaky'`);

    const count = flakyInRun[0]?.count ?? 0;
    const color = count === 0 ? '#4c1' : count <= 3 ? '#dfb317' : '#e05d44';
    reply.type('image/svg+xml').header('Cache-Control', 'max-age=60');
    return badge('flaky', String(count), color);
  });
}
