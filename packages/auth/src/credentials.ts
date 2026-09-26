import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashCredential(secret: string, credential: string): string {
  return createHmac('sha256', secret).update(credential, 'utf8').digest('hex');
}

export function verifyCredential(
  secret: string,
  credential: string,
  expectedHash: string,
): boolean {
  const actual = Buffer.from(hashCredential(secret, credential), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface SessionRecord {
  id: string;
  tokenHash: string;
  installationId: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
}

export class InMemorySessionService {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    private readonly secret: string,
    private readonly ttlMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  issue(installationId: string): { token: string; record: SessionRecord } {
    const token = createOpaqueToken();
    const issuedAt = this.now();
    const record: SessionRecord = {
      id: randomBytes(16).toString('hex'),
      tokenHash: hashCredential(this.secret, token),
      installationId,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + this.ttlMs),
    };
    this.sessions.set(record.id, record);
    return { token, record };
  }

  validate(token: string): SessionRecord | undefined {
    const record = [...this.sessions.values()].find((candidate) =>
      verifyCredential(this.secret, token, candidate.tokenHash),
    );
    if (!record || record.revokedAt || record.expiresAt <= this.now()) return undefined;
    return record;
  }

  revoke(id: string): boolean {
    const record = this.sessions.get(id);
    if (!record || record.revokedAt) return false;
    record.revokedAt = this.now();
    return true;
  }
}
