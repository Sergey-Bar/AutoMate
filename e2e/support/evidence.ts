/**
 * Evidence files for the E2E suite.
 *
 * They go to `test-results/evidence`, which CI uploads as an artifact. That
 * directory used to be `.sisyphus/evidence/`, which `.gitignore` ignores — so the
 * artifacts the suite exists to produce were written, never uploaded, and nobody
 * could look at why a run failed.
 *
 * Filenames are named for what they show. An agent's task id is not evidence.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const supportDir = path.dirname(fileURLToPath(import.meta.url));
export const EVIDENCE_DIR = path.resolve(supportDir, '../../test-results/evidence');

/** Write a JSON evidence file under `test-results/evidence/<subdir>/`. */
export function saveEvidence(subdir: string, filename: string, data: unknown): string {
  const target = path.join(EVIDENCE_DIR, subdir);
  fs.mkdirSync(target, { recursive: true });
  const file = path.join(target, filename);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  return file;
}

/** Write a plain-text evidence file under `test-results/evidence/<subdir>/`. */
export function saveEvidenceText(subdir: string, filename: string, content: string): string {
  const target = path.join(EVIDENCE_DIR, subdir);
  fs.mkdirSync(target, { recursive: true });
  const file = path.join(target, filename);
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

/**
 * A summary built from values the test actually observed.
 *
 * Not from constants the test also happens to use: a summary that restates the
 * test's own inputs is green whenever the test is green and says nothing when it
 * is not.
 */
export function observedSummary(title: string, observed: Record<string, string | number>): string {
  const width = Math.max(...Object.keys(observed).map((key) => key.length));
  const rows = Object.entries(observed).map(
    ([key, value]) => `  ${key.padEnd(width)} : ${String(value)}`,
  );
  return [`${title}`, ...rows, `  observed at            : ${new Date().toISOString()}`].join('\n');
}
