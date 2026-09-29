import { randomUUID } from 'node:crypto';
import type { DrizzleSessionStore } from '@automate/db';
import { hashCredential, type SessionRecord } from '@automate/auth';

export interface AuthSessionBackend {
  issue(installationId: string): Promise<{ token: string; record: SessionRecord }>;
  validate(token: string): Promise<SessionRecord | undefined>;
  revoke(id: string): Promise<boolean>;
  /**
   * Removes sessions that have outlived their retention window.
   *
   * **Ledger S-2 and S-6, the durable half.** The in-memory service grew without
   * bound because nothing removed anything; the durable store had the same shape,
   * because `revoke` is an `UPDATE … SET revoked_at` and there was no `DELETE` on
   * `sessions` anywhere in the repository.
   *
   * Optional on the interface, and that is a real gap rather than a convenience: an
   * optional member is a member a backend can forget, and a backend that forgets it
   * is the defect again. It is optional only so the *existing* backends and their tests
   * do not all have to grow a method in one change; `sweepSessions` in
   * `routes/auth.ts` is where the schedule lives, and this is the seam it calls.
   */
  sweep?(): Promise<{ removed: number }>;
}

export class DrizzleAuthSessionBackend implements AuthSessionBackend {
  constructor(
    private readonly store: DrizzleSessionStore,
    private readonly cookieSecret: string,
    private readonly ttlMs: number,
    private readonly retentionMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(installationId: string): Promise<{ token: string; record: SessionRecord }> {
    const token = randomUUID() + randomUUID();
    const issuedAt = this.now();
    const record: SessionRecord = {
      id: randomUUID(),
      tokenHash: hashCredential(this.cookieSecret, token),
      installationId,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + this.ttlMs),
    };
    await this.store.ensureInstallation(installationId);
    await this.store.create({
      id: record.id,
      installationId,
      tokenHash: record.tokenHash,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
    });
    return { token, record };
  }

  async validate(token: string): Promise<SessionRecord | undefined> {
    const row = await this.store.findValid(hashCredential(this.cookieSecret, token), this.now());
    if (!row) return undefined;
    return {
      id: row.id,
      tokenHash: row.tokenHash,
      installationId: row.installationId,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt ?? undefined,
    };
  }

  async revoke(id: string): Promise<boolean> {
    return this.store.revoke(id, this.now());
  }

  /**
   * Deletes sessions past the retention window — `SESSION_RETENTION_DAYS`, which was
   * parsed and mapped and read by nothing until this.
   *
   * The window is deliberately *longer* than the TTL. A session stops being valid at
   * `expiresAt`; it stays in the table until the retention window closes so that the
   * question "was this ever a valid session" still has an answer. Deleting at
   * `expiresAt` would make that unanswerable, which is the same reason `revoke` marks
   * rather than deletes.
   */
  async sweep(): Promise<{ removed: number }> {
    const cutoff = new Date(this.now().getTime() - this.retentionMs);
    return { removed: await this.store.deleteExpired(cutoff) };
  }
}
