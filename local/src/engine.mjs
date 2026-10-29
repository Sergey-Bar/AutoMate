/**
 * The engine: scan, ingest, reconcile and analyse, with no user interface in it.
 *
 * Everything the interface does is a call here, so every behaviour can be tested without a
 * browser. Imports only Node built-ins and this package; it makes no network request.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { computeKpis, effectiveRuns } from './analysis.mjs';
import { readFileBounded } from './bounded-read.mjs';
import { isReportShaped, scanRepository } from './detect.mjs';
import { detectFormat } from './ingest.mjs';
import { applyDismissals, computeFindings } from './findings.mjs';
import { reconcile } from './reconcile.mjs';
import { installRequest, loadCatalog, recommend } from './toolbox.mjs';
import { openStore } from './store.mjs';
import { ZIP_LIMITS, listZip, readEntry } from './zip.mjs';

export const ENGINE_VERSION = '0.1.0';

/** Biggest report file read into memory. The parsers apply their own limits as well. */
const MAX_REPORT_BYTES = 64 * 1024 * 1024;

/** Biggest archive read into memory for an import. */
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

/**
 * The commit a repository is on, read from `.git` without running Git. Null when unknown.
 *
 * @param {string} root
 * @returns {string | null}
 */
export function readHead(root) {
  try {
    const head = readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return /^[0-9a-f]{7,64}$/.test(head) ? head : null;
    const ref = head.slice(5);
    const loose = path.join(root, '.git', ...ref.split('/'));
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim();
    const packed = path.join(root, '.git', 'packed-refs');
    if (existsSync(packed)) {
      const line = readFileSync(packed, 'utf8')
        .split('\n')
        .find((entry) => entry.endsWith(` ${ref}`));
      return line === undefined ? null : (line.split(' ')[0] ?? null);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * An in-memory event log with an increasing cursor, so a client that reconnects with the
 * last cursor it saw receives what it missed (ADR-012).
 */
export class EventLog {
  /** @param {number} [capacity] */
  constructor(capacity = 1000) {
    this.capacity = capacity;
    /** @type {Array<{ cursor: number, version: 1, type: string, at: string, data: unknown }>} */
    this.events = [];
    this.next = 1;
    /** @type {Set<(event: { cursor: number, type: string, data: unknown }) => void>} */
    this.listeners = new Set();
  }

  /**
   * @param {string} type
   * @param {unknown} data
   */
  emit(type, data) {
    const event = {
      cursor: this.next,
      version: /** @type {const} */ (1),
      type,
      at: new Date().toISOString(),
      data,
    };
    this.next += 1;
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.shift();
    for (const listener of this.listeners) listener(event);
    return event;
  }

  /** @param {number} cursor events strictly after this cursor */
  since(cursor) {
    return this.events.filter((event) => event.cursor > cursor);
  }

  /** @param {(event: any) => void} listener */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/**
 * @param {{ dataDir: string, now?: () => Date, catalogFile?: string }} options
 */
export function createEngine(options) {
  const store = openStore(options.dataDir);
  const now = options.now ?? (() => new Date());
  const events = new EventLog();
  const { catalog, errors: catalogErrors } = loadCatalog(options.catalogFile);

  return {
    store,
    events,
    version: ENGINE_VERSION,

    close() {
      store.close();
    },

    /**
     * Registers a repository and scans it. Reads the repository, copies report bytes into
     * the store, and writes nothing to the repository.
     *
     * @param {string} rootPath
     * @param {{ signal?: AbortSignal, limits?: object, extraReportDirs?: string[], scanId?: string }} [scanOptions]
     */
    async scan(rootPath, scanOptions = {}) {
      const root = path.resolve(rootPath);
      const startedAt = now().toISOString();
      const scanId = scanOptions.scanId ?? randomBytes(6).toString('hex');
      const correlation = scanId;
      events.emit('scan.started', { scanId, root, correlation });

      const result = await scanRepository(root, scanOptions);
      if (result.status === 'failed') {
        events.emit('scan.failed', { scanId, reason: result.reason, correlation });
        return { scanId, status: 'failed', reason: result.reason };
      }
      const repositoryId = store.upsertRepository(root, startedAt);
      const commit = readHead(root);

      /** @type {Array<{ path: string, sha256: string | null, format: string | null, outcome: string, modifiedMs: number }>} */
      const reports = [];
      for (const report of result.reports) {
        if (scanOptions.signal?.aborted === true) break;
        const absolute = report.external
          ? report.relativePath
          : path.join(root, report.relativePath);
        /** @type {string} */
        let outcome;
        let sha256 = null;
        try {
          const read = await readFileBounded(absolute, MAX_REPORT_BYTES);
          if (read.status === 'not-a-file') {
            outcome = 'unreadable:EISDIR';
          } else if (read.status === 'too-large') {
            outcome = 'too-large';
          } else {
            const ingested = store.ingest(read.bytes, {
              path: report.external ? `external:${report.relativePath}` : report.relativePath,
              observedAt: now().toISOString(),
              modifiedMs: read.info.mtimeMs,
              ingestOptions: { repoRoot: root },
            });
            sha256 = ingested.sha256;
            outcome = ingested.status;
          }
        } catch (error) {
          outcome = `unreadable:${/** @type {{ code?: string }} */ (error).code ?? 'error'}`;
        }
        reports.push({
          path: report.relativePath,
          sha256,
          format: report.format,
          outcome,
          modifiedMs: report.modifiedMs,
        });
        events.emit('scan.report', { scanId, path: report.relativePath, outcome, correlation });
      }

      const status = scanOptions.signal?.aborted === true ? 'cancelled' : result.status;
      const finishedAt = now().toISOString();
      store.recordScan({
        id: scanId,
        repositoryId,
        startedAt,
        finishedAt,
        status,
        commit,
        summary: {
          commit,
          limitsHit: result.limitsHit,
          filesSeen: result.filesSeen,
          bytesRead: result.bytesRead,
          projects: result.projects,
          notes: result.notes,
          reports,
        },
      });
      events.emit('scan.completed', { scanId, repositoryId, status, correlation });
      return { scanId, repositoryId, status };
    },

    /** @param {string} repositoryId */
    dashboard(repositoryId) {
      const repository = store.getRepository(repositoryId);
      if (repository === undefined) return null;
      const scan = store.latestScan(repositoryId);
      const shas = new Set(
        scan === null ? [] : scan.summary.reports.map((r) => r.sha256).filter(Boolean),
      );
      const commit = repository.commit_ref ?? undefined;
      const items = store
        .items()
        .filter((item) => shas.has(item.sha256))
        .map((item) => ({
          ...item,
          context: {
            ...item.context,
            ...(commit === undefined ? {} : { commit }),
            ...(typeof item.context.modifiedMs === 'number'
              ? { observedAt: new Date(item.context.modifiedMs).toISOString() }
              : {}),
          },
        }));
      const reconciliation = reconcile(items);
      const readable = items.filter((item) => item.result.kind !== 'rejected');
      const runs = effectiveRuns(
        readable.filter((item) => item.result.kind === 'run'),
        reconciliation,
      );
      const rejected = items
        .filter((item) => item.result.kind === 'rejected')
        .map((item) => ({ id: item.id, reason: item.result.rejection }));
      const kpis = computeKpis({
        runs,
        coverage: items.filter((item) => item.result.kind === 'coverage'),
        rejected,
        scan: scan === null ? undefined : { ...scan.summary, reports: scan.summary.reports },
        reconciliation,
        now: now().getTime(),
      });
      return { repository, scan, kpis, reconciliation, items, rejected };
    },

    /** @param {string} sha256 */
    report(sha256) {
      return store.artifactDetail(sha256);
    },

    /** @param {string} sha256 */
    rawReport(sha256) {
      if (!/^[0-9a-f]{64}$/.test(sha256) || !store.hasArtifact(sha256)) return null;
      return store.readBlob(sha256);
    },

    listRepositories() {
      return store.listRepositories();
    },

    /**
     * Findings from the stored history of a repository: deterministic, with evidence.
     * Dismissed findings are flagged, and left out unless asked for.
     *
     * @param {string} repositoryId
     * @param {{ includeDismissed?: boolean }} [findingOptions]
     */
    findings(repositoryId, findingOptions = {}) {
      const repository = store.getRepository(repositoryId);
      if (repository === undefined) return null;
      const scans = store.scansFor(repositoryId);
      /** @type {Map<string, any>} */
      const results = new Map();
      for (const item of store.items()) results.set(item.sha256, item.result);
      const computed = computeFindings({
        scans,
        resultOf: (sha) => results.get(sha) ?? null,
        now: now().getTime(),
      });
      const all = applyDismissals(computed.findings, store.dismissedFindings());
      const shown =
        findingOptions.includeDismissed === true ? all : all.filter((f) => !f.dismissed);
      return {
        repository,
        scans: scans.length,
        findings: shown,
        dismissedCount: all.filter((f) => f.dismissed).length,
        thresholds: computed.thresholds,
      };
    },

    /**
     * @param {string} repositoryId
     * @param {string} fingerprint a fingerprint of a finding that exists now
     * @param {string | null} note why
     * @returns {boolean} false when there is no such finding
     */
    dismissFinding(repositoryId, fingerprint, note) {
      const view = this.findings(repositoryId, { includeDismissed: true });
      if (view === null || !view.findings.some((f) => f.fingerprint === fingerprint)) return false;
      store.dismissFinding(
        fingerprint,
        now().toISOString(),
        note === null ? null : note.slice(0, 500),
      );
      return true;
    },

    /**
     * @param {string} repositoryId
     * @param {string} fingerprint
     * @returns {boolean}
     */
    restoreFinding(repositoryId, fingerprint) {
      const view = this.findings(repositoryId, { includeDismissed: true });
      if (view === null || !view.findings.some((f) => f.fingerprint === fingerprint && f.dismissed))
        return false;
      store.restoreFinding(fingerprint);
      return true;
    },

    /**
     * Imports the reports inside a CI artifact archive (a .zip on this computer) into a
     * repository. Entries are read into memory and never written to disk. The result is
     * recorded as a scan that keeps the repository's earlier reports and adds these, so the
     * dashboard shows both; imported reports are named `zip:<archive>!/<entry>`.
     *
     * @param {string} repositoryId
     * @param {string} archivePath
     */
    async importArchive(repositoryId, archivePath) {
      const repository = store.getRepository(repositoryId);
      if (repository === undefined) return { status: 'failed', reason: 'no-such-repository' };
      const absolute = path.resolve(archivePath);
      const archive = await readFileBounded(absolute, MAX_ARCHIVE_BYTES).catch(() => null);
      if (archive === null || archive.status === 'not-a-file')
        return { status: 'failed', reason: 'not-a-file' };
      if (archive.status === 'too-large') return { status: 'failed', reason: 'archive-too-large' };
      const { bytes, info } = archive;
      const listed = listZip(bytes);
      if (!listed.ok) return { status: 'failed', reason: listed.reason };

      const startedAt = now().toISOString();
      const label = `zip:${path.basename(absolute)}`;
      const previous = store.latestScan(repositoryId);
      /** @type {Array<{ path: string, sha256: string | null, format: string | null, outcome: string, modifiedMs: number }>} */
      const imported = [];
      /** @type {Array<{ entry: string, reason: string }>} */
      const refused = [];
      let skipped = 0;
      let total = 0;
      for (const entry of listed.entries) {
        if (entry.directory) continue;
        if (!isReportShaped(entry.name.replaceAll('\\', '/'))) {
          skipped += 1;
          continue;
        }
        total += entry.size;
        if (total > ZIP_LIMITS.maxTotalBytes) {
          refused.push({ entry: entry.name, reason: 'archive-total-too-large' });
          continue;
        }
        const read = readEntry(bytes, entry);
        if (!read.ok) {
          refused.push({ entry: entry.name, reason: read.reason });
          continue;
        }
        const name = `${label}!/${entry.name.replaceAll('\\', '/')}`;
        const ingested = store.ingest(read.bytes, {
          path: name,
          observedAt: startedAt,
          modifiedMs: info.mtimeMs,
          ingestOptions: { repoRoot: repository.root_path },
        });
        imported.push({
          path: name,
          sha256: ingested.sha256,
          format: detectFormat(read.bytes),
          outcome: ingested.status,
          modifiedMs: info.mtimeMs,
        });
        events.emit('import.report', { repositoryId, path: name, outcome: ingested.status });
      }
      const kept = (previous?.summary.reports ?? []).filter(
        (/** @type {{ path: string }} */ r) => !r.path.startsWith(`${label}!/`),
      );
      const status = refused.length > 0 ? 'partial' : 'complete';
      const scanId = randomBytes(6).toString('hex');
      store.recordScan({
        id: scanId,
        repositoryId,
        startedAt,
        finishedAt: now().toISOString(),
        status,
        commit: repository.commit_ref ?? null,
        summary: {
          ...(previous?.summary ?? {
            limitsHit: [],
            filesSeen: 0,
            bytesRead: 0,
            projects: [],
            notes: [],
          }),
          commit: previous?.summary.commit ?? repository.commit_ref ?? null,
          reports: [...kept, ...imported],
          source: 'import',
          archive: {
            name: path.basename(absolute),
            entries: listed.entries.length,
            imported: imported.length,
            skipped,
            refused,
          },
        },
      });
      events.emit('import.completed', { repositoryId, scanId, status });
      return { status, scanId, imported: imported.length, skipped, refused };
    },

    /** The validated catalog, or null with the reasons it was refused. */
    catalog() {
      return { catalog, errors: catalogErrors };
    },

    /**
     * Recommendations from the latest scan of a repository. Reads what the scan recorded;
     * runs nothing and changes nothing.
     *
     * @param {string} repositoryId
     */
    toolbox(repositoryId) {
      const repository = store.getRepository(repositoryId);
      if (repository === undefined) return null;
      const scan = store.latestScan(repositoryId);
      if (catalog === null)
        return { repository, scan, recommendations: [], suppressed: [], catalogErrors };
      if (scan === null)
        return { repository, scan, recommendations: [], suppressed: [], catalogErrors: [] };
      const found = recommend({
        projects: scan.summary.projects,
        reports: scan.summary.reports,
        catalog,
      });
      return { repository, scan, ...found, catalogErrors: [] };
    },

    /**
     * The runner request that installs a recommended tool, or null when this version cannot
     * install it. It only builds the request; the runner's preview and consent decide.
     *
     * @param {string} repositoryId
     * @param {string} recommendationId
     */
    installRequest(repositoryId, recommendationId) {
      const view = this.toolbox(repositoryId);
      if (view === null || catalog === null || view.scan === null) return null;
      const recommendation = view.recommendations.find((r) => r.id === recommendationId);
      if (recommendation === undefined) return null;
      return installRequest({
        recommendation,
        repositoryId,
        catalog,
        projects: view.scan.summary.projects,
      });
    },
  };
}
