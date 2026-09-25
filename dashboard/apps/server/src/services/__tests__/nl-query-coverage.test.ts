import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn<(filePath: string, encoding: string) => Promise<string>>(),
}));

vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
}));

const tempDbFiles: string[] = [];

function createTempDashboardDb(): string {
  const dbPath = path.join(os.tmpdir(), `nl-query-${randomUUID()}.db`);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      status TEXT
    );
    INSERT INTO runs (id, status) VALUES
      ('run-1', 'passed'),
      ('run-2', 'failed');
  `);
  db.close();
  tempDbFiles.push(dbPath);
  return dbPath;
}

async function loadModule() {
  vi.resetModules();
  return import('../nl-query.js');
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete process.env.DATABASE_URL;
  for (const dbPath of tempDbFiles.splice(0, tempDbFiles.length)) {
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch {
        // readonlyDb singleton can keep a file handle open during the test process
      }
    }
  }
});

describe('nl-query coverage paths', () => {
  it('returns rejected when AI config is missing', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    const { nlToSQL } = await loadModule();

    const result = await nlToSQL('show failing tests');

    expect(result.rejected).toBe(true);
    expect(result.error).toContain('AI not configured');
    expect(result.resultCount).toBe(0);
  });

  it('returns AI request failure when fetch throws', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        provider: 'openai',
        apiKey: 'token',
        model: 'gpt-test',
        endpoint: 'https://api.example.com/chat',
      }),
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const { nlToSQL } = await loadModule();
    const result = await nlToSQL('show flaky tests');

    expect(result.rejected).toBe(true);
    expect(result.error).toContain('AI request failed: network down');
  });

  it('returns rejected when AI returns empty SQL', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        provider: 'openai',
        apiKey: 'token',
        model: 'gpt-test',
        endpoint: 'https://api.example.com/chat',
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '' } }] }),
      }),
    );

    const { nlToSQL } = await loadModule();
    const result = await nlToSQL('list runs');

    expect(result.rejected).toBe(true);
    expect(result.error).toBe('AI returned empty response');
  });

  it('rejects SQL that fails validator after AI generation', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        provider: 'openai',
        apiKey: 'token',
        model: 'gpt-test',
        endpoint: 'https://api.example.com/chat',
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'DELETE FROM runs' } }] }),
      }),
    );

    const { nlToSQL } = await loadModule();
    const result = await nlToSQL('delete all runs');

    expect(result.rejected).toBe(true);
    expect(result.sql).toBe('DELETE FROM runs');
    expect(result.error).toContain('Generated SQL rejected');
  });

  it('executes generated SELECT SQL against readonly database', async () => {
    process.env.DATABASE_URL = createTempDashboardDb();
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        provider: 'openai',
        apiKey: 'token',
        model: 'gpt-test',
        endpoint: 'https://api.example.com/chat',
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'SELECT id, status FROM runs' } }] }),
      }),
    );

    const { nlToSQL } = await loadModule();
    const result = await nlToSQL('show all runs');

    expect(result.rejected).toBeUndefined();
    expect(result.sql).toBe('SELECT id, status FROM runs LIMIT 1000');
    expect(result.resultCount).toBe(2);
    expect(result.results).toEqual([
      { id: 'run-1', status: 'passed' },
      { id: 'run-2', status: 'failed' },
    ]);
  });

  it('returns SQL execution error when query is syntactically valid but fails', async () => {
    process.env.DATABASE_URL = createTempDashboardDb();
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        provider: 'openai',
        apiKey: 'token',
        model: 'gpt-test',
        endpoint: 'https://api.example.com/chat',
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'SELECT missing_column FROM runs' } }] }),
      }),
    );

    const { nlToSQL } = await loadModule();
    const result = await nlToSQL('show missing column');

    expect(result.rejected).toBe(true);
    expect(result.error).toContain('SQL execution error');
    expect(result.sql).toContain('LIMIT 1000');
  });

  it('handles anthropic response format and strips markdown fences', async () => {
    process.env.DATABASE_URL = createTempDashboardDb();
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        provider: 'anthropic',
        apiKey: 'anthropic-token',
        model: 'claude-test',
        endpoint: 'https://api.anthropic.example/messages',
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ text: '```sql\nSELECT id FROM runs LIMIT 1\n```' }] }),
      }),
    );

    const { nlToSQL } = await loadModule();
    const result = await nlToSQL('first run id');

    expect(result.resultCount).toBe(1);
    expect(result.sql).toBe('SELECT id FROM runs LIMIT 1');
    expect(result.results).toEqual([{ id: 'run-1' }]);
  });

  it('returns API error when AI endpoint responds non-ok', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        provider: 'openai',
        apiKey: 'token',
        model: 'gpt-test',
        endpoint: 'https://api.example.com/chat',
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      }),
    );

    const { nlToSQL } = await loadModule();
    const result = await nlToSQL('list runs');

    expect(result.rejected).toBe(true);
    expect(result.error).toContain('AI request failed: AI API error: 401 Unauthorized');
  });
});
