import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { safePath } from '../utils/safe-path.js';
import { assertExternalUrl } from '../utils/url-validation.js';
import {
  ALLOWED_TABLES,
  FORBIDDEN_KEYWORDS,
  MAX_ROWS,
  addLimitClause,
  validateSQL,
} from '../services/nl-query.js';
import { parseHistoryLimit, sanitizeNLQuery } from '../routes/nl-query.js';
import { createTestApp, type TestApp } from '../test/create-test-app.js';
import { codegenRoutes } from '../routes/codegen.js';
import { artifactsRoutes } from '../routes/artifacts.js';

describe('security: safePath path traversal protection', () => {
  const base = path.resolve(path.sep, 'tmp', 'automate-security-base');

  it('blocks ../ traversal sequences', () => {
    expect(() => safePath(base, '../secrets.txt')).toThrowError('Path traversal blocked');
  });

  it('blocks ..\\ Windows-style traversal sequences', () => {
    expect(() => safePath(base, '..\\secrets.txt')).toThrowError('Path traversal blocked');
  });

  it('blocks absolute paths outside the base directory', () => {
    const outside = path.resolve(base, '..', '..', 'outside', 'secret.txt');
    expect(() => safePath(base, outside)).toThrowError('Path traversal blocked');
  });

  it('handles null bytes without escaping the base', () => {
    const resolved = safePath(base, 'valid\0segment.txt');
    expect(resolved).toBe(path.resolve(base, 'valid\0segment.txt'));
  });

  it('blocks URL-encoded traversal once decoded (%2e%2e%2f)', () => {
    const decoded = decodeURIComponent('%2e%2e%2fsecret.txt');
    expect(() => safePath(base, decoded)).toThrowError('Path traversal blocked');
  });

  it('allows valid relative paths that stay under base', () => {
    expect(safePath(base, 'reports/run-1/output.json')).toBe(
      path.resolve(base, 'reports', 'run-1', 'output.json'),
    );
  });

  it('returns base directory for empty path', () => {
    expect(safePath(base, '')).toBe(path.resolve(base));
  });

  it('returns base directory for dot path', () => {
    expect(safePath(base, '.')).toBe(path.resolve(base));
  });
});

describe('security: assertExternalUrl SSRF prevention', () => {
  it('blocks localhost hostname', () => {
    expect(() => assertExternalUrl('http://localhost:4000')).toThrowError('Localhost URLs are not allowed');
  });

  it('blocks loopback IPv4 127.0.0.1', () => {
    expect(() => assertExternalUrl('http://127.0.0.1')).toThrowError(
      'Private/internal IP addresses are not allowed',
    );
  });

  it('blocks loopback IPv6 ::1', () => {
    expect(() => assertExternalUrl('http://[::1]')).toThrowError('Localhost URLs are not allowed');
  });

  it('blocks private 10.x.x.x range', () => {
    expect(() => assertExternalUrl('http://10.1.2.3')).toThrowError('Private/internal IP addresses are not allowed');
  });

  it('blocks private 172.16-31.x.x range', () => {
    expect(() => assertExternalUrl('http://172.31.255.10')).toThrowError(
      'Private/internal IP addresses are not allowed',
    );
  });

  it('blocks private 192.168.x.x range', () => {
    expect(() => assertExternalUrl('http://192.168.10.12')).toThrowError(
      'Private/internal IP addresses are not allowed',
    );
  });

  it('blocks link-local 169.254.x.x range', () => {
    expect(() => assertExternalUrl('http://169.254.1.1')).toThrowError('Private/internal IP addresses are not allowed');
  });

  it('blocks 0.0.0.0', () => {
    expect(() => assertExternalUrl('http://0.0.0.0')).toThrowError('Private/internal IP addresses are not allowed');
  });

  it('blocks non-http protocols', () => {
    expect(() => assertExternalUrl('ftp://example.com/file')).toThrowError('Only http and https URLs are allowed');
    expect(() => assertExternalUrl('file:///etc/passwd')).toThrowError('Only http and https URLs are allowed');
    expect(() => assertExternalUrl('javascript:alert(1)')).toThrowError('Only http and https URLs are allowed');
  });

  it('accepts valid external https URL', () => {
    const parsed = assertExternalUrl('https://example.com/path?q=1');
    expect(parsed.hostname).toBe('example.com');
    expect(parsed.protocol).toBe('https:');
  });

  it('rejects malformed URLs', () => {
    expect(() => assertExternalUrl('not a valid url')).toThrowError('Invalid URL');
  });
});

describe('security: SQL query sandboxing', () => {
  it('rejects DML/DDL keywords (INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/TRUNCATE)', () => {
    const blocked = [
      'INSERT INTO runs(id) VALUES (\'x\')',
      'UPDATE runs SET status = \'failed\'',
      'DELETE FROM runs',
      'DROP TABLE runs',
      'ALTER TABLE runs ADD COLUMN leaked TEXT',
      'CREATE TABLE pwned(id INTEGER)',
      'TRUNCATE runs',
    ];

    for (const sql of blocked) {
      const result = validateSQL(sql);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Forbidden keyword detected');
    }
  });

  it('rejects multiple statements via semicolons', () => {
    const result = validateSQL('SELECT id FROM runs; SELECT id FROM tests');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Multiple statements are forbidden');
  });

  it('requires queries to start with SELECT or WITH', () => {
    // Use a non-forbidden keyword that doesn't start with SELECT/WITH
    const result = validateSQL('EXPLAIN SELECT * FROM runs');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Query must start with SELECT');
  });

  it('enforces table whitelist for FROM/JOIN clauses', () => {
    const result = validateSQL('SELECT * FROM sqlite_master LIMIT 1');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Access to system table "sqlite_master" is forbidden');
  });

  it('adds LIMIT when missing', () => {
    expect(addLimitClause('SELECT * FROM runs')).toBe(`SELECT * FROM runs LIMIT ${MAX_ROWS}`);
  });

  it('caps LIMIT to MAX_ROWS when too high', () => {
    expect(addLimitClause('SELECT * FROM runs LIMIT 5000')).toBe(`SELECT * FROM runs LIMIT ${MAX_ROWS}`);
  });

  it('keeps existing LIMIT when already below MAX_ROWS', () => {
    expect(addLimitClause('SELECT * FROM runs LIMIT 20')).toBe('SELECT * FROM runs LIMIT 20');
  });

  it('accepts valid SELECT query against allowed table', () => {
    const result = validateSQL('SELECT id, status FROM runs LIMIT 10');
    expect(result).toEqual({ valid: true });
  });

  it('accepts WITH/CTE query whose alias is not in allowed tables (alias is skipped)', () => {
    // CTE aliases are now correctly recognised and excluded from table validation
    const result = validateSQL('WITH recent AS (SELECT id FROM runs) SELECT * FROM recent LIMIT 10');
    expect(result.valid).toBe(true);
  });

  it('exports expected SQL guard constants', () => {
    expect(ALLOWED_TABLES.length).toBeGreaterThan(0);
    expect(ALLOWED_TABLES).toContain('runs');
    expect(FORBIDDEN_KEYWORDS.test('DROP TABLE runs')).toBe(true);
    expect(MAX_ROWS).toBe(1000);
  });
});

describe('security: nl-query input sanitization', () => {
  it('strips HTML tags from natural-language input', () => {
    expect(sanitizeNLQuery('<script>alert(1)</script>show failed tests')).toBe('alert(1)show failed tests');
  });

  it('truncates input to 500 chars', () => {
    const long = 'x'.repeat(600);
    expect(sanitizeNLQuery(long)).toHaveLength(500);
  });

  it('returns empty string for empty or whitespace-only input', () => {
    expect(sanitizeNLQuery('')).toBe('');
    expect(sanitizeNLQuery('   \n\t  ')).toBe('');
  });

  it('parseHistoryLimit returns 20 for invalid or missing values', () => {
    expect(parseHistoryLimit(undefined)).toBe(20);
    expect(parseHistoryLimit('abc')).toBe(20);
    expect(parseHistoryLimit('0')).toBe(20);
    expect(parseHistoryLimit('-4')).toBe(20);
  });

  it('parseHistoryLimit caps values at 100', () => {
    expect(parseHistoryLimit('9999')).toBe(100);
    expect(parseHistoryLimit('100')).toBe(100);
  });
});

describe('security: codegen routes', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
    await codegenRoutes(testApp.app);
    await testApp.app.ready();
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('/api/codegen/save rejects traversal paths via safePath', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/save',
      payload: {
        content: 'console.log("hello")',
        filePath: '../escape/outside.ts',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid file path' });
  });

  it('/api/codegen/save rejects invalid parameters with 400', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/save',
      payload: { content: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'content and filePath are required' });
  });

  it('/api/codegen/start rejects bad input via zod validation', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/start',
      payload: {
        url: 'not-a-url',
        browser: 'invalid-browser',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; details?: unknown };
    expect(body.error).toBe('Invalid parameters');
    expect(body.details).toBeDefined();
  });
});

describe('security: artifacts routes', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
    await artifactsRoutes(testApp.app);
    await testApp.app.ready();
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('blocks path traversal attempts with 403', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/artifacts/..%5Csecret.txt',
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Forbidden' });
  });

  it('returns 404 for non-existent artifacts', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/artifacts/does-not-exist-artifact.zip',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Artifact not found' });
  });
});
