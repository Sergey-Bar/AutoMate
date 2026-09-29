import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { installations, sessions } from '../schema/index.js';
import type { createDbClient } from '../client.js';

type Database = ReturnType<typeof createDbClient>;

export class DrizzleSessionStore {
  constructor(private readonly db: Database) {}

  async ensureInstallation(id: string): Promise<void> {
    await this.db.insert(installations).values({ id }).onConflictDoNothing();
  }

  async create(input: {
    id?: string;
    installationId: string;
    tokenHash: string;
    issuedAt: Date;
    expiresAt: Date;
  }): Promise<string> {
    await this.ensureInstallation(input.installationId);
    const id = input.id ?? randomUUID();
    await this.db.insert(sessions).values({
      id,
      installationId: input.installationId,
      tokenHash: input.tokenHash,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
    });
    return id;
  }

  async findValid(tokenHash: string, now: Date) {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async revoke(id: string, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.length > 0;
  }

  /**
   * Deletes sessions issued before `cutoff`, and returns how many went.
   *
   * **Ledger S-2 and S-7.** Nothing in the repository deleted from `sessions`:
   * `revoke` is an `UPDATE … SET revoked_at`, so the table grew with every sign-in
   * for the life of the installation.
   *
   * The cutoff is on `issuedAt`, not `expiresAt`, and the difference is the point:
   * a row is kept past the moment it stops being valid so that "was this ever a
   * valid session" still has an answer. Deleting at `expiresAt` would make that
   * unanswerable, which is the same reason `revoke` marks rather than deletes.
   *
   * Batched by the caller's schedule rather than in SQL, because a sweep that runs
   * hourly and takes one pass over the aged rows is the boring version; the
   * alternative is an unbounded `DELETE` against a table that has been growing for
   * years, which is a long transaction holding locks on a table the request path
   * reads.
   */
  async deleteExpired(cutoff: Date): Promise<number> {
    const removed = await this.db
      .delete(sessions)
      .where(lt(sessions.issuedAt, cutoff))
      .returning({ id: sessions.id });
    return removed.length;
  }
}
