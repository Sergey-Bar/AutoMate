import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';
import * as schema from '../../db/schema.js';

const { mockNlToSQL } = vi.hoisted(() => ({
  mockNlToSQL: vi.fn<(query: string) => Promise<{
    sql: string;
    results: unknown[];
    resultCount: number;
    rejected?: boolean;
    error?: string;
  }>>(),
}));

let testApp: TestApp;

vi.mock('../../db/client.js', () => ({
  get db() { return testApp.db; },
  get sqlite() { return testApp.sqlite; },
  get poolConnection() { return testApp.poolConnection; },
  isPostgres: false,
}));

vi.mock('../../services/nl-query.js', () => ({
  nlToSQL: mockNlToSQL,
}));

import { nlQueryRoutes, parseHistoryLimit, sanitizeNLQuery } from '../nl-query.js';

describe('nl-query routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    await nlQueryRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM nl_query_history;');
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  describe('sanitizeNLQuery', () => {
    it('trims surrounding whitespace', () => {
      expect(sanitizeNLQuery('  show me tests  ')).toBe('show me tests');
    });

    it('returns empty string for blank values', () => {
      expect(sanitizeNLQuery('')).toBe('');
      expect(sanitizeNLQuery('   ')).toBe('');
    });

    it('truncates overly long queries to 500 chars', () => {
      const long = 'a'.repeat(600);
      expect(sanitizeNLQuery(long).length).toBe(500);
    });

    it('strips html tags from input', () => {
      expect(sanitizeNLQuery('<script>alert("xss")</script>show tests')).toBe('alert("xss")show tests');
    });
  });

  describe('parseHistoryLimit', () => {
    it('defaults to 20 when undefined', () => {
      expect(parseHistoryLimit(undefined)).toBe(20);
    });

    it('parses valid positive values', () => {
      expect(parseHistoryLimit('10')).toBe(10);
    });

    it('caps at 100', () => {
      expect(parseHistoryLimit('999')).toBe(100);
    });

    it('falls back to 20 for non-numeric values', () => {
      expect(parseHistoryLimit('abc')).toBe(20);
    });

    it('falls back to 20 for negative values', () => {
      expect(parseHistoryLimit('-5')).toBe(20);
    });
  });

  describe('POST /api/nl-query', () => {
    it('returns results for a valid query and calls nlToSQL', async () => {
      mockNlToSQL.mockResolvedValueOnce({
        sql: 'SELECT id FROM runs LIMIT 10',
        results: [{ id: 'run-1' }],
        resultCount: 1,
      });

      const response = await testApp.app.inject({
        method: 'POST',
        url: '/api/nl-query',
        payload: { query: 'show latest run' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        query: 'show latest run',
        sql: 'SELECT id FROM runs LIMIT 10',
        results: [{ id: 'run-1' }],
        resultCount: 1,
      });
      expect(mockNlToSQL).toHaveBeenCalledTimes(1);
      expect(mockNlToSQL).toHaveBeenCalledWith('show latest run', expect.anything());
    });

    it('returns 400 for whitespace-only query', async () => {
      const response = await testApp.app.inject({
        method: 'POST',
        url: '/api/nl-query',
        payload: { query: '    ' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Query cannot be empty' });
      expect(mockNlToSQL).not.toHaveBeenCalled();
    });

    it('sanitizes html tags before sending query to nlToSQL', async () => {
      mockNlToSQL.mockResolvedValueOnce({
        sql: 'SELECT status FROM runs LIMIT 5',
        results: [],
        resultCount: 0,
      });

      const response = await testApp.app.inject({
        method: 'POST',
        url: '/api/nl-query',
        payload: { query: '<b>show failed runs</b>' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockNlToSQL).toHaveBeenCalledWith('show failed runs', expect.anything());
      expect(response.json()).toEqual({
        query: 'show failed runs',
        sql: 'SELECT status FROM runs LIMIT 5',
        results: [],
        resultCount: 0,
      });
    });

    it('returns 422 when nlToSQL rejects query', async () => {
      mockNlToSQL.mockResolvedValueOnce({
        sql: '',
        results: [],
        resultCount: 0,
        rejected: true,
        error: 'Generated SQL rejected: forbidden operation',
      });

      const response = await testApp.app.inject({
        method: 'POST',
        url: '/api/nl-query',
        payload: { query: 'drop all tables' },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({
        error: 'Generated SQL rejected: forbidden operation',
      });
    });

    it('logs successful sql queries to nl_query_history table', async () => {
      mockNlToSQL.mockResolvedValueOnce({
        sql: 'SELECT id, status FROM runs LIMIT 3',
        results: [{ id: 'run-1', status: 'passed' }],
        resultCount: 1,
      });

      const response = await testApp.app.inject({
        method: 'POST',
        url: '/api/nl-query',
        payload: { query: 'show passing runs', userId: 'user-body' },
      });

      expect(response.statusCode).toBe(200);

      const rows = testApp.db.select().from(schema.nlQueryHistory).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userQuery: 'show passing runs',
        generatedSql: 'SELECT id, status FROM runs LIMIT 3',
        resultCount: 1,
        userId: 'user-body',
      });
      expect(typeof rows[0].createdAt).toBe('string');
    });

    it('keeps responding when history logging fails', async () => {
      mockNlToSQL.mockResolvedValueOnce({
        sql: 'SELECT id FROM runs LIMIT 1',
        results: [{ id: 'run-1' }],
        resultCount: 1,
      });
      const insertSpy = vi.spyOn(testApp.db, 'insert').mockImplementationOnce(() => {
        throw new Error('insert failed');
      });

      const response = await testApp.app.inject({
        method: 'POST',
        url: '/api/nl-query',
        payload: { query: 'show one run' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        query: 'show one run',
        sql: 'SELECT id FROM runs LIMIT 1',
        results: [{ id: 'run-1' }],
        resultCount: 1,
      });

      const rows = testApp.db.select().from(schema.nlQueryHistory).all();
      expect(rows).toEqual([]);
      insertSpy.mockRestore();
    });

    it('prefers userId from body over x-user header', async () => {
      mockNlToSQL.mockResolvedValueOnce({
        sql: 'SELECT id FROM runs LIMIT 1',
        results: [],
        resultCount: 0,
      });

      const response = await testApp.app.inject({
        method: 'POST',
        url: '/api/nl-query',
        headers: { 'x-user': 'header-user' },
        payload: { query: 'show one run', userId: 'body-user' },
      });

      expect(response.statusCode).toBe(200);

      const rows = testApp.db.select().from(schema.nlQueryHistory).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe('body-user');
    });

    it('uses x-user header when body userId is missing', async () => {
      mockNlToSQL.mockResolvedValueOnce({
        sql: 'SELECT id FROM runs LIMIT 1',
        results: [],
        resultCount: 0,
      });

      const response = await testApp.app.inject({
        method: 'POST',
        url: '/api/nl-query',
        headers: { 'x-user': 'header-user' },
        payload: { query: 'show one run' },
      });

      expect(response.statusCode).toBe(200);

      const rows = testApp.db.select().from(schema.nlQueryHistory).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe('header-user');
    });
  });

  describe('GET /api/nl-query/history', () => {
    it('returns recent queries ordered by createdAt desc', async () => {
      testApp.db.insert(schema.nlQueryHistory).values([
        {
          userQuery: 'oldest',
          generatedSql: 'SELECT 1',
          resultCount: 1,
          userId: 'u1',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          userQuery: 'middle',
          generatedSql: 'SELECT 2',
          resultCount: 2,
          userId: 'u2',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
        {
          userQuery: 'newest',
          generatedSql: 'SELECT 3',
          resultCount: 3,
          userId: 'u3',
          createdAt: '2026-01-03T00:00:00.000Z',
        },
      ]).run();

      const response = await testApp.app.inject({
        method: 'GET',
        url: '/api/nl-query/history',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Array<{ userQuery: string }>;
      expect(body.map((row) => row.userQuery)).toEqual(['newest', 'middle', 'oldest']);
    });

    it('respects limit query parameter', async () => {
      testApp.db.insert(schema.nlQueryHistory).values([
        {
          userQuery: 'first',
          generatedSql: 'SELECT 1',
          resultCount: 1,
          userId: 'u1',
          createdAt: '2026-02-01T00:00:00.000Z',
        },
        {
          userQuery: 'second',
          generatedSql: 'SELECT 2',
          resultCount: 2,
          userId: 'u2',
          createdAt: '2026-02-02T00:00:00.000Z',
        },
        {
          userQuery: 'third',
          generatedSql: 'SELECT 3',
          resultCount: 3,
          userId: 'u3',
          createdAt: '2026-02-03T00:00:00.000Z',
        },
      ]).run();

      const response = await testApp.app.inject({
        method: 'GET',
        url: '/api/nl-query/history?limit=2',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Array<{ userQuery: string }>;
      expect(body.map((row) => row.userQuery)).toEqual(['third', 'second']);
      expect(body).toHaveLength(2);
    });

    it('uses default limit of 20 when no limit is provided', async () => {
      const rows = Array.from({ length: 25 }, (_, i) => ({
        userQuery: `query-${i + 1}`,
        generatedSql: `SELECT ${i + 1}`,
        resultCount: i + 1,
        userId: `user-${i + 1}`,
        createdAt: `2026-03-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      }));
      testApp.db.insert(schema.nlQueryHistory).values(rows).run();

      const response = await testApp.app.inject({
        method: 'GET',
        url: '/api/nl-query/history',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Array<{ userQuery: string }>;
      expect(body).toHaveLength(20);
      expect(body[0].userQuery).toBe('query-25');
      expect(body[19].userQuery).toBe('query-6');
    });
  });
});
