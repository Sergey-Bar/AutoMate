import { describe, expect, it } from 'vitest';
import { validateSQL, FORBIDDEN_KEYWORDS } from './safety.js';

describe('FORBIDDEN_KEYWORDS', () => {
  it('is a RegExp', () => {
    expect(FORBIDDEN_KEYWORDS).toBeInstanceOf(RegExp);
  });

  it('matches DROP keyword (case-insensitive)', () => {
    expect(FORBIDDEN_KEYWORDS.test('drop')).toBe(true);
    expect(FORBIDDEN_KEYWORDS.test('DROP')).toBe(true);
    expect(FORBIDDEN_KEYWORDS.test('Drop')).toBe(true);
  });

  it('matches EXEC and EXECUTE', () => {
    expect(FORBIDDEN_KEYWORDS.test('EXEC')).toBe(true);
    expect(FORBIDDEN_KEYWORDS.test('EXECUTE')).toBe(true);
  });

  it('matches all mutation keywords', () => {
    const keywords = [
      'DROP', 'DELETE', 'INSERT', 'UPDATE', 'ALTER', 'TRUNCATE', 'CREATE',
      'REPLACE', 'GRANT', 'REVOKE', 'MERGE', 'RENAME', 'ATTACH', 'DETACH',
      'VACUUM', 'REINDEX', 'PRAGMA',
    ];
    for (const kw of keywords) {
      expect(FORBIDDEN_KEYWORDS.test(kw), `Expected ${kw} to be forbidden`).toBe(true);
    }
  });
});

describe('validateSQL', () => {
  it('allows a simple SELECT', () => {
    expect(validateSQL('SELECT * FROM users')).toEqual({ ok: true });
  });

  it('allows SELECT with WHERE', () => {
    expect(validateSQL('SELECT id, name FROM users WHERE id = 1')).toEqual({ ok: true });
  });

  it('allows SELECT with trailing semicolon', () => {
    expect(validateSQL('SELECT 1;')).toEqual({ ok: true });
  });

  it('allows WITH (CTE) queries', () => {
    expect(validateSQL('WITH cte AS (SELECT 1) SELECT * FROM cte')).toEqual({ ok: true });
  });

  it('allows EXPLAIN queries', () => {
    expect(validateSQL('EXPLAIN SELECT * FROM users')).toEqual({ ok: true });
  });

  it('rejects non-SELECT statements even without forbidden keywords', () => {
    const result = validateSQL('.tables');
    expect(result.ok).toBe(false);
  });

  it('rejects multiple statements separated by semicolons', () => {
    const result = validateSQL('SELECT 1; SELECT 2');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Multiple statements');
  });

  it('rejects DROP TABLE', () => {
    const result = validateSQL('DROP TABLE users');
    expect(result.ok).toBe(false);
  });

  it('rejects DELETE', () => {
    const result = validateSQL('DELETE FROM users WHERE id = 1');
    expect(result.ok).toBe(false);
  });

  it('rejects INSERT', () => {
    const result = validateSQL('INSERT INTO users (name) VALUES ("alice")');
    expect(result.ok).toBe(false);
  });

  it('rejects UPDATE', () => {
    const result = validateSQL('UPDATE users SET name = "bob"');
    expect(result.ok).toBe(false);
  });

  it('rejects ALTER TABLE', () => {
    const result = validateSQL('ALTER TABLE users ADD COLUMN age INT');
    expect(result.ok).toBe(false);
  });

  it('rejects TRUNCATE', () => {
    const result = validateSQL('TRUNCATE TABLE users');
    expect(result.ok).toBe(false);
  });

  it('rejects CREATE', () => {
    const result = validateSQL('CREATE TABLE foo (id INT)');
    expect(result.ok).toBe(false);
  });

  it('is case-insensitive', () => {
    const result = validateSQL('drop table users');
    expect(result.ok).toBe(false);
  });

  it('rejects empty input', () => {
    const result = validateSQL('');
    expect(result.ok).toBe(false);
  });

  it('rejects EXEC / EXECUTE', () => {
    const result = validateSQL('EXEC sp_help');
    expect(result.ok).toBe(false);
  });

  // SQL injection prevention tests
  describe('SQL injection prevention', () => {
    it('blocks classic injection: SELECT 1; DROP TABLE users', () => {
      const result = validateSQL('SELECT 1; DROP TABLE users');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('Multiple statements');
    });

    it('blocks injection with trailing: SELECT * FROM t; DELETE FROM t', () => {
      const result = validateSQL('SELECT * FROM t; DELETE FROM t');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('Multiple statements');
    });

    it('blocks UNION-based injection with forbidden keyword: SELECT 1 UNION ALL UPDATE users', () => {
      const result = validateSQL('SELECT 1 UNION ALL UPDATE users SET admin=1');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('Forbidden keyword: UPDATE');
    });

    it('blocks stacked statements: SELECT id; INSERT INTO log VALUES (1)', () => {
      const result = validateSQL('SELECT id; INSERT INTO log VALUES (1)');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('Multiple statements');
    });

    it('blocks PRAGMA (SQLite-specific) injection — blocked at statement prefix check', () => {
      // PRAGMA is not SELECT/WITH/EXPLAIN, so it fails prefix check before keyword check
      const result = validateSQL('PRAGMA table_info(users)');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
    });

    it('blocks ATTACH DATABASE injection — blocked at statement prefix check', () => {
      const result = validateSQL("ATTACH DATABASE '/tmp/evil.db' AS evil");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
    });

    it('blocks DETACH injection — blocked at statement prefix check', () => {
      const result = validateSQL('DETACH DATABASE evil');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
    });

    it('blocks GRANT privilege escalation — blocked at statement prefix check', () => {
      const result = validateSQL('GRANT ALL PRIVILEGES ON users TO attacker');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
    });

    it('blocks REVOKE injection — blocked at statement prefix check', () => {
      const result = validateSQL('REVOKE SELECT ON users FROM reporter');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
    });

    it('blocks mixed-case injection: SeLeCt 1; DrOp TaBlE users', () => {
      const result = validateSQL('SeLeCt 1; DrOp TaBlE users');
      expect(result.ok).toBe(false);
    });

    it('blocks REPLACE INTO injection — blocked at statement prefix check', () => {
      const result = validateSQL('REPLACE INTO users (id, name) VALUES (1, "hacked")');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
    });

    it('blocks VACUUM command — blocked at statement prefix check', () => {
      const result = validateSQL('VACUUM');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
    });

    it('blocks REINDEX command — blocked at statement prefix check', () => {
      const result = validateSQL('REINDEX users');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
    });

    it('blocks MERGE statement — blocked at statement prefix check', () => {
      const result = validateSQL('MERGE INTO users USING source ON (users.id = source.id) WHEN MATCHED THEN UPDATE SET name = source.name');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
    });

    it('blocks RENAME statement — blocked at statement prefix check', () => {
      const result = validateSQL('RENAME TABLE old_name TO new_name');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
    });

    it('returns meaningful reason for empty input', () => {
      const result = validateSQL('');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('SQL query must not be empty');
    });

    it('returns meaningful reason for whitespace-only input', () => {
      const result = validateSQL('   ');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('SQL query must not be empty');
    });

    it('returns meaningful reason for non-SELECT statements', () => {
      const result = validateSQL('SHOW TABLES');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('Only SELECT, WITH, and EXPLAIN statements are allowed');
    });

    it('allows legitimate SELECT with subquery containing no forbidden keywords', () => {
      expect(validateSQL('SELECT * FROM (SELECT id FROM users WHERE active = 1) AS sub')).toEqual({ ok: true });
    });

    it('allows SELECT with ORDER BY, LIMIT, OFFSET', () => {
      expect(validateSQL('SELECT id, name FROM users ORDER BY name ASC LIMIT 10 OFFSET 20')).toEqual({ ok: true });
    });

    it('allows SELECT with JOIN', () => {
      expect(validateSQL('SELECT u.id, r.name FROM users u INNER JOIN roles r ON u.role_id = r.id')).toEqual({ ok: true });
    });
  });
});
