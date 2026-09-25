/**
 * CSV generation utilities
 */

export interface CsvRow {
  [key: string]: unknown;
}

/**
 * Escapes a CSV cell value by quoting and escaping internal quotes
 */
function escapeCsvCell(value: unknown): string {
  if (value == null) return '';
  return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * Converts an array of objects to CSV string
 */
export function toCsv(rows: CsvRow[], headers: string[]): string {
  const csvRows = rows.map((row) =>
    headers.map((header) => escapeCsvCell(row[header])).join(',')
  );
  return [headers.join(','), ...csvRows].join('\n');
}

/**
 * Creates a streaming CSV generator for large datasets
 */
export async function* streamCsv(
  rows: AsyncIterable<CsvRow> | Iterable<CsvRow>,
  headers: string[]
): AsyncGenerator<string> {
  // Yield header row first
  yield headers.join(',') + '\n';

  // Yield data rows
  for await (const row of rows) {
    yield headers.map((header) => escapeCsvCell(row[header])).join(',') + '\n';
  }
}
