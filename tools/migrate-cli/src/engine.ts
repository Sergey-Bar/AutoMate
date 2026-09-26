import { readFileSync, writeFileSync } from 'node:fs';
import { buildPlan } from './plan.js';
import { readSqliteCatalog } from './catalog.js';

export function createPlan(input: {
  source: string;
  sourceId: string;
  sourceCommit: string;
  targetCommit: string;
}) {
  const tables = readSqliteCatalog(input.source);
  return buildPlan({ ...input, toolVersion: '0.2.0', tables });
}

export function writePlan(filePath: string, plan: ReturnType<typeof createPlan>): void {
  writeFileSync(filePath, JSON.stringify(plan, null, 2), 'utf8');
}

export function readPlan(filePath: string): ReturnType<typeof createPlan> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as ReturnType<typeof createPlan>;
}

export function validatePlan(plan: ReturnType<typeof createPlan>): void {
  if (plan.planVersion !== 1) throw new Error('Unsupported migration plan version');
  if (!/^[a-f0-9]{64}$/.test(plan.catalogFingerprint))
    throw new Error('Invalid catalog fingerprint');
  if (plan.tables.some((table) => table.disposition === 'blocked'))
    throw new Error('Plan contains blocked tables');
  if (plan.vault.keyReference === 'unconfigured' && plan.vault.count > 0) {
    throw new Error('Vault entries require a key reference');
  }
}
