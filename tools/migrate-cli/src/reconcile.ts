import { createHash } from 'node:crypto';

export function rowDigest(row: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(row, Object.keys(row).sort())).digest('hex');
}

export function reconcileCounts(source: Record<string, number>, target: Record<string, number>) {
  const discrepancies: string[] = [];
  for (const table of new Set([...Object.keys(source), ...Object.keys(target)])) {
    if ((source[table] ?? 0) !== (target[table] ?? 0)) {
      discrepancies.push(`${table}: source=${source[table] ?? 0} target=${target[table] ?? 0}`);
    }
  }
  return { ok: discrepancies.length === 0, discrepancies };
}
