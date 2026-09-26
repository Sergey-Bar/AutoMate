import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleExecutionStore } from '../execution/drizzle-execution-store.js';
import { classifyDatabaseError, withClassifiedErrors } from './db-errors.js';
import { DomainError, ErrorCode } from './domain-error.js';
import { createErrorBoundary } from './boundary.js';

const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/drizzle',
);

/**
 * Applies the real migration graph, in journal order, to a PGlite instance.
 *
 * The same reader the integration suite uses, duplicated rather than imported
 * because `tests/integration` is not a dependency of `apps/api` and a test-only
 * cross-package dependency would be worse than twelve lines of parsing.
 */
function readMigrations(): string {
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  return journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) => {
      const file = path.join(drizzleDirectory, `${entry.tag}.sql`);
      const sql = readFileSync(file, 'utf8');
      return sql
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .join(';\n');
    })
    .join(';\n');
}

/** Fails when the built schema is older than its source. */
function assertBuildIsFresh(): void {
  const packageRoot = path.resolve(drizzleDirectory, '..');
  const buildOutput = path.join(packageRoot, 'dist', 'index.js');
  const buildTime = statSync(buildOutput).mtimeMs;
  const stack = [path.join(packageRoot, 'src')];
  const stale: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.ts') && statSync(full).mtimeMs > buildTime) stale.push(full);
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `packages/db is not built: ${stale.length} source file(s) are newer than dist/. ` +
        'Run pnpm --filter @automate/db build.',
    );
  }
}

let client: PGlite;
let app: Hono;

beforeAll(async () => {
  assertBuildIsFresh();
  client = new PGlite();
  await client.exec(readMigrations());
  const db = drizzle(client, { schema });

  // Wired exactly as `index.ts` wires it: the store inside the classified proxy.
  const executionStore = withClassifiedErrors(
    new DrizzleExecutionStore({ db, workspaceId: 'ws-1' }),
  ) as unknown as {
    createRun(input: Record<string, unknown>): Promise<{ id: string }>;
  };

  const logged: Array<{ message: string; context: Record<string, unknown> }> = [];
  const boundary = createErrorBoundary({
    // Collected, not printed: these tests provoke rejections on purpose, and a
    // boundary that logs correctly should not spray the suite's output.
    log: (message, context) => logged.push({ message, context }),
    requestId: () => 'req-error-classification',
  });
  app = new Hono();
  app.onError(boundary.onError);
  app.notFound(boundary.notFound);

  // A route that inserts straight into a table whose CHECK the migration adds,
  // which is the shortest path from "the database refuses" to "the caller sees
  // a classified status". It parses its timestamps, as a real route does: a
  // JSON body cannot carry a `Date`, so a route that skipped this would fail
  // with a type error before it ever reached the database.
  const TIMESTAMP_FIELDS = ['quarantinedAt', 'resolvedAt'] as const;
  app.post('/api/v1/quarantine', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const values: Record<string, unknown> = { ...body };
    for (const field of TIMESTAMP_FIELDS) {
      const value = values[field];
      if (typeof value === 'string') values[field] = new Date(value);
    }
    const result = await db.insert(schema.quarantine).values(values as never);
    return c.json({ inserted: result.rowCount }, 201);
  });

  app.post('/api/v1/runs', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const run = await executionStore.createRun(body);
    return c.json(run, 202);
  });
});

afterAll(async () => {
  await client.close();
});

describe('a database constraint reaches the caller as a classified 4xx', () => {
  it('answers a CHECK violation with 422 and a stable code', async () => {
    const response = await app.request('/api/v1/quarantine', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'q-check-1',
        testTitle: 'flaky login',
        testFile: 'tests/login.spec.ts',
        quarantinedAt: new Date('2026-01-01T00:00:00.000Z'),
        // Violates quarantine_ttf_resolution_check: a time-to-fix with no
        // resolution. This reached the caller as a bare 500 before.
        ttfMs: 60_000,
      }),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error: { code: string; message: string; requestId: string; details: unknown };
    };
    expect(body.error.code).toBe(ErrorCode.CHECK_CONSTRAINT_VIOLATED);
    expect(body.error.requestId).toBe('req-error-classification');
    // The constraint name is a log detail, not a response detail.
    expect(JSON.stringify(body)).not.toContain('quarantine_ttf_resolution_check');
  });

  it('answers a not-null violation with 400 naming the missing field', async () => {
    const response = await app.request('/api/v1/quarantine', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'q-null-1', quarantinedAt: new Date().toISOString() }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe(ErrorCode.MISSING_REQUIRED_FIELD);
  });

  it('accepts the same row once the resolution is present', async () => {
    const response = await app.request('/api/v1/quarantine', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'q-ok-1',
        testTitle: 'flaky login resolved',
        testFile: 'tests/login.spec.ts',
        quarantinedAt: new Date('2026-01-01T00:00:00.000Z'),
        resolvedAt: new Date('2026-01-01T01:00:00.000Z'),
        ttfMs: 60_000,
      }),
    });
    expect(response.status).toBe(201);
  });

  it('gives a non-HTTP caller a typed error it can branch on', async () => {
    // The worker's lease reaper is not an HTTP route, so it depends on the store
    // returning a real type rather than a raw `pg` error.
    const raw = drizzle(client, { schema });
    let captured: unknown;
    try {
      await raw.insert(schema.quarantine).values({
        id: 'q-typed-1',
        testTitle: 'x',
        testFile: 'y',
        quarantinedAt: new Date('2026-01-01T00:00:00.000Z'),
        ttfMs: 1,
      } as never);
    } catch (error) {
      captured = error;
    }
    const classified = classifyDatabaseError(captured);
    expect(classified).toBeInstanceOf(DomainError);
    expect(classified.code).toBe(ErrorCode.CHECK_CONSTRAINT_VIOLATED);
    expect(classified.status).toBe(422);
    // The original is preserved for the log.
    expect(classified.cause).toBe(captured);
  });
});
