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
  /**
   * Named `plannedPhases` because none of them run here. The previous report
   * listed them under `phases` and the script then printed "Local rehearsal
   * guard passed", which reads as a completed rehearsal of a production
   * migration. It is a guard: it verifies the target is a local database and
   * refuses to authorize a cutover. Nothing is backed up, migrated, reconciled
   * or rolled back.
   */
  plannedPhases: ['plan', 'backup', 'waves', 'artifacts', 'vault', 'reconcile', 'rollback'],
  performedPhases: ['local-target-guard'],
  rehearsalPerformed: false,
};
const outputRoot =
  env['REHEARSAL_REPORT_DIR'] ?? path.join('var', 'migration-rehearsal', report.rehearsalId);
mkdirSync(outputRoot, { recursive: true });
writeFileSync(path.join(outputRoot, 'report.json'), JSON.stringify(report, null, 2));
console.info(`Local rehearsal guard passed: ${outputRoot}`);
console.info('No rehearsal was performed: this guards the target only.');
console.info(`Planned but not executed: ${report.plannedPhases.join(', ')}`);
