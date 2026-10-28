import { afterEach, describe, expect, it } from 'vitest';
import { pairingCodes } from '@automate/db';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { authenticateToken, listAccessTokens } from './access-service.js';
import { issuePairingCode, redeemPairingCode } from './pairing-service.js';

const PEPPER = 'pairing-test-pepper-that-is-long-enough-1234';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function setup(now = new Date('2026-10-25T12:00:00.000Z')) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  let clock = now;
  const options = {
    db: db as never,
    workspaceId: 'ws-1',
    pepper: PEPPER,
    now: () => clock,
  };
  return {
    db,
    options,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

describe('pairing codes', () => {
  it('issues six digits, stores only a hash, and mints a token of the code’s role once', async () => {
    const { db, options } = await setup();
    const issued = await issuePairingCode(
      options,
      { deviceName: 'Kitchen iPad', role: 'viewer' },
      'session',
    );
    expect(issued.code).toMatch(/^\d{6}$/u);
    expect(
      JSON.stringify(await db.select().from((await import('@automate/db')).pairingCodes)),
    ).not.toContain(issued.code);

    const redeemed = await redeemPairingCode(options, issued.code);
    expect(redeemed.role).toBe('viewer');
    expect(await authenticateToken(options, redeemed.token)).toMatchObject({ role: 'viewer' });
    const tokens = await listAccessTokens(options);
    expect(tokens.map((token) => token.name)).toEqual(['device: Kitchen iPad']);

    await expect(redeemPairingCode(options, issued.code)).rejects.toMatchObject({
      code: 'INVALID_PAIRING_CODE',
    });
  });

  it('refuses a code after ten minutes', async () => {
    const { options, advance } = await setup();
    const issued = await issuePairingCode(
      options,
      { deviceName: 'Laptop', role: 'operator' },
      'session',
    );
    advance(10 * 60_000 + 1);
    await expect(redeemPairingCode(options, issued.code)).rejects.toMatchObject({
      code: 'INVALID_PAIRING_CODE',
    });
  });

  it('a code mints its device token in the workspace that issued it, wherever it is redeemed', async () => {
    // A device has no credential yet, so it is served by the default workspace's routes: the
    // code is found across the installation, and the token is the issuing workspace's.
    const { options } = await setup();
    const issued = await issuePairingCode(
      { ...options, workspaceId: 'ws-2' },
      { deviceName: 'Phone', role: 'viewer' },
      'session',
    );
    const redeemed = await redeemPairingCode(options, issued.code);
    expect(redeemed.workspaceId).toBe('ws-2');
    expect(
      await authenticateToken({ ...options, workspaceId: 'ws-2' }, redeemed.token),
    ).toMatchObject({ role: 'viewer' });
    expect(await authenticateToken(options, redeemed.token)).toBeNull();
    expect(await listAccessTokens(options)).toEqual([]);
  });

  it('refuses a code two workspaces both hold live, rather than guess whose it is', async () => {
    const { db, options } = await setup();
    const issued = await issuePairingCode(
      options,
      { deviceName: 'Phone', role: 'viewer' },
      'session',
    );
    // Issuing draws a value no live code holds anywhere; two from before that rule could.
    const [row] = await db.select().from(pairingCodes);
    const { id: _id, ...copy } = row as typeof pairingCodes.$inferSelect;
    await db.insert(pairingCodes).values({ ...copy, workspaceId: 'ws-2' });
    await expect(redeemPairingCode(options, issued.code)).rejects.toMatchObject({
      code: 'INVALID_PAIRING_CODE',
    });
    const spent = await db.select({ usedAt: pairingCodes.usedAt }).from(pairingCodes);
    expect(spent).toEqual([{ usedAt: null }, { usedAt: null }]);
  });

  it('a revoked device token stops working', async () => {
    const { options } = await setup();
    const issued = await issuePairingCode(
      options,
      { deviceName: 'Old phone', role: 'viewer' },
      'session',
    );
    const redeemed = await redeemPairingCode(options, issued.code);
    const { revokeAccessToken } = await import('./access-service.js');
    await revokeAccessToken(options, redeemed.tokenId);
    expect(await authenticateToken(options, redeemed.token)).toBeNull();
  });

  it('refuses a malformed code before touching the database', async () => {
    const { options } = await setup();
    for (const code of ['12345', '1234567', 'abcdef', '']) {
      await expect(redeemPairingCode(options, code)).rejects.toMatchObject({
        code: 'INVALID_PAIRING_CODE',
      });
    }
  });
});
