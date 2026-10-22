import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPostgresCounts } from './postgres-catalog.js';

const pgMock = vi.hoisted(() => {
  const query = vi.fn();
  const end = vi.fn();
  const Pool = vi.fn().mockImplementation(function Pool() {
    return { query, end };
  });
  return { query, end, Pool };
});

vi.mock('pg', () => ({ default: { Pool: pgMock.Pool } }));

const TARGET = 'postgres://user:pass@localhost:5432/automate';

beforeEach(() => {
  pgMock.query.mockReset();
  pgMock.end.mockReset();
  pgMock.Pool.mockClear();
  pgMock.end.mockResolvedValue(undefined);
});

function sqlCalls(): string[] {
  return pgMock.query.mock.calls.map((call) => String(call[0]));
}

describe('readPostgresCounts', () => {
  it('counts every public base table, converting the text count to a number', async () => {
    pgMock.query
      .mockResolvedValueOnce({ rows: [{ table_name: 'runs' }, { table_name: 'tests' }] })
      .mockResolvedValueOnce({ rows: [{ count: '12' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await expect(readPostgresCounts(TARGET)).resolves.toEqual({ runs: 12, tests: 0 });

    expect(pgMock.Pool).toHaveBeenCalledWith({ connectionString: TARGET });
    const [catalog, ...counts] = sqlCalls();
    expect(catalog).toContain("table_schema = 'public'");
    expect(catalog).toContain("table_type = 'BASE TABLE'");
    expect(counts).toEqual([
      'SELECT COUNT(*)::text AS count FROM "runs"',
      'SELECT COUNT(*)::text AS count FROM "tests"',
    ]);
    expect(pgMock.end).toHaveBeenCalledOnce();
  });

  it('quotes a table name containing a double quote rather than splicing it raw', async () => {
    pgMock.query
      .mockResolvedValueOnce({ rows: [{ table_name: 'odd"name' }] })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] });

    await expect(readPostgresCounts(TARGET)).resolves.toEqual({ 'odd"name': 3 });
    expect(sqlCalls()[1]).toBe('SELECT COUNT(*)::text AS count FROM "odd""name"');
  });

  it('records 0 when the count query returns no row', async () => {
    pgMock.query
      .mockResolvedValueOnce({ rows: [{ table_name: 'runs' }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(readPostgresCounts(TARGET)).resolves.toEqual({ runs: 0 });
  });

  it('returns an empty record for a database with no public tables', async () => {
    pgMock.query.mockResolvedValueOnce({ rows: [] });
    await expect(readPostgresCounts(TARGET)).resolves.toEqual({});
    expect(pgMock.query).toHaveBeenCalledOnce();
  });

  it('closes the pool when a query fails, and surfaces the failure', async () => {
    pgMock.query
      .mockResolvedValueOnce({ rows: [{ table_name: 'runs' }] })
      .mockRejectedValueOnce(new Error('permission denied for table runs'));

    await expect(readPostgresCounts(TARGET)).rejects.toThrow('permission denied for table runs');
    expect(pgMock.end).toHaveBeenCalledOnce();
  });
});
