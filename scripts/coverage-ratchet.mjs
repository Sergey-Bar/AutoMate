import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(readFileSync(path.join(root, 'coverage-baseline.json'), 'utf8'));
const packages = {
  api: 'apps/api/coverage/coverage-summary.json',
  web: 'apps/web/coverage/coverage-summary.json',
  'shared-contracts': 'packages/shared-contracts/coverage/coverage-summary.json',
  reporting: 'packages/reporting/coverage/coverage-summary.json',
  reporter: 'packages/reporter/coverage/coverage-summary.json',
  orchestration: 'packages/orchestration/coverage/coverage-summary.json',
  automation: 'packages/automation/coverage/coverage-summary.json',
  'runner-sdk': 'packages/runner-sdk/coverage/coverage-summary.json',
  config: 'packages/config/coverage/coverage-summary.json',
};
const failures = [];
for (const [name, relativePath] of Object.entries(packages)) {
  const summaryPath = path.join(root, relativePath);
  if (!existsSync(summaryPath)) {
    failures.push(`${name}: missing ${relativePath}`);
    continue;
  }
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8')).total;
  for (const [metric, minimum] of Object.entries(baseline[name] ?? {})) {
    const actual = summary[metric]?.pct;
    if (typeof actual !== 'number' || actual < minimum) {
      failures.push(`${name}: ${metric} ${actual ?? 'missing'} < ${minimum}`);
    }
  }
}
if (failures.length > 0) {
  console.error('Coverage ratchet failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Coverage ratchet passed');
