import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ChecklistItem {
  name: string;
  check: () => Promise<boolean> | boolean;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  message?: string;
}

const ROOT = resolve(import.meta.dirname, '..');

export const smokeChecklist: ChecklistItem[] = [
  {
    name: 'Root package.json exists',
    check: () => existsSync(resolve(ROOT, 'package.json')),
  },
  {
    name: 'Server package exists',
    check: () => existsSync(resolve(ROOT, 'apps/server/package.json')),
  },
  {
    name: 'Web package exists',
    check: () => existsSync(resolve(ROOT, 'apps/web/package.json')),
  },
  {
    name: 'Desktop package exists',
    check: () => existsSync(resolve(ROOT, 'apps/desktop/package.json')),
  },
  {
    name: 'Shared package exists',
    check: () => existsSync(resolve(ROOT, 'packages/shared/package.json')),
  },
  {
    name: 'Connector SDK package exists',
    check: () => existsSync(resolve(ROOT, 'packages/connector-sdk/package.json')),
  },
  {
    name: 'GitHub connector package exists',
    check: () => existsSync(resolve(ROOT, 'packages/connectors/github/package.json')),
  },
  {
    name: 'SQL browser package exists',
    check: () => existsSync(resolve(ROOT, 'packages/connectors/sql-browser/package.json')),
  },
  {
    name: 'Health endpoint module exists',
    check: () => existsSync(resolve(ROOT, 'apps/server/src/index.ts')),
  },
  {
    name: 'Dockerfile exists',
    check: () => existsSync(resolve(ROOT, 'Dockerfile')),
  },
  {
    name: 'Docker Compose exists',
    check: () => existsSync(resolve(ROOT, 'docker-compose.yml')),
  },
  {
    name: 'Turbo config exists',
    check: () => existsSync(resolve(ROOT, 'turbo.json')),
  },
];

/**
 * Runs all smoke checklist items and returns results.
 */
export async function runSmokeChecklist(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const item of smokeChecklist) {
    try {
      const passed = await item.check();
      results.push({ name: item.name, passed });
    } catch (err) {
      results.push({
        name: item.name,
        passed: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
