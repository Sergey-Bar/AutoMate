import { and, eq, gt, isNull } from 'drizzle-orm';
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
}
