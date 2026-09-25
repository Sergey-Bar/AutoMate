/**
 * Service for grouping and managing test history data.
 */

export interface TestHistoryRow {
  stableId: string;
  status: string;
}

export interface GroupedHistoryResult {
  [stableId: string]: Array<{ status: string }>;
}

/**
 * Groups test history rows by stableId, limiting to the most recent N results per ID.
 *
 * @param rows - Array of test history rows (must be pre-sorted newest-first for correct limiting)
 * @param limitPerId - Maximum number of history entries to keep per stableId (default: 7)
 * @returns Map of stableId to array of status objects (max limitPerId entries per ID)
 *
 * @example
 * ```typescript
 * const rows = [
 *   { stableId: 'test-1', status: 'passed' },
 *   { stableId: 'test-1', status: 'failed' },
 *   { stableId: 'test-2', status: 'passed' },
 * ];
 * const grouped = groupRecentStatuses(rows, 2);
 * // { 'test-1': [{ status: 'passed' }, { status: 'failed' }], 'test-2': [{ status: 'passed' }] }
 * ```
 */
export function groupRecentStatuses(
  rows: TestHistoryRow[],
  limitPerId: number = 7,
): GroupedHistoryResult {
  const map: GroupedHistoryResult = {};

  for (const row of rows) {
    const sid = row.stableId;

    // Initialize array for new stableId
    if (!map[sid]) {
      map[sid] = [];
    }

    // Only add if under the limit for this stableId
    if (map[sid].length < limitPerId) {
      map[sid].push({ status: row.status });
    }
  }

  return map;
}
