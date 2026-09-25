import Database from 'better-sqlite3';

export function readSqliteCatalog(filePath: string) {
  const database = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>;
    return tables.map(({ name }) => {
      const columns = database.prepare(`PRAGMA table_info("${name.replaceAll('"', '""')}")`).all() as Array<{ name: string }>;
      const count = database.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).get() as { count: number };
      return { name, columns: columns.map((column) => column.name), rowCount: count.count };
    });
  } finally {
    database.close();
  }
}
