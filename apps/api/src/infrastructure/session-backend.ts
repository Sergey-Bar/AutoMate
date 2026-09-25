import { randomUUID } from 'node:crypto';
import type { DrizzleSessionStore } from '@automate/db';
import { hashCredential, type SessionRecord } from '@automate/auth';

export interface AuthSessionBackend {
  issue(installationId: string): Promise<{ token: string; record: SessionRecord }>;
  validate(token: string): Promise<SessionRecord | undefined>;
  revoke(id: string): Promise<boolean>;
}

export class DrizzleAuthSessionBackend implements AuthSessionBackend {
  constructor(
    private readonly store: DrizzleSessionStore,
    private readonly cookieSecret: string,
    private readonly ttlMs: number,
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
}
