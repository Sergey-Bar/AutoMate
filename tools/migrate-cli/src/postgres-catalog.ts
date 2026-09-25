import pg from 'pg';

export async function readPostgresCounts(
  connectionString: string,
): Promise<Record<string, number>> {
  const pool = new pg.Pool({ connectionString });
  try {
    const tables = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
    );
    const counts: Record<string, number> = {};
    for (const { table_name: table } of tables.rows) {
      const identifier = `"${table.replaceAll('"', '""')}"`;
      const result = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${identifier}`,
      );
      counts[table] = Number(result.rows[0]?.count ?? 0);
    }
    return counts;
  } finally {
    await pool.end();
  }
}
