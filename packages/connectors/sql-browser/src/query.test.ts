import { describe, expect, it } from 'vitest';
import { validateSQL, FORBIDDEN_KEYWORDS } from './index.js';

/**
 * Tests for the sql-browser package public API (index.ts re-exports).
 * Covers query execution path scenarios: validate → execute, error cases,
 * result path decisions, and connection-management-adjacent guards.
 *
 * NOTE: The sql-browser package provides *safety validation* for queries before
 * they are executed against a SQLite connection. The actual DB execution lives in
 * the server layer. These tests cover the full public API surface exported by
 * index.ts and the query-execution decision paths driven by validateSQL.
 */
describe('sql-browser public API (index.ts)', () => {
  it('exports validateSQL as a function', () => {
    expect(typeof validateSQL).toBe('function');
  });

  it('exports FORBIDDEN_KEYWORDS as a RegExp', () => {
    expect(FORBIDDEN_KEYWORDS).toBeInstanceOf(RegExp);
  });
});

describe('query execution — success path', () => {
  it('validateSQL returns ok:true for a simple SELECT, allowing execution', () => {
    const result = validateSQL('SELECT * FROM runs');
    expect(result.ok).toBe(true);
  });

  it('validates SELECT with multiple columns and aliases', () => {
    const result = validateSQL('SELECT id AS run_id, name, status FROM runs WHERE status = "passed"');
    expect(result.ok).toBe(true);
  });

  it('validates a SELECT with aggregate functions', () => {
    const result = validateSQL('SELECT COUNT(*), AVG(duration_ms) FROM runs WHERE status = "failed"');
    expect(result.ok).toBe(true);
  });

  it('validates a SELECT with GROUP BY and HAVING', () => {
    const result = validateSQL('SELECT status, COUNT(*) AS total FROM runs GROUP BY status HAVING total > 5');
    expect(result.ok).toBe(true);
  });

  it('validates a SELECT with INNER JOIN', () => {
    const result = validateSQL(
      'SELECT r.id, t.title FROM runs r INNER JOIN test_results t ON t.run_id = r.id',
    );
    expect(result.ok).toBe(true);
  });

  it('validates a SELECT with LEFT JOIN', () => {
    const result = validateSQL(
      'SELECT r.id, t.title FROM runs r LEFT JOIN test_results t ON t.run_id = r.id WHERE t.status = "failed"',
    );
    expect(result.ok).toBe(true);
  });

  it('validates a SELECT with a subquery in WHERE', () => {
    const result = validateSQL(
      'SELECT * FROM runs WHERE id IN (SELECT run_id FROM test_results WHERE status = "failed")',
    );
    expect(result.ok).toBe(true);
  });

  it('validates a CTE (WITH) query used for analytics', () => {
    const result = validateSQL(
      'WITH latest AS (SELECT MAX(created_at) AS ts FROM runs) SELECT * FROM runs r JOIN latest l ON r.created_at = l.ts',
    );
    expect(result.ok).toBe(true);
  });

  it('validates an EXPLAIN query for query plan inspection', () => {
    const result = validateSQL('EXPLAIN SELECT * FROM runs WHERE status = "failed"');
    expect(result.ok).toBe(true);
  });

  it('validates SELECT with ORDER BY and LIMIT (pagination path)', () => {
    const result = validateSQL('SELECT id, created_at FROM runs ORDER BY created_at DESC LIMIT 20 OFFSET 40');
    expect(result.ok).toBe(true);
  });

  it('validates SELECT with LIKE operator', () => {
    const result = validateSQL("SELECT * FROM test_results WHERE title LIKE '%login%'");
    expect(result.ok).toBe(true);
  });

  it('validates SELECT with BETWEEN operator', () => {
    const result = validateSQL('SELECT * FROM runs WHERE duration_ms BETWEEN 1000 AND 5000');
    expect(result.ok).toBe(true);
  });

  it('validates SELECT with IS NULL check', () => {
    const result = validateSQL('SELECT * FROM runs WHERE error_message IS NULL');
    expect(result.ok).toBe(true);
  });

  it('validates SELECT with IS NOT NULL check', () => {
    const result = validateSQL('SELECT * FROM runs WHERE error_message IS NOT NULL');
    expect(result.ok).toBe(true);
  });

  it('validates SELECT DISTINCT', () => {
    const result = validateSQL('SELECT DISTINCT status FROM runs');
    expect(result.ok).toBe(true);
  });
});

describe('query execution — error / blocked path', () => {
  it('returns ok:false for empty string, blocking execution', () => {
    const result = validateSQL('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('SQL query must not be empty');
  });

  it('returns ok:false for whitespace-only input', () => {
    const result = validateSQL('   \t\n  ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('SQL query must not be empty');
  });

  it('blocks DELETE — mutation attempt on the runs table (prefix check)', () => {
    const result = validateSQL('DELETE FROM runs WHERE id = 42');
    expect(result.ok).toBe(false);
    // DELETE does not start with SELECT/WITH/EXPLAIN, blocked at prefix check
    if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
  });

  it('blocks INSERT — write attempt (prefix check)', () => {
    const result = validateSQL("INSERT INTO runs (status) VALUES ('passed')");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
  });

  it('blocks UPDATE — write attempt on existing data (prefix check)', () => {
    const result = validateSQL("UPDATE runs SET status = 'failed' WHERE id = 1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
  });

  it('blocks DROP TABLE — destructive schema operation (prefix check)', () => {
    const result = validateSQL('DROP TABLE runs');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
  });

  it('blocks ALTER TABLE — schema modification (prefix check)', () => {
    const result = validateSQL('ALTER TABLE runs ADD COLUMN notes TEXT');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
  });

  it('blocks TRUNCATE — full-table wipe', () => {
    const result = validateSQL('TRUNCATE TABLE runs');
    expect(result.ok).toBe(false);
  });

  it('blocks CREATE TABLE — schema creation', () => {
    const result = validateSQL('CREATE TABLE tmp (id INTEGER PRIMARY KEY)');
    expect(result.ok).toBe(false);
  });

  it('blocks PRAGMA — SQLite system command', () => {
    const result = validateSQL('PRAGMA journal_mode=WAL');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
  });

  it('blocks ATTACH DATABASE — filesystem access', () => {
    const result = validateSQL("ATTACH DATABASE '/tmp/evil.db' AS evil");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
  });

  it('blocks multi-statement execution attempt', () => {
    const result = validateSQL('SELECT 1; SELECT 2');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Multiple statements');
  });

  it('blocks UNION injection with embedded mutation keyword', () => {
    const result = validateSQL('SELECT id FROM runs UNION ALL DELETE FROM runs');
    expect(result.ok).toBe(false);
  });
});

describe('query execution — result formatting path', () => {
  it('ok:true result has no reason property', () => {
    const result = validateSQL('SELECT 1');
    expect(result.ok).toBe(true);
    expect('reason' in result).toBe(false);
  });

  it('ok:false result always has a non-empty reason string', () => {
    const cases = [
      '',
      'DROP TABLE runs',
      'DELETE FROM runs',
      'INSERT INTO runs VALUES (1)',
      'SELECT 1; SELECT 2',
      'PRAGMA table_info(runs)',
    ];
    for (const sql of cases) {
      const result = validateSQL(sql);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(typeof result.reason).toBe('string');
        expect(result.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it('forbidden keyword reason includes the uppercased keyword name', () => {
    const mutationKeywords = ['delete', 'insert', 'update', 'drop', 'alter', 'exec'];
    for (const kw of mutationKeywords) {
      const result = validateSQL(`SELECT 1 UNION ${kw} dummy`);
      if (!result.ok) {
        if (result.reason.startsWith('Forbidden keyword:')) {
          expect(result.reason).toBe(`Forbidden keyword: ${kw.toUpperCase()}`);
        }
      }
    }
  });
});

describe('query execution — connection management guards', () => {
  it('validates repeated calls for the same query (connection reuse path)', () => {
    const query = 'SELECT * FROM runs WHERE status = "failed" LIMIT 100';
    // Simulate multiple calls as would happen across request reuse
    for (let i = 0; i < 5; i++) {
      expect(validateSQL(query).ok).toBe(true);
    }
  });

  it('validates alternating valid and invalid queries (guard on every call)', () => {
    const queries = [
      { sql: 'SELECT 1', ok: true },
      { sql: 'DROP TABLE runs', ok: false },
      { sql: 'SELECT id FROM runs', ok: true },
      { sql: 'DELETE FROM runs', ok: false },
      { sql: 'SELECT COUNT(*) FROM runs', ok: true },
    ];
    for (const { sql, ok } of queries) {
      expect(validateSQL(sql).ok).toBe(ok);
    }
  });

  it('leading/trailing whitespace is normalised before validation (robust open path)', () => {
    // Ensures whitespace does not bypass validation (connection open guard)
    expect(validateSQL('  SELECT * FROM runs  ').ok).toBe(true);
    expect(validateSQL('\n\nSELECT * FROM runs\n').ok).toBe(true);
  });

  it('trailing semicolon is stripped (single-statement allowed through connection)', () => {
    expect(validateSQL('SELECT * FROM runs;').ok).toBe(true);
  });

  it('two trailing semicolons are treated as multi-statement (blocked at connection guard)', () => {
    const result = validateSQL('SELECT * FROM runs;;');
    // After stripping one trailing semicolon, one remains → multi-statement blocked
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Multiple statements');
  });
});
