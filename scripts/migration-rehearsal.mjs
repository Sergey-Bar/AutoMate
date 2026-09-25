import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertLocalRehearsal } from './lib/local-rehearsal-guard.mjs';

const env = process.env;
const target = assertLocalRehearsal(env);
const report = {
  rehearsalId: createHash('sha256')
    .update(`${target.databaseName}:${new Date().toISOString()}`)
    .digest('hex')
    .slice(0, 16),
  productionCutoverAuthorized: false,
  target,
  phases: ['plan', 'backup', 'waves', 'artifacts', 'vault', 'reconcile', 'rollback'],
};
const outputRoot =
  env['REHEARSAL_REPORT_DIR'] ?? path.join('var', 'migration-rehearsal', report.rehearsalId);
mkdirSync(outputRoot, { recursive: true });
writeFileSync(path.join(outputRoot, 'report.json'), JSON.stringify(report, null, 2));
console.info(`Local rehearsal guard passed: ${outputRoot}`);
