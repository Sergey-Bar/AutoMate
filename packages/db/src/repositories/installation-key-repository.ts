import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { installationKeys, installations } from '../schema/index.js';
import type { createDbClient } from '../client.js';

type Database = ReturnType<typeof createDbClient>;

/** Thrown when the installation's only bootstrap key exists and is no longer usable. */
export class BootstrapKeyUnavailableError extends Error {
  constructor(
    readonly reason: 'revoked' | 'expired',
    readonly installationId: string,
  ) {
    super(
      `The bootstrap key for installation ${installationId} is ${reason}, and no usable ` +
        'key exists. A revoked or expired credential must not be returned to a caller ' +
        'that would then use it to authenticate — this is an operator decision to issue a ' +
        'new one, not something a caller can retry its way out of.',
    );
    this.name = 'BootstrapKeyUnavailableError';
  }
}

/**
 * Why the installation has no usable key, or `null` when it has none at all.
 *
 * Read *without* the usable predicate, so a row that exists but fails it can be
 * inspected. `revoked` is checked first because revocation is the deliberate state and an
 * expiry layered on top of it is the less useful half of the answer.
 */
async function reasonUnusable(
  db: Database,
  installationId: string,
  now: Date = new Date(),
): Promise<'revoked' | 'expired' | null> {
  const rows = await db
    .select({ revokedAt: installationKeys.revokedAt, expiresAt: installationKeys.expiresAt })
    .from(installationKeys)
    .where(eq(installationKeys.installationId, installationId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  if (row.revokedAt !== null && row.revokedAt !== undefined) return 'revoked';
  if (row.expiresAt !== null && row.expiresAt !== undefined && row.expiresAt <= now) {
    return 'expired';
  }
  return null;
}

export class DrizzleInstallationKeyStore {
  constructor(private readonly db: Database) {}

  /**
   * Return the installation's bootstrap key hash, creating one if none exists.
   *
   * Two defects, both fixed here, and the second is the more dangerous because neither
   * produced an error (ledger P-10).
   *
   * **The race.** The previous sequence was a SELECT followed by a bare INSERT, which is
   * two independent statements with nothing between them. Two replicas bootstrapping the
   * same installation at the same time — which is what happens on a rolling restart, and
   * what a second API container does — both saw no key and both tried to insert, and the
   * loser got a raw unique-constraint violation surfaced as a 500. The insert now carries
   * `onConflictDoNothing` and reads back what is actually stored, so the loser of the race
   * reads the winner's row instead of crashing. `returning()` rather than reusing the
   * caller's own `input.keyHash`, because after a conflict the stored hash is the other
   * process's, and returning the input would tell the caller its own value was persisted
   * when it was not.
   *
   * **The revoked key.** The select fetched `keyHash` alone and never looked at
   * `revokedAt`, so a revoked key's hash was handed straight back. A caller that
   * bootstraps with it derives a secret, sends it, and is refused by the API it is
   * bootstrapping — a confusing failure at the worst moment, on the path that exists
   * precisely for recovering access. It now reads `revokedAt` and `expiresAt` and
   * **throws** rather than returning it. Throwing is the point: a revoked bootstrap
   * credential is an operator decision to issue a new one, and a caller cannot retry its
   * way out of it, so the failure is made loud and specific instead of deferred into an
   * authentication round trip.
   *
   * The usable predicate is also what a *new* key must satisfy — a key created with an
   * `expiresAt` in the past is not a working key — so the WHERE clause and the read-back
   * check share one definition rather than two that can drift.
   */
  async ensureBootstrap(input: {
    installationId: string;
    keyHash: string;
    displayPrefix: string;
  }): Promise<string> {
    await this.db.insert(installations).values({ id: input.installationId }).onConflictDoNothing();

    const existing = await this.findUsable(input.installationId);
    if (existing !== null) return existing.keyHash;

    // Usable now, so that the row this inserts is one `findUsable` will accept.
    const inserted = await this.db
      .insert(installationKeys)
      .values({
        id: randomUUID(),
        installationId: input.installationId,
        name: 'installation',
        keyHash: input.keyHash,
        displayPrefix: input.displayPrefix,
      })
      .onConflictDoNothing()
      .returning({ keyHash: installationKeys.keyHash });

    const row = inserted[0];
    // Lost the race: another process inserted first. Read what they wrote, which is the
    // whole point of `onConflictDoNothing` — the loser adopts the winner's row.
    if (row === undefined) {
      const raced = await this.findUsable(input.installationId);
      if (raced !== null) return raced.keyHash;
      // A row exists and it is not usable, so the conflict was against a key we cannot
      // use. Name which failure it actually is rather than assuming "revoked": an
      // operator told to reissue a *revoked* key when the real problem is an expiry
      // window sends someone looking in the wrong place.
      throw new BootstrapKeyUnavailableError(
        (await reasonUnusable(this.db, input.installationId)) ?? 'revoked',
        input.installationId,
      );
    }
    return row.keyHash;
  }

  /**
   * The installation's usable bootstrap key, or `null` when it has none.
   *
   * "Usable" is defined once, here, and used by both the read and the write: not
   * revoked, and either unexpiring or not yet expired. Defining it twice is how the
   * read and the insert end up disagreeing about what a valid key is.
   *
   * @param installationId the installation to look up
   * @param now evaluated against `expiresAt`; injected so the predicate is testable
   */
  private async findUsable(
    installationId: string,
    now: Date = new Date(),
  ): Promise<{ keyHash: string; revokedAt: Date | null; expiresAt: Date | null } | null> {
    const rows = await this.db
      .select({
        keyHash: installationKeys.keyHash,
        revokedAt: installationKeys.revokedAt,
        expiresAt: installationKeys.expiresAt,
      })
      .from(installationKeys)
      .where(
        and(
          eq(installationKeys.installationId, installationId),
          isNull(installationKeys.revokedAt),
          or(isNull(installationKeys.expiresAt), gt(installationKeys.expiresAt, now)),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
