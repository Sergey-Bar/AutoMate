/**
 * Diagnostics the user can read before sharing (R-018). Written to a file; nothing is sent.
 *
 * Contents: versions, counts, scan status and limits, notes and recent events. Never report
 * content, never absolute paths, never the host or user name.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redactPersonal } from './redact.mjs';

/**
 * @param {ReturnType<import('./engine.mjs').createEngine>} engine
 * @param {{ now?: () => Date }} [options]
 */
export function buildDiagnostics(engine, options = {}) {
  const now = options.now ?? (() => new Date());
  const repositories = engine.listRepositories();
  const roots = repositories.map((r) => r.root_path);
  const scrub = (value) => JSON.parse(redactPersonal(JSON.stringify(value), { roots }));
  return scrub({
    generatedAt: now().toISOString(),
    note: 'Review this file before sharing it. AUTOMATE (local) never sends it anywhere.',
    versions: {
      engine: engine.version,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
    },
    repositories: repositories.map((repository, index) => {
      const scan = engine.store.latestScan(repository.id);
      return {
        label: `repository-${String(index + 1)}`,
        lastScanAt: repository.last_scan_at,
        scan:
          scan === null
            ? null
            : {
                status: scan.status,
                limitsHit: scan.summary.limitsHit,
                filesSeen: scan.summary.filesSeen,
                bytesRead: scan.summary.bytesRead,
                projects: scan.summary.projects.length,
                reports: scan.summary.reports.map((r) => ({
                  path: r.path,
                  format: r.format,
                  outcome: r.outcome,
                })),
                notes: scan.summary.notes,
              },
      };
    }),
    recentEvents: engine.events
      .since(0)
      .slice(-50)
      .map((event) => ({ cursor: event.cursor, type: event.type, at: event.at, data: event.data })),
  });
}

/**
 * @param {ReturnType<import('./engine.mjs').createEngine>} engine
 * @param {string} directory
 * @returns {string} the path written
 */
export function writeDiagnostics(engine, directory) {
  mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const file = path.join(directory, `diagnostics-${stamp}.json`);
  writeFileSync(file, `${JSON.stringify(buildDiagnostics(engine), null, 2)}\n`, { flag: 'wx' });
  return file;
}
