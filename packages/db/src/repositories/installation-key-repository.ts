import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { installationKeys, installations } from '../schema/index.js';
import type { createDbClient } from '../client.js';

type Database = ReturnType<typeof createDbClient>;

export class DrizzleInstallationKeyStore {
  constructor(private readonly db: Database) {}

  async ensureBootstrap(input: {
    installationId: string;
    keyHash: string;
    displayPrefix: string;
  }): Promise<string> {
    await this.db.insert(installations).values({ id: input.installationId }).onConflictDoNothing();
    const existing = await this.db
      .select({ keyHash: installationKeys.keyHash })
      .from(installationKeys)
      .where(eq(installationKeys.installationId, input.installationId))
      .limit(1);
    if (existing[0]) return existing[0].keyHash;
    await this.db.insert(installationKeys).values({
      id: randomUUID(),
      installationId: input.installationId,
      name: 'installation',
      keyHash: input.keyHash,
      displayPrefix: input.displayPrefix,
    });
    return input.keyHash;
  }
}
