/**
 * Raw evidence preservation and storage (spike S3). Throwaway prototype code.
 *
 * Shape: raw bytes live in a content-addressed directory, named by their SHA-256, and a
 * SQLite database holds the metadata and the derived rows. The SQLite driver is the module
 * built into Node (`node:sqlite`) because it is the only one that could be exercised in the
 * environment that wrote this; that is a fact about the environment, not a recommendation.
 *
 * Ordering rule: the blob is written and made durable **before** the database transaction
 * that references it. A crash between the two leaves an unreferenced blob, which is
 * harmless, and never a row that points at nothing.
 */
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ingest } from './ingest.mjs';

export const SCHEMA_VERSION = 1;
export const PARSER_NAME = 'spike-reader';
export const PARSER_VERSION = '0';

/** A failure with a stable code, so a caller can say what happened. */
export class StoreError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {unknown} [cause]
   */
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = 'StoreError';
    this.code = code;
  }
}

/** @type {Record<number, string>} forward-only migrations, keyed by the version they reach */
export const MIGRATIONS = {
  1: `
    create table artifact (
      id text primary key,
      byte_size integer not null,
      format text not null,
      first_seen_at text not null
    ) strict;
    create table artifact_location (
      artifact_id text not null references artifact(id),
      path text not null,
      seen_at text not null,
      primary key (artifact_id, path)
    ) strict;
    create table run (
      id text primary key,
      artifact_id text not null references artifact(id),
      format text not null,
      completeness text not null,
      run_status text not null,
      run_errors integer not null,
      observed_at text not null,
      warnings text not null,
      context text not null
    ) strict;
    create table test_result (
      id text primary key,
      run_id text not null references run(id),
      ordinal integer not null,
      name text not null,
      suite text,
      project text,
      file text,
      file_raw text,
      outcome text not null,
      flakiness text not null
    ) strict;
    create table attempt (
      result_id text not null references test_result(id),
      idx integer not null,
      outcome text not null,
      raw_status text not null,
      duration_ms real,
      message text,
      message_truncated integer not null,
      primary key (result_id, idx)
    ) strict;
  `,
  // Version 2: the full observation as JSON (derived, rebuildable), coverage, repositories,
  // scans, and the modification time of each place an artifact was found.
  2: `
    alter table run add column result text;
    alter table artifact_location add column modified_ms real;
    create table coverage (
      id text primary key,
      artifact_id text not null references artifact(id),
      completeness text not null,
      warnings text not null,
      observed_at text not null,
      context text not null,
      result text not null
    ) strict;
    create table repository (
      id text primary key,
      root_path text not null unique,
      created_at text not null,
      last_scan_at text,
      commit_ref text
    ) strict;
    create table scan (
      id text primary key,
      repository_id text not null references repository(id),
      started_at text not null,
      finished_at text,
      status text not null,
      summary text not null
    ) strict;
  `,
  // Version 3: runner history (an execution is a record of something that ran, never
  // derived from reports) and finding dismissals (a user decision, kept across rebuilds).
  3: `
    create table execution (
      id text primary key,
      repository_id text,
      retry_of text,
      argv text not null,
      cwd text not null,
      env_names text not null,
      deadline_ms integer not null,
      artifact_paths text not null,
      state text not null,
      reason text,
      exit_code integer,
      started_at text,
      finished_at text,
      termination text,
      output text,
      recorded_at text not null
    ) strict;
    create table finding_dismissal (
      fingerprint text primary key,
      dismissed_at text not null,
      note text
    ) strict;
  `,
};

/**
 * @param {string} bytes
 * @returns {string}
 */
const digestOf = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Opens (creating if needed) a store, migrating forward and refusing a newer schema.
 *
 * @param {string} directory
 * @param {{ maxPages?: number, migrations?: Record<number, string>, target?: number }} [options]
 */
export function openStore(directory, options = {}) {
  mkdirSync(path.join(directory, 'blobs'), { recursive: true });
  const dbPath = path.join(directory, 'evidence.db');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('pragma journal_mode = wal; pragma synchronous = full; pragma foreign_keys = on;');
    if (options.maxPages !== undefined) {
      db.exec(`pragma max_page_count = ${String(options.maxPages)};`);
    }
    migrate(db, dbPath, options.migrations ?? MIGRATIONS, options.target);
  } catch (error) {
    // A store that fails to open must not keep its files locked.
    db.close();
    throw error;
  }
  return new Store(directory, db);
}

/**
 * Brings the database to the target version, refusing a newer one and copying the file
 * before changing an existing one.
 *
 * @param {DatabaseSync} db
 * @param {string} dbPath
 * @param {Record<number, string>} migrations
 * @param {number | undefined} requested
 */
function migrate(db, dbPath, migrations, requested) {
  const target = requested ?? Math.max(...Object.keys(migrations).map(Number));
  const current = Number(
    /** @type {{ user_version: number }} */ (db.prepare('pragma user_version').get()).user_version,
  );
  if (current > target) {
    throw new StoreError(
      'schema-too-new',
      `database is schema version ${String(current)}, this build understands up to ${String(
        target,
      )}`,
    );
  }
  if (current === target) return;
  if (current > 0) {
    db.exec('pragma wal_checkpoint(truncate)');
    copyFileSync(dbPath, `${dbPath}.bak-v${String(current)}`);
  }
  for (let version = current + 1; version <= target; version += 1) {
    const sql = migrations[version];
    if (sql === undefined) {
      throw new StoreError('migration-missing', `no migration to version ${String(version)}`);
    }
    db.exec('begin immediate');
    try {
      db.exec(sql);
      db.exec(`pragma user_version = ${String(version)}`);
      db.exec('commit');
    } catch (error) {
      rollbackQuietly(db);
      throw new StoreError(
        'migration-failed',
        `migration to version ${String(version)} failed`,
        error,
      );
    }
  }
}
/**
 * Rolls back if a transaction is still open.
 *
 * SQLite rolls a transaction back by itself on some errors, notably when the database is
 * full, and an explicit ROLLBACK after that throws and hides the error that mattered. The
 * spike's own full-database test found this.
 *
 * @param {DatabaseSync} db
 */
function rollbackQuietly(db) {
  if (db.isTransaction) db.exec('rollback');
}
class Store {
  /**
   * @param {string} directory
   * @param {DatabaseSync} db
   */
  constructor(directory, db) {
    this.directory = directory;
    this.db = db;
  }

  close() {
    this.db.close();
  }

  /** @param {string} sha256 */
  blobPath(sha256) {
    return path.join(this.directory, 'blobs', sha256.slice(0, 2), sha256);
  }

  /**
   * Writes the blob atomically and durably: a temporary file in the same directory, fsync,
   * then rename. An existing blob with the same name is left alone, because its name is the
   * digest of its contents.
   *
   * @param {Uint8Array} bytes
   * @param {string} sha256
   * @param {{ writeBlob?: (path: string, bytes: Uint8Array) => void }} hooks
   */
  putBlob(bytes, sha256, hooks) {
    const finalPath = this.blobPath(sha256);
    if (existsSync(finalPath)) return;
    mkdirSync(path.dirname(finalPath), { recursive: true });
    const temporary = `${finalPath}.tmp-${randomBytes(6).toString('hex')}`;
    try {
      if (hooks.writeBlob !== undefined) hooks.writeBlob(temporary, bytes);
      else {
        const fd = openSync(temporary, 'wx');
        try {
          writeSync(fd, bytes);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }
      renameSync(temporary, finalPath);
    } catch (error) {
      rmSync(temporary, { force: true });
      const code = /** @type {{ code?: string }} */ (error).code;
      if (code === 'ENOSPC')
        throw new StoreError('storage-full', 'no space left to store the report', error);
      throw new StoreError('blob-write-failed', 'could not store the report', error);
    }
  }

  /**
   * Stores one report and its derived rows. Idempotent: the same bytes ingested again with
   * the same parser change nothing.
   *
   * @param {Uint8Array} bytes
   * @param {{ path?: string, observedAt: string, ingestOptions?: object,
   *   hooks?: { writeBlob?: (path: string, bytes: Uint8Array) => void,
   *     beforeCommit?: () => void } }} request
   */
  ingest(bytes, request) {
    const hooks = request.hooks ?? {};
    const parsed = ingest(bytes, request.ingestOptions);
    const sha256 = parsed.artifact.sha256;
    const runId = digestOf(`${sha256}|${PARSER_NAME}|${PARSER_VERSION}`);
    if (request.path !== undefined && this.hasArtifact(sha256)) {
      this.recordLocation(sha256, request.path, request.observedAt, request.modifiedMs);
    }
    const knownRun =
      this.db.prepare('select 1 as present from run where id = ?').get(runId) !== undefined;
    const knownCoverage =
      this.db.prepare('select 1 as present from coverage where id = ?').get(runId) !== undefined;
    if (knownRun || knownCoverage) {
      return { status: 'already-ingested', sha256, runId };
    }
    this.putBlob(bytes, sha256, hooks);
    const result = parsed.result;
    this.db.exec('begin immediate');
    try {
      this.db
        .prepare(
          'insert or ignore into artifact (id, byte_size, format, first_seen_at) values (?, ?, ?, ?)',
        )
        .run(sha256, parsed.artifact.byteSize, result.format, request.observedAt);
      if (request.path !== undefined) {
        this.recordLocation(sha256, request.path, request.observedAt, request.modifiedMs);
      }
      if (result.kind === 'run' || result.kind === 'rejected') {
        this.db
          .prepare(
            'insert into run (id, artifact_id, format, completeness, run_status, run_errors, observed_at, warnings, context, result) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            runId,
            sha256,
            result.format,
            result.completeness,
            result.runStatus,
            result.kind === 'run' ? result.runErrors : 0,
            request.observedAt,
            JSON.stringify(result.warnings),
            JSON.stringify(request.ingestOptions ?? {}),
            JSON.stringify(result),
          );
      }
      if (result.kind === 'coverage') {
        this.db
          .prepare(
            'insert into coverage (id, artifact_id, completeness, warnings, observed_at, context, result) values (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            runId,
            sha256,
            result.completeness,
            JSON.stringify(result.warnings),
            request.observedAt,
            JSON.stringify(request.ingestOptions ?? {}),
            JSON.stringify(result),
          );
      }
      if (result.kind === 'run') this.insertResults(runId, result);
      if (hooks.beforeCommit !== undefined) hooks.beforeCommit();
      this.db.exec('commit');
    } catch (error) {
      rollbackQuietly(this.db);
      const message = String(/** @type {Error} */ (error).message);
      if (/database or disk is full/i.test(message)) {
        throw new StoreError(
          'storage-full',
          'the database is full; nothing from this report was stored',
          error,
        );
      }
      throw error;
    }
    return { status: 'ingested', sha256, runId };
  }

  /** @param {string} sha256 */
  hasArtifact(sha256) {
    return (
      this.db.prepare('select 1 as present from artifact where id = ?').get(sha256) !== undefined
    );
  }

  /**
   * @param {string} sha256
   * @param {string} location
   * @param {string} seenAt
   * @param {number | undefined} modifiedMs
   */
  recordLocation(sha256, location, seenAt, modifiedMs) {
    this.db
      .prepare(
        'insert into artifact_location (artifact_id, path, seen_at, modified_ms) values (?, ?, ?, ?) on conflict (artifact_id, path) do update set seen_at = excluded.seen_at, modified_ms = excluded.modified_ms',
      )
      .run(sha256, location, seenAt, modifiedMs ?? null);
  }

  /**
   * Every stored observation in the shape the analysis and reconciliation code takes.
   *
   * @returns {Array<{ id: string, sha256: string, result: any,
   *   context: Record<string, unknown> }>}
   */
  items() {
    const rows =
      /** @type {Array<{ id: string, artifact_id: string, result: string, context: string }>} */ (
        this.db
          .prepare(
            'select id, artifact_id, result, context from run where result is not null union all select id, artifact_id, result, context from coverage order by 1',
          )
          .all()
      );
    const modified = this.db.prepare(
      'select max(modified_ms) as modified_ms from artifact_location where artifact_id = ?',
    );
    return rows.map((row) => {
      const stamp = /** @type {{ modified_ms: number | null }} */ (modified.get(row.artifact_id));
      return {
        id: row.id,
        sha256: row.artifact_id,
        result: JSON.parse(row.result),
        context: {
          ...JSON.parse(row.context),
          ...(stamp.modified_ms === null ? {} : { modifiedMs: stamp.modified_ms }),
        },
      };
    });
  }

  // ── Repositories, scans and artifact detail ───────────────────────────────────────────

  /**
   * @param {string} rootPath absolute
   * @param {string} now
   * @returns {string} the repository id
   */
  upsertRepository(rootPath, now) {
    const id = digestOf(rootPath).slice(0, 16);
    this.db
      .prepare('insert or ignore into repository (id, root_path, created_at) values (?, ?, ?)')
      .run(id, rootPath, now);
    return id;
  }

  /** @returns {Array<{ id: string, root_path: string, created_at: string, last_scan_at: string | null, commit_ref: string | null }>} */
  listRepositories() {
    return /** @type {any} */ (
      this.db.prepare('select * from repository order by root_path').all()
    );
  }

  /** @param {string} id */
  getRepository(id) {
    return /** @type {any} */ (this.db.prepare('select * from repository where id = ?').get(id));
  }

  /**
   * @param {{ id: string, repositoryId: string, startedAt: string, finishedAt: string,
   *   status: string, summary: object, commit: string | null }} scan
   */
  recordScan(scan) {
    this.db.exec('begin immediate');
    try {
      this.db
        .prepare(
          'insert into scan (id, repository_id, started_at, finished_at, status, summary) values (?, ?, ?, ?, ?, ?)',
        )
        .run(
          scan.id,
          scan.repositoryId,
          scan.startedAt,
          scan.finishedAt,
          scan.status,
          JSON.stringify(scan.summary),
        );
      this.db
        .prepare('update repository set last_scan_at = ?, commit_ref = ? where id = ?')
        .run(scan.finishedAt, scan.commit, scan.repositoryId);
      this.db.exec('commit');
    } catch (error) {
      rollbackQuietly(this.db);
      throw error;
    }
  }

  /** @param {string} repositoryId */
  latestScan(repositoryId) {
    const row =
      /** @type {{ summary: string, status: string, started_at: string, finished_at: string } | undefined} */ (
        this.db
          .prepare(
            'select * from scan where repository_id = ? order by started_at desc, id desc limit 1',
          )
          .get(repositoryId)
      );
    return row === undefined ? null : { ...row, summary: JSON.parse(row.summary) };
  }

  /**
   * Every scan of a repository, oldest first, with its summary.
   *
   * @param {string} repositoryId
   * @returns {Array<{ id: string, started_at: string, finished_at: string, status: string, summary: any }>}
   */
  scansFor(repositoryId) {
    const rows = /** @type {any[]} */ (
      this.db
        .prepare('select * from scan where repository_id = ? order by started_at, id')
        .all(repositoryId)
    );
    return rows.map((row) => ({ ...row, summary: JSON.parse(row.summary) }));
  }
  /** @param {string} sha256 */
  artifactDetail(sha256) {
    const artifact = /** @type {any} */ (
      this.db.prepare('select * from artifact where id = ?').get(sha256)
    );
    if (artifact === undefined) return null;
    const locations = /** @type {any[]} */ (
      this.db
        .prepare(
          'select path, seen_at, modified_ms from artifact_location where artifact_id = ? order by path',
        )
        .all(sha256)
    );
    const run = /** @type {any} */ (
      this.db.prepare('select result from run where artifact_id = ?').get(sha256)
    );
    const coverage = /** @type {any} */ (
      this.db.prepare('select result from coverage where artifact_id = ?').get(sha256)
    );
    const row = run ?? coverage;
    return { artifact, locations, result: row === undefined ? null : JSON.parse(row.result) };
  }

  // ── Runner history and finding dismissals ─────────────────────────────────────────────

  /**
   * @param {{ id: string, repositoryId: string | null, retryOf: string | null, argv: string[],
   *   cwd: string, envNames: string[], deadlineMs: number, artifactPaths: string[],
   *   state: string, startedAt: string, recordedAt: string }} execution
   */
  insertExecution(execution) {
    this.db
      .prepare(
        'insert into execution (id, repository_id, retry_of, argv, cwd, env_names, deadline_ms, artifact_paths, state, started_at, recorded_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        execution.id,
        execution.repositoryId,
        execution.retryOf,
        JSON.stringify(execution.argv),
        execution.cwd,
        JSON.stringify(execution.envNames),
        execution.deadlineMs,
        JSON.stringify(execution.artifactPaths),
        execution.state,
        execution.startedAt,
        execution.recordedAt,
      );
  }

  /**
   * @param {string} id
   * @param {{ state?: string, reason?: string | null, exitCode?: number | null,
   *   finishedAt?: string, termination?: string | null, output?: object, collection?: object }} patch
   */
  updateExecution(id, patch) {
    const row = /** @type {any} */ (
      this.db.prepare('select * from execution where id = ?').get(id)
    );
    if (row === undefined) throw new StoreError('not-found', `no execution ${id}`);
    const output =
      patch.output === undefined && patch.collection === undefined
        ? row.output
        : JSON.stringify({
            ...(row.output === null ? {} : JSON.parse(row.output)),
            ...(patch.output === undefined ? {} : { output: patch.output }),
            ...(patch.collection === undefined ? {} : { collection: patch.collection }),
          });
    this.db
      .prepare(
        'update execution set state = ?, reason = ?, exit_code = ?, finished_at = ?, termination = ?, output = ? where id = ?',
      )
      .run(
        patch.state ?? row.state,
        patch.reason === undefined ? row.reason : patch.reason,
        patch.exitCode === undefined ? row.exit_code : patch.exitCode,
        patch.finishedAt ?? row.finished_at,
        patch.termination === undefined ? row.termination : patch.termination,
        output,
        id,
      );
  }

  /** @param {any} row */
  static executionFrom(row) {
    const extra = row.output === null ? {} : JSON.parse(row.output);
    return {
      id: row.id,
      repositoryId: row.repository_id,
      retryOf: row.retry_of,
      argv: JSON.parse(row.argv),
      cwd: row.cwd,
      envNames: JSON.parse(row.env_names),
      deadlineMs: row.deadline_ms,
      artifactPaths: JSON.parse(row.artifact_paths),
      state: row.state,
      reason: row.reason,
      exitCode: row.exit_code,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      termination: row.termination,
      output: extra.output ?? null,
      collection: extra.collection ?? null,
    };
  }

  /** @param {string} id */
  getExecution(id) {
    const row = this.db.prepare('select * from execution where id = ?').get(id);
    return row === undefined ? null : Store.executionFrom(row);
  }

  /** @param {{ repositoryId?: string, limit?: number }} [filter] newest first */
  listExecutions(filter = {}) {
    const rows = /** @type {any[]} */ (
      filter.repositoryId === undefined
        ? this.db
            .prepare('select * from execution order by started_at desc, id desc limit ?')
            .all(filter.limit ?? 50)
        : this.db
            .prepare(
              'select * from execution where repository_id = ? order by started_at desc, id desc limit ?',
            )
            .all(filter.repositoryId, filter.limit ?? 50)
    );
    return rows.map((row) => Store.executionFrom(row));
  }

  /**
   * A run still marked running when the process starts did not finish under supervision:
   * the previous process ended while it was running. Marks each one crashed and returns
   * the ids; it never claims to know how the command itself ended.
   *
   * @param {string} now
   * @returns {string[]}
   */
  markInterruptedExecutions(now) {
    const ids = /** @type {Array<{ id: string }>} */ (
      this.db.prepare("select id from execution where state = 'running'").all()
    ).map((row) => row.id);
    if (ids.length > 0) {
      this.db
        .prepare(
          "update execution set state = 'crashed', reason = 'the previous AUTOMATE (local) process ended while this run was in progress', finished_at = ? where state = 'running'",
        )
        .run(now);
    }
    return ids;
  }

  /**
   * @param {string} fingerprint
   * @param {string} now
   * @param {string | null} note
   */
  dismissFinding(fingerprint, now, note) {
    this.db
      .prepare(
        'insert into finding_dismissal (fingerprint, dismissed_at, note) values (?, ?, ?) on conflict (fingerprint) do update set dismissed_at = excluded.dismissed_at, note = excluded.note',
      )
      .run(fingerprint, now, note);
  }

  /** @param {string} fingerprint */
  restoreFinding(fingerprint) {
    this.db.prepare('delete from finding_dismissal where fingerprint = ?').run(fingerprint);
  }

  /** @returns {Array<{ fingerprint: string, dismissed_at: string, note: string | null }>} */
  dismissedFindings() {
    return /** @type {any} */ (
      this.db.prepare('select * from finding_dismissal order by fingerprint').all()
    );
  }

  /**
   * @param {string} runId
   * @param {any} run
   */
  insertResults(runId, run) {
    const insertResult = this.db.prepare(
      'insert into test_result (id, run_id, ordinal, name, suite, project, file, file_raw, outcome, flakiness) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insertAttempt = this.db.prepare(
      'insert into attempt (result_id, idx, outcome, raw_status, duration_ms, message, message_truncated) values (?, ?, ?, ?, ?, ?, ?)',
    );
    run.tests.forEach((/** @type {any} */ test, /** @type {number} */ ordinal) => {
      const resultId = digestOf(`${runId}|${String(ordinal)}`);
      insertResult.run(
        resultId,
        runId,
        ordinal,
        test.name,
        test.suite,
        test.project,
        test.file,
        test.fileRaw,
        test.outcome,
        test.flakiness,
      );
      for (const attempt of test.attempts) {
        insertAttempt.run(
          resultId,
          attempt.index,
          attempt.outcome,
          attempt.rawStatus,
          attempt.durationMs,
          attempt.message,
          attempt.messageTruncated ? 1 : 0,
        );
      }
    });
  }

  /**
   * @param {string} sha256
   * @returns {Uint8Array}
   */
  readBlob(sha256) {
    return new Uint8Array(readFileSync(this.blobPath(sha256)));
  }

  /**
   * Re-hashes every stored blob.
   *
   * @returns {Array<{ sha256: string, problem: 'missing' | 'digest-mismatch' }>}
   */
  verify() {
    /** @type {Array<{ sha256: string, problem: 'missing' | 'digest-mismatch' }>} */
    const problems = [];
    const rows = /** @type {Array<{ id: string }>} */ (
      this.db.prepare('select id from artifact').all()
    );
    for (const { id } of rows) {
      if (!existsSync(this.blobPath(id))) problems.push({ sha256: id, problem: 'missing' });
      else if (createHash('sha256').update(this.readBlob(id)).digest('hex') !== id) {
        problems.push({ sha256: id, problem: 'digest-mismatch' });
      }
    }
    return problems;
  }

  /** @returns {string} a stable dump of the derived rows, for equality checks */
  dumpDerived() {
    const tables = ['run', 'test_result', 'attempt', 'coverage'];
    return tables
      .map((table) => {
        const rows = this.db.prepare(`select * from ${table} order by 1, 2`).all();
        return `${table}\n${rows.map((row) => JSON.stringify(row)).join('\n')}`;
      })
      .join('\n--\n');
  }

  /**
   * Drops the derived rows and rebuilds them from the stored blobs alone.
   *
   * @param {string} observedAt
   */
  rebuildDerived(observedAt) {
    const artifacts = /** @type {Array<{ id: string }>} */ (
      this.db.prepare('select id from artifact order by id').all()
    );
    /** @type {Record<string, { observedAt: string, context: object }>} */
    const remembered = {};
    for (const row of /** @type {Array<{ artifact_id: string, observed_at: string, context: string }>} */ (
      this.db
        .prepare('select artifact_id, observed_at, context from run order by observed_at, id')
        .all()
    )) {
      remembered[row.artifact_id] ??= {
        observedAt: row.observed_at,
        context: JSON.parse(row.context),
      };
    }
    this.db.exec('begin immediate');
    try {
      this.db.exec(
        'delete from attempt; delete from test_result; delete from run; delete from coverage;',
      );
      this.db.exec('commit');
    } catch (error) {
      rollbackQuietly(this.db);
      throw error;
    }
    for (const { id } of artifacts) {
      const again = remembered[id];
      this.ingest(this.readBlob(id), {
        observedAt: again?.observedAt ?? observedAt,
        ingestOptions: again?.context ?? {},
      });
    }
  }
}
