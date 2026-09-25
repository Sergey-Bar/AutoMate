/**
 * NL→SQL translation service tests
 *
 * Tests pure functions: schema building, SQL validation, prompt construction.
 * LLM calls are mocked.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSchemaDescription,
  validateSQL,
  addLimitClause,
  buildNLPrompt,
  ALLOWED_TABLES,
  FORBIDDEN_KEYWORDS,
  FORBIDDEN_FUNCTIONS,
  SYSTEM_TABLES,
  MAX_ROWS,
  stripSQLComments,
  extractTableNames,
} from '../nl-query.js';

// ── Schema description ───────────────────────────────────────────────────────

describe('buildSchemaDescription', () => {
  it('should include all allowed table names', () => {
    const desc = buildSchemaDescription();
    for (const table of ALLOWED_TABLES) {
      expect(desc).toContain(table);
    }
  });

  it('should describe column names and types', () => {
    const desc = buildSchemaDescription();
    // runs table must have key columns
    expect(desc).toContain('id');
    expect(desc).toContain('status');
    expect(desc).toContain('started_at');
  });
});

// ── SQL validation ───────────────────────────────────────────────────────────

describe('validateSQL', () => {
  it('should accept a valid SELECT query', () => {
    const result = validateSQL('SELECT id, status FROM runs WHERE status = \'failed\' LIMIT 50');
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should reject INSERT statements', () => {
    const result = validateSQL('INSERT INTO runs (id) VALUES (\'test\')');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/forbidden/i);
  });

  it('should reject UPDATE statements', () => {
    const result = validateSQL('UPDATE runs SET status = \'passed\'');
    expect(result.valid).toBe(false);
  });

  it('should reject DELETE statements', () => {
    const result = validateSQL('DELETE FROM runs WHERE id = \'abc\'');
    expect(result.valid).toBe(false);
  });

  it('should reject DROP TABLE statements', () => {
    const result = validateSQL('DROP TABLE runs');
    expect(result.valid).toBe(false);
  });

  it('should reject ALTER TABLE statements', () => {
    const result = validateSQL('ALTER TABLE runs ADD COLUMN foo TEXT');
    expect(result.valid).toBe(false);
  });

  it('should reject CREATE TABLE statements', () => {
    const result = validateSQL('CREATE TABLE evil (id INTEGER)');
    expect(result.valid).toBe(false);
  });

  it('should reject TRUNCATE', () => {
    const result = validateSQL('TRUNCATE runs');
    expect(result.valid).toBe(false);
  });

  it('should reject queries referencing disallowed tables', () => {
    const result = validateSQL('SELECT * FROM secret_passwords LIMIT 50');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/table/i);
  });

  it('should accept queries with JOINs across allowed tables', () => {
    const result = validateSQL('SELECT t.title, r.status FROM tests t JOIN runs r ON t.run_id = r.id LIMIT 50');
    expect(result.valid).toBe(true);
  });

  it('should reject empty or blank SQL', () => {
    const result = validateSQL('');
    expect(result.valid).toBe(false);
    const result2 = validateSQL('   ');
    expect(result2.valid).toBe(false);
  });

  it('should be case-insensitive for forbidden keywords', () => {
    const result = validateSQL('dElEtE FROM runs');
    expect(result.valid).toBe(false);
  });

  it('should reject SQL with multiple statements (semicolons)', () => {
    const result = validateSQL('SELECT 1; DROP TABLE runs');
    expect(result.valid).toBe(false);
  });
});

// ── LIMIT clause ─────────────────────────────────────────────────────────────

describe('addLimitClause', () => {
  it('should add LIMIT when missing', () => {
    const sql = addLimitClause('SELECT * FROM runs');
    expect(sql).toMatch(/LIMIT\s+1000/i);
  });

  it('should not add LIMIT when already present', () => {
    const sql = addLimitClause('SELECT * FROM runs LIMIT 10');
    expect(sql).toContain('LIMIT 10');
    // Should not have double LIMIT
    expect((sql.match(/LIMIT/gi) ?? []).length).toBe(1);
  });

  it('should cap LIMIT above MAX_ROWS', () => {
    const sql = addLimitClause('SELECT * FROM runs LIMIT 5000');
    expect(sql).toContain(`LIMIT ${MAX_ROWS}`);
  });

  it('should handle LIMIT with offset', () => {
    const sql = addLimitClause('SELECT * FROM runs LIMIT 10 OFFSET 20');
    // Should keep it under MAX_ROWS
    expect(sql).toMatch(/LIMIT\s+10/i);
  });
});

// ── Prompt construction ──────────────────────────────────────────────────────

describe('buildNLPrompt', () => {
  it('should include the user query', () => {
    const prompt = buildNLPrompt('show me flaky tests');
    expect(prompt).toContain('show me flaky tests');
  });

  it('should include schema description', () => {
    const prompt = buildNLPrompt('show me failed runs');
    expect(prompt).toContain('runs');
    expect(prompt).toContain('tests');
  });

  it('should instruct SELECT only', () => {
    const prompt = buildNLPrompt('anything');
    expect(prompt).toMatch(/SELECT/i);
    expect(prompt).toMatch(/read-only|readonly|read only/i);
  });

  it('should mention LIMIT requirement', () => {
    const prompt = buildNLPrompt('anything');
    expect(prompt).toMatch(/LIMIT/i);
  });
});

// ── stripSQLComments ─────────────────────────────────────────────────────────

describe('stripSQLComments', () => {
  it('should remove single-line comments (--)', () => {
    const result = stripSQLComments('SELECT * FROM runs -- this is a comment');
    expect(result).toBe('SELECT * FROM runs');
  });

  it('should remove block comments (/* */)', () => {
    const result = stripSQLComments('SELECT * /* sneaky */ FROM runs');
    expect(result).toBe('SELECT * FROM runs');
  });

  it('should remove multi-line block comments', () => {
    const result = stripSQLComments('SELECT *\n/* this\nspans\nmultiple lines */\nFROM runs');
    expect(result).toBe('SELECT * FROM runs');
  });

  it('should handle multiple comments in one query', () => {
    const result = stripSQLComments('SELECT id -- col\nFROM runs /* table */ WHERE status = \'failed\'');
    expect(result).toBe("SELECT id FROM runs WHERE status = 'failed'");
  });

  it('should return original query when no comments present', () => {
    const result = stripSQLComments('SELECT id FROM runs LIMIT 10');
    expect(result).toBe('SELECT id FROM runs LIMIT 10');
  });

  it('should collapse extra whitespace after stripping', () => {
    const result = stripSQLComments('SELECT  *   FROM   runs');
    expect(result).toBe('SELECT * FROM runs');
  });
});

// ── extractTableNames ────────────────────────────────────────────────────────

describe('extractTableNames', () => {
  it('should extract a single table from FROM clause', () => {
    const tables = extractTableNames('SELECT * FROM runs LIMIT 10');
    expect(tables).toEqual(['runs']);
  });

  it('should extract table from JOIN clause', () => {
    const tables = extractTableNames('SELECT * FROM runs JOIN tests ON tests.run_id = runs.id');
    expect(tables).toContain('runs');
    expect(tables).toContain('tests');
  });

  it('should extract comma-separated tables from FROM clause', () => {
    const tables = extractTableNames('SELECT * FROM runs, tests, results LIMIT 10');
    expect(tables).toContain('runs');
    expect(tables).toContain('tests');
    expect(tables).toContain('results');
  });

  it('should handle table aliases', () => {
    const tables = extractTableNames('SELECT r.id FROM runs r JOIN tests t ON t.run_id = r.id');
    expect(tables).toContain('runs');
    expect(tables).toContain('tests');
  });

  it('should handle AS keyword aliases', () => {
    const tables = extractTableNames('SELECT * FROM runs AS r, tests AS t LIMIT 10');
    expect(tables).toContain('runs');
    expect(tables).toContain('tests');
    expect(tables).not.toContain('r');
    expect(tables).not.toContain('t');
  });

  it('should deduplicate table names', () => {
    const tables = extractTableNames('SELECT * FROM runs JOIN runs ON 1=1');
    expect(tables.filter(t => t === 'runs')).toHaveLength(1);
  });

  it('should return empty array for query without FROM/JOIN', () => {
    const tables = extractTableNames('SELECT 1');
    expect(tables).toEqual([]);
  });
});

// ── Security: forbidden functions ────────────────────────────────────────────

describe('validateSQL — forbidden functions', () => {
  it('should reject load_extension() calls', () => {
    const result = validateSQL("SELECT load_extension('evil.so') FROM runs LIMIT 1");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/forbidden function/i);
  });

  it('should reject writefile() calls', () => {
    const result = validateSQL("SELECT writefile('/tmp/pwn', data) FROM runs LIMIT 1");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/forbidden function/i);
  });

  it('should reject readfile() calls', () => {
    const result = validateSQL("SELECT readfile('/etc/passwd') FROM runs LIMIT 1");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/forbidden function/i);
  });

  it('should reject fts3_tokenizer() calls', () => {
    const result = validateSQL("SELECT fts3_tokenizer('simple') FROM runs LIMIT 1");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/forbidden function/i);
  });

  it('should reject zipfile() calls', () => {
    const result = validateSQL("SELECT zipfile(name, data) FROM runs LIMIT 1");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/forbidden function/i);
  });

  it('should reject forbidden functions case-insensitively', () => {
    const result = validateSQL("SELECT LOAD_EXTENSION('evil.so') FROM runs LIMIT 1");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/forbidden function/i);
  });

  it('should allow safe functions like COUNT, AVG, etc.', () => {
    const result = validateSQL('SELECT COUNT(*), AVG(duration_ms) FROM runs LIMIT 10');
    expect(result.valid).toBe(true);
  });
});

// ── Security: comment bypass prevention ──────────────────────────────────────

describe('validateSQL — comment bypass prevention', () => {
  it('should reject forbidden keywords hidden in line comments when used with real DML', () => {
    // The comment stripping reveals: SELECT * FROM runs ; DROP TABLE runs
    const result = validateSQL('SELECT * FROM runs; --\nDROP TABLE runs');
    expect(result.valid).toBe(false);
  });

  it('should reject forbidden keywords after comment stripping reveals multi-statement', () => {
    const result = validateSQL('SELECT * FROM runs /* innocent */; DELETE FROM tests');
    expect(result.valid).toBe(false);
  });

  it('should still allow valid queries with harmless comments', () => {
    const result = validateSQL('SELECT id FROM runs /* just a note */ LIMIT 10');
    expect(result.valid).toBe(true);
  });
});

// ── Security: comma-separated table bypass ───────────────────────────────────

describe('validateSQL — comma-separated table bypass', () => {
  it('should reject queries with disallowed comma-separated tables', () => {
    const result = validateSQL('SELECT * FROM runs, secret_table LIMIT 50');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('secret_table');
    expect(result.reason).toMatch(/not allowed/i);
  });

  it('should accept queries with multiple allowed comma-separated tables', () => {
    const result = validateSQL('SELECT * FROM runs, tests, results LIMIT 50');
    expect(result.valid).toBe(true);
  });

  it('should reject when one of several comma-separated tables is disallowed', () => {
    const result = validateSQL('SELECT * FROM runs, tests, evil_table LIMIT 50');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('evil_table');
  });
});

// ── Security: REPLACE keyword ────────────────────────────────────────────────

describe('validateSQL — REPLACE keyword', () => {
  it('should reject REPLACE INTO statements', () => {
    const result = validateSQL("REPLACE INTO runs (id) VALUES ('test')");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/forbidden keyword/i);
  });
});

// ── Constants ────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('ALLOWED_TABLES should include core tables', () => {
    expect(ALLOWED_TABLES).toContain('runs');
    expect(ALLOWED_TABLES).toContain('tests');
    expect(ALLOWED_TABLES).toContain('results');
    expect(ALLOWED_TABLES).toContain('suites');
    expect(ALLOWED_TABLES).toContain('trends');
  });

  it('FORBIDDEN_KEYWORDS should match DML/DDL', () => {
    expect(FORBIDDEN_KEYWORDS.test('INSERT')).toBe(true);
    expect(FORBIDDEN_KEYWORDS.test('UPDATE')).toBe(true);
    expect(FORBIDDEN_KEYWORDS.test('DELETE')).toBe(true);
    expect(FORBIDDEN_KEYWORDS.test('DROP')).toBe(true);
    expect(FORBIDDEN_KEYWORDS.test('REPLACE')).toBe(true);
    expect(FORBIDDEN_KEYWORDS.test('SELECT')).toBe(false);
  });

  it('FORBIDDEN_FUNCTIONS should match dangerous SQLite functions', () => {
    expect(FORBIDDEN_FUNCTIONS.test('load_extension(')).toBe(true);
    expect(FORBIDDEN_FUNCTIONS.test('writefile(')).toBe(true);
    expect(FORBIDDEN_FUNCTIONS.test('readfile(')).toBe(true);
    expect(FORBIDDEN_FUNCTIONS.test('fts3_tokenizer(')).toBe(true);
    expect(FORBIDDEN_FUNCTIONS.test('zipfile(')).toBe(true);
    expect(FORBIDDEN_FUNCTIONS.test('count(')).toBe(false);
    expect(FORBIDDEN_FUNCTIONS.test('avg(')).toBe(false);
  });

  it('MAX_ROWS should be 1000', () => {
    expect(MAX_ROWS).toBe(1000);
  });

  it('SYSTEM_TABLES should match sqlite_ prefixed tables', () => {
    expect(SYSTEM_TABLES.test('sqlite_master')).toBe(true);
    expect(SYSTEM_TABLES.test('sqlite_stat1')).toBe(true);
    expect(SYSTEM_TABLES.test('sqlite_sequence')).toBe(true);
    expect(SYSTEM_TABLES.test('runs')).toBe(false);
  });
});

// ── Security: SQL injection prevention ───────────────────────────────────────

describe('validateSQL — SQL injection prevention', () => {
  it('should block SELECT from sqlite_master (system table)', () => {
    const result = validateSQL('SELECT * FROM sqlite_master LIMIT 100');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/system table.*sqlite_master|sqlite_master.*forbidden/i);
  });

  it('should block SELECT from sqlite_stat1 (system table)', () => {
    const result = validateSQL('SELECT * FROM sqlite_stat1 LIMIT 10');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/system table|not allowed/i);
  });

  it('should block SELECT from sqlite_sequence (system table)', () => {
    const result = validateSQL('SELECT * FROM sqlite_sequence LIMIT 10');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/system table|not allowed/i);
  });

  it('should block DROP TABLE runs (not SELECT)', () => {
    const result = validateSQL('DROP TABLE runs');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/forbidden keyword/i);
  });

  it('should block INSERT INTO runs (not SELECT)', () => {
    const result = validateSQL("INSERT INTO runs (status) VALUES ('passed')");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/forbidden keyword/i);
  });

  it('should block DELETE FROM runs (not SELECT)', () => {
    const result = validateSQL('DELETE FROM runs');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/forbidden keyword/i);
  });

  it('should allow SELECT * FROM runs (valid allowed table)', () => {
    const result = validateSQL('SELECT * FROM runs');
    expect(result.valid).toBe(true);
  });

  it('should allow SELECT id, status FROM runs LIMIT 50', () => {
    const result = validateSQL('SELECT id, status FROM runs LIMIT 50');
    expect(result.valid).toBe(true);
  });

  it('should allow SELECT from all schema tables', () => {
    for (const table of ALLOWED_TABLES) {
      const result = validateSQL(`SELECT * FROM ${table} LIMIT 10`);
      expect(result.valid).toBe(true);
    }
  });

  it('should block PRAGMA statements', () => {
    const result = validateSQL('PRAGMA table_info(runs)');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/forbidden keyword/i);
  });

  it('should block ATTACH DATABASE', () => {
    const result = validateSQL("ATTACH DATABASE '/tmp/evil.db' AS evil");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/forbidden keyword/i);
  });

  it('should block sqlite_master in JOIN', () => {
    const result = validateSQL('SELECT r.* FROM runs r JOIN sqlite_master sm ON 1=1 LIMIT 10');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/system table.*sqlite_master|sqlite_master.*forbidden/i);
  });
});

// ── Security: row limit enforcement ──────────────────────────────────────────

describe('addLimitClause — row limit enforcement', () => {
  it('should auto-limit SELECT * FROM runs to 1000 rows', () => {
    const sql = addLimitClause('SELECT * FROM runs');
    expect(sql).toBe('SELECT * FROM runs LIMIT 1000');
  });

  it('should preserve LIMIT 50 (under 1000)', () => {
    const sql = addLimitClause('SELECT id, status FROM runs LIMIT 50');
    expect(sql).toBe('SELECT id, status FROM runs LIMIT 50');
  });

  it('should cap LIMIT 2000 down to 1000', () => {
    const sql = addLimitClause('SELECT * FROM runs LIMIT 2000');
    expect(sql).toBe('SELECT * FROM runs LIMIT 1000');
  });

  it('should cap LIMIT 9999 down to 1000', () => {
    const sql = addLimitClause('SELECT * FROM runs LIMIT 9999');
    expect(sql).toBe('SELECT * FROM runs LIMIT 1000');
  });

  it('should strip trailing semicolons before adding LIMIT', () => {
    const sql = addLimitClause('SELECT * FROM runs;');
    expect(sql).toBe('SELECT * FROM runs LIMIT 1000');
  });
});

// ── Security: adversarial LLM outputs ────────────────────────────────────────

describe('validateSQL — adversarial LLM outputs', () => {
  it('should reject double-quoted system table: SELECT * FROM "sqlite_master"', () => {
    const result = validateSQL('SELECT * FROM "sqlite_master" LIMIT 10');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/system table|forbidden/i);
  });

  it('should reject double-quoted disallowed table: SELECT * FROM "secret_passwords"', () => {
    const result = validateSQL('SELECT * FROM "secret_passwords" LIMIT 10');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not allowed/i);
  });

  it('should reject backtick-quoted disallowed table: SELECT * FROM `secret_passwords`', () => {
    const result = validateSQL('SELECT * FROM `secret_passwords` LIMIT 10');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not allowed/i);
  });

  it('should reject bracket-quoted system table: SELECT * FROM [sqlite_master]', () => {
    const result = validateSQL('SELECT * FROM [sqlite_master] LIMIT 10');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/system table|forbidden/i);
  });

  it('should reject schema-qualified system table: SELECT * FROM main.sqlite_master', () => {
    const result = validateSQL('SELECT * FROM main.sqlite_master LIMIT 10');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/system table|forbidden/i);
  });

  it('should reject CTE that queries disallowed table: WITH cte AS (SELECT * FROM secret_passwords) SELECT * FROM cte', () => {
    const result = validateSQL(
      'WITH cte AS (SELECT * FROM secret_passwords) SELECT * FROM cte LIMIT 10',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not allowed/i);
  });

  it('should reject UNION with disallowed table: SELECT id FROM runs UNION SELECT name FROM secret_passwords', () => {
    const result = validateSQL(
      'SELECT id FROM runs UNION SELECT name FROM secret_passwords LIMIT 10',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not allowed/i);
  });

  it('should reject subquery referencing disallowed table: SELECT * FROM runs WHERE id IN (SELECT id FROM secret_passwords)', () => {
    const result = validateSQL(
      'SELECT * FROM runs WHERE id IN (SELECT id FROM secret_passwords) LIMIT 10',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not allowed/i);
  });

  it('should accept mixed-case quoted allowed table: SELECT * FROM "Runs" (case-insensitive match)', () => {
    const result = validateSQL('SELECT * FROM "Runs" LIMIT 10');
    expect(result.valid).toBe(true);
  });
});
