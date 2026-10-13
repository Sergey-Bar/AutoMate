import { randomUUID } from 'node:crypto';
import { asc, and, eq, inArray, type SQL } from 'drizzle-orm';
import { artifacts, runs } from '@automate/db';
import { ARTIFACT_BYTE_CAPACITY, BoundedByteMap } from './bounded-map.js';
import {
  digest,
  mapArtifact,
  nowDate,
  rowValue,
  type AnyPgDb,
  type DrizzleExecutionStoreOptions,
} from './drizzle-execution-store-rows.js';
import type { ArtifactDescriptor, StoredArtifact } from './types.js';

/**
 * Artifact bytes and the rows that describe them.
 *
 * The two halves are deliberately asymmetric. The row is authoritative about
 * *what* an artifact is and is only ever written after the bytes exist, because
 * the checksum and the size the row carries are not knowable until they do. The
 * bytes are best-effort in the other direction: a process that dies between the
 * `put` and the insert leaves an orphan, and the only compensation available in
 * that window is a log line.
 *
 * `memoryBytes` is the in-process fallback and is bounded by **total bytes**
 * rather than by entry count — a thousand screenshots and a thousand log lines
 * are not the same pressure on a process, and an entry-count bound would charge
 * them as if they were.
 */
export class DrizzleExecutionArtifacts {
  private readonly db: AnyPgDb;
  private readonly options: DrizzleExecutionStoreOptions;

  /** Bounded: the in-process artifact fallback, by total bytes, not by entry count. */
  private readonly memoryBytes = new BoundedByteMap<string>(ARTIFACT_BYTE_CAPACITY);

  constructor(options: DrizzleExecutionStoreOptions) {
    this.db = options.db;
    this.options = options;
  }

  async addArtifact(
    input: Omit<StoredArtifact, 'id' | 'checksum' | 'sizeBytes' | 'createdAt'> & {
      bytes: Uint8Array;
    },
  ): Promise<ArtifactDescriptor> {
    const bytes = new Uint8Array(input.bytes);
    const checksum = digest(bytes);
    // The bytes go first because the row needs the checksum and the size, which are
    // only knowable once the bytes exist. That ordering is why a failure between the
    // two needs undoing: the object would otherwise sit in the store with nothing
    // referencing it, and the in-memory bound would charge it to the budget for the
    // life of the process.
    if (this.options.artifactBytes) await this.options.artifactBytes.put(input.storageKey, bytes);
    else this.memoryBytes.set(input.storageKey, bytes);
    const row = {
      id: randomUUID(),
      runId: input.runId,
      jobId: input.jobId,
      testId: input.testId,
      kind: input.kind,
      name: input.name,
      contentType: input.contentType,
      storageKey: input.storageKey,
      checksum,
      sizeBytes: bytes.byteLength,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      legalHold: input.legalHold,
      metadata: input.metadata,
      createdAt: nowDate(this.options),
    };
    const allowed = [
      'report',
      'junit',
      'json',
      'log',
      'stdout',
      'stderr',
      'screenshot',
      'video',
      'trace',
      'html',
      'attachment',
      'other',
    ] as const;
    const normalizedKind = allowed.includes(row.kind as (typeof allowed)[number])
      ? (row.kind as (typeof allowed)[number])
      : ('other' as const);
    const dbRow = { ...row, kind: normalizedKind };
    try {
      await this.db.insert(artifacts).values(dbRow);
    } catch (failure) {
      // Undo the half of the write that succeeded, then let the original failure
      // through unchanged. Swallowing it here would report a successful artifact
      // whose bytes nothing can reach.
      //
      // **Residual, stated rather than hidden:** this compensates for a *failed*
      // insert. A process that dies between the `put` and the insert still leaves an
      // object behind, and only a `pending → committed` status on the row would close
      // that window — a migration plus a sweeper, which is the other option this item
      // offered. The in-process failure was the common case and is now covered; the
      // crash window is not, and the log line is the only record of it.
      await this.discardBytes(input.storageKey);
      throw failure;
    }
    return mapArtifact(dbRow);
  }

  /**
   * Removes bytes written for an artifact that never got a row, and never masks the
   * failure that led here.
   *
   * The compensation is best-effort by design: the caller is already propagating a
   * database error, and replacing it with "and the cleanup also failed" would report
   * a storage fault as a database one. The cleanup failure is logged with the key, so
   * the object is at least findable.
   */
  private async discardBytes(storageKey: string): Promise<void> {
    try {
      if (this.options.artifactBytes) {
        await this.options.artifactBytes.delete(storageKey);
      } else {
        this.memoryBytes.delete(storageKey);
      }
    } catch (error) {
      console.error('artifact cleanup failed after a failed insert', {
        storageKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getArtifact(artifactId: string, workspaceId?: string): Promise<StoredArtifact | null> {
    const descriptor = await this.getArtifactDescriptor(artifactId, workspaceId);
    if (!descriptor) return null;
    // The row's checksum is the only statement of what these bytes were, and this is
    // the only place the row and the bytes are both in hand. Checking here rather than
    // in the store is deliberate: the store holds a storage key and nothing else, so a
    // check it cannot be given the digest is a check that cannot run — which is how the
    // digest comparison ended up on a method no production path called.
    const bytes = this.options.artifactBytes
      ? await this.options.artifactBytes.get(descriptor.storageKey, descriptor.checksum)
      : this.memoryBytes.get(descriptor.storageKey);
    return bytes ? { ...descriptor, bytes: new Uint8Array(bytes) } : null;
  }

  async getArtifactDescriptor(
    artifactId: string,
    workspaceId?: string,
  ): Promise<ArtifactDescriptor | null> {
    // `artifacts` has no workspace column of its own, so the scope is the
    // artifact's run. A run with a NULL workspace_id never matches.
    let scope: SQL | undefined = eq(artifacts.id, artifactId);
    if (workspaceId !== undefined) {
      scope = and(
        scope,
        // Bounded: a subquery, not a list — PostgreSQL plans it and its size is the table's
        inArray(
          artifacts.runId,
          this.db.select({ id: runs.id }).from(runs).where(eq(runs.workspaceId, workspaceId)),
        ),
      );
    }
    const row = (await this.db.select().from(artifacts).where(scope).limit(1))[0];
    return row ? mapArtifact(rowValue(row)) : null;
  }

  async listArtifacts(workspaceId: string, runId: string): Promise<ArtifactDescriptor[]> {
    // `artifacts` has no `workspace_id`, so the constraint is the join through
    // `runs`. Required, for the same reason as `listEvents`.
    const rows = await this.db
      .select({ artifact: artifacts })
      .from(artifacts)
      .innerJoin(runs, eq(runs.id, artifacts.runId))
      .where(and(eq(artifacts.runId, runId), eq(runs.workspaceId, workspaceId)))
      .orderBy(asc(artifacts.createdAt));
    return rows.map((row) => mapArtifact(rowValue(row.artifact)));
  }
}
