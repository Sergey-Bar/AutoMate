/**
 * apps/server/src/routes/nl-query.ts — Natural Language Query API
 *
 * Routes:
 *   POST /api/nl-query          — Translate NL → SQL and execute
 *   GET  /api/nl-query/history  — Retrieve query history
 */
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { nlQueryHistory } from '../db/schema.js';
import { nlToSQL } from '../services/nl-query.js';
import type { NLQueryLogger } from '../services/nl-query.js';
import { requireFeature } from '../services/feature-flags.js';
import { desc } from 'drizzle-orm';

// ── Helpers (exported for testing) ───────────────────────────────────────────

/** Sanitize user input: trim, truncate, strip HTML */
export function sanitizeNLQuery(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Strip HTML tags
  const noHtml = trimmed.replace(/<[^>]*>/g, '');
  // Truncate to 500 chars
  return noHtml.slice(0, 500);
}

/** Parse history limit param with sane defaults */
export function parseHistoryLimit(val: string | undefined): number {
  if (!val) return 20;
  const n = parseInt(val, 10);
  if (isNaN(n) || n <= 0) return 20;
  return Math.min(n, 100);
}

// ── Route plugin ─────────────────────────────────────────────────────────────

export async function nlQueryRoutes(app: FastifyInstance) {
  // POST /api/nl-query — Translate and execute NL query
  app.post<{ Body: { query: string; userId?: string } }>(
    '/api/nl-query',
    {
      preHandler: requireFeature('nl-query'),
      schema: {
        body: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', minLength: 1, maxLength: 500 },
            userId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const raw = request.body.query;
      const userId = request.body.userId ?? request.headers['x-user'] as string ?? null;

      const query = sanitizeNLQuery(raw);
      if (!query) {
        return reply.status(400).send({ error: 'Query cannot be empty' });
      }

      const result = await nlToSQL(query, app.log as unknown as NLQueryLogger);

      // Log to history (fire-and-forget, don't block response)
      if (result.sql) {
        try {
          await db.insert(nlQueryHistory).values({
            userQuery: query,
            generatedSql: result.sql,
            resultCount: result.resultCount,
            userId,
            createdAt: new Date().toISOString(),
          });
        } catch (err) {
          app.log.warn({ err }, 'Failed to log NL query to history');
        }
      }

      if (result.rejected) {
        return reply.status(422).send({
          error: result.error,
          sql: result.sql || undefined,
        });
      }

      return {
        query,
        sql: result.sql,
        results: result.results,
        resultCount: result.resultCount,
      };
    },
  );

  // GET /api/nl-query/history — Retrieve recent queries
  app.get<{ Querystring: { limit?: string; userId?: string } }>(
    '/api/nl-query/history',
    { preHandler: requireFeature('nl-query') },
    async (request) => {
      const limit = parseHistoryLimit(request.query.limit);

      const rows = await db
        .select()
        .from(nlQueryHistory)
        .orderBy(desc(nlQueryHistory.createdAt))
        .limit(limit);

      return rows;
    },
  );
}
