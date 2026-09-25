import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TABLES,
  FORBIDDEN_KEYWORDS,
  MAX_ROWS,
  addLimitClause,
  buildNLPrompt,
  buildSchemaDescription,
  validateSQL,
} from '../nl-query.js';

describe('nl-query pure exports (full)', () => {
  describe('validateSQL', () => {
    it('rejects empty string', () => {
      const result = validateSQL('');
      expect(result).toEqual({ valid: false, reason: 'Empty SQL query' });
    });

    it('accepts SELECT query', () => {
      expect(validateSQL('SELECT id, status FROM runs LIMIT 10')).toEqual({ valid: true });
    });

    it('accepts CTE WITH query', () => {
      expect(
        validateSQL(`WITH recent AS (SELECT id FROM runs LIMIT 3) SELECT id FROM runs LIMIT 3`),
      ).toEqual({ valid: true });
    });

    it('rejects INSERT (case-insensitive)', () => {
      expect(validateSQL(`INSERT INTO runs (id) VALUES ('x')`).valid).toBe(false);
      expect(validateSQL(`insert into runs (id) values ('x')`).valid).toBe(false);
      expect(validateSQL(`Insert into runs (id) values ('x')`).valid).toBe(false);
    });

    it('rejects UPDATE', () => {
      const res = validateSQL(`UPDATE runs SET status = 'failed'`);
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/Forbidden keyword/i);
    });

    it('rejects DELETE', () => {
      expect(validateSQL('DELETE FROM tests').valid).toBe(false);
    });

    it('rejects DROP TABLE', () => {
      expect(validateSQL('DROP TABLE runs').valid).toBe(false);
    });

    it('rejects ALTER TABLE', () => {
      expect(validateSQL('ALTER TABLE tests ADD COLUMN bad TEXT').valid).toBe(false);
    });

    it('rejects multiple statements separated by semicolon', () => {
      const res = validateSQL('SELECT * FROM runs; SELECT * FROM tests');
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('Multiple statements are forbidden');
    });

    it('rejects unknown table', () => {
      const res = validateSQL('SELECT * FROM super_secret LIMIT 5');
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('Table "super_secret" is not allowed');
    });

    it('accepts all allowed tables in FROM clauses', () => {
      for (const table of ALLOWED_TABLES) {
        const res = validateSQL(`SELECT * FROM ${table} LIMIT 1`);
        expect(res, `table ${table} should be allowed`).toEqual({ valid: true });
      }
    });

    it('accepts SELECT with JOIN on allowed tables', () => {
      const res = validateSQL(
        'SELECT t.title, r.status FROM tests t JOIN runs r ON t.run_id = r.id LIMIT 20',
      );
      expect(res).toEqual({ valid: true });
    });

    it('accepts SELECT with subquery from allowed table', () => {
      const res = validateSQL(
        'SELECT id FROM runs WHERE id IN (SELECT run_id FROM tests WHERE status = "failed") LIMIT 25',
      );
      expect(res).toEqual({ valid: true });
    });
  });

  describe('addLimitClause', () => {
    it('adds LIMIT 1000 when query has no limit', () => {
      expect(addLimitClause('SELECT * FROM runs')).toBe('SELECT * FROM runs LIMIT 1000');
    });

    it('keeps existing LIMIT when <= 1000', () => {
      expect(addLimitClause('SELECT * FROM runs LIMIT 10')).toBe('SELECT * FROM runs LIMIT 10');
    });

    it('caps existing LIMIT when > 1000', () => {
      expect(addLimitClause('SELECT * FROM runs LIMIT 5000')).toBe('SELECT * FROM runs LIMIT 1000');
    });

    it('strips trailing semicolons before adding limit', () => {
      expect(addLimitClause('SELECT * FROM tests;')).toBe('SELECT * FROM tests LIMIT 1000');
    });

    it('handles LIMIT keyword in different cases', () => {
      expect(addLimitClause('SELECT * FROM runs LIMIT 2000')).toBe('SELECT * FROM runs LIMIT 1000');
      expect(addLimitClause('SELECT * FROM runs limit 10')).toBe('SELECT * FROM runs limit 10');
      expect(addLimitClause('SELECT * FROM runs Limit 100')).toBe('SELECT * FROM runs Limit 100');
    });
  });

  describe('buildSchemaDescription', () => {
    it('contains all allowed table names', () => {
      const schema = buildSchemaDescription();
      for (const table of ALLOWED_TABLES) {
        expect(schema).toContain(`TABLE ${table}:`);
      }
    });

    it('contains representative column definitions', () => {
      const schema = buildSchemaDescription();
      expect(schema).toContain('id TEXT PK');
      expect(schema).toContain('run_id TEXT FK→runs.id');
      expect(schema).toContain('avg_duration_ms REAL');
    });

    it('includes type and note information', () => {
      const schema = buildSchemaDescription();
      expect(schema).toContain('-- ISO timestamp');
      expect(schema).toContain('-- JSON array');
      expect(schema).toContain('-- 12-char hex error hash');
    });
  });

  describe('buildNLPrompt', () => {
    it('includes user query', () => {
      const prompt = buildNLPrompt('show me the most flaky tests this week');
      expect(prompt).toContain('User question: show me the most flaky tests this week');
    });

    it('includes schema description text', () => {
      const prompt = buildNLPrompt('anything');
      expect(prompt).toContain('Database schema (PostgreSQL):');
      expect(prompt).toContain('TABLE runs:');
      expect(prompt).toContain('TABLE tests:');
    });

    it('includes SELECT-only safety rule', () => {
      const prompt = buildNLPrompt('list failed runs');
      expect(prompt).toContain('Generate ONLY a single SELECT statement');
      expect(prompt).toContain('Do NOT use INSERT, UPDATE, DELETE, DROP, ALTER, CREATE');
    });

    it('includes MAX_ROWS value in rules', () => {
      const prompt = buildNLPrompt('list failures');
      expect(prompt).toContain(`max ${MAX_ROWS} rows`);
    });
  });

  describe('constants', () => {
    it('ALLOWED_TABLES contains expected tables', () => {
      expect(ALLOWED_TABLES).toEqual(
        expect.arrayContaining([
          'runs',
          'tests',
          'results',
          'suites',
          'trends',
          'quarantine',
          'known_failures',
          'schedules',
          'workspaces',
          'quality_gate_config',
          'defect_categories',
          'fingerprint_categories',
        ]),
      );
    });

    it('FORBIDDEN_KEYWORDS matches dangerous SQL keywords', () => {
      for (const keyword of [
        'INSERT',
        'UPDATE',
        'DELETE',
        'DROP',
        'ALTER',
        'CREATE',
        'TRUNCATE',
        'GRANT',
        'REVOKE',
        'ATTACH',
        'DETACH',
        'PRAGMA',
        'VACUUM',
        'REINDEX',
      ]) {
        expect(FORBIDDEN_KEYWORDS.test(keyword)).toBe(true);
      }
      expect(FORBIDDEN_KEYWORDS.test('SELECT')).toBe(false);
    });

    it('MAX_ROWS equals 1000', () => {
      expect(MAX_ROWS).toBe(1000);
    });
  });
});
