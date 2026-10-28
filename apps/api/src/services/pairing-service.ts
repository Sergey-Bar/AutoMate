import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { pairingCodes } from '@automate/db';
import { z } from 'zod/v4';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { createAccessToken } from './access-service.js';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';

/**
 * Pairing a device with a six-digit code.
 *
 * The alternative an operator has without this is copying a 47-character access token onto
 * a phone. A code is short enough to type and safe because it is short-*lived*: ten minutes,
 * spent on first use, and redeemable only through a rate-limited route (`routes/pairing.ts`).
 * A million values against a budget of a few dozen attempts per window is a guess that does
 * not land.
 *
 * Only an HMAC of the code is stored, keyed with the installation's cookie secret, so a
 * database read does not hand out a pairing that is still live.
 */
type Options = Pick<ProjectRegistryServiceOptions, 'db' | 'workspaceId'> & {
  /** The HMAC key. The composition root passes the cookie secret. */
  pepper: string;
  now?: () => Date;
};

export const PAIRING_TTL_MS = 10 * 60_000;

export const IssuePairingCodeBodySchema = z.object({
  deviceName: z.string().trim().min(1).max(60),
  // Never admin: an admin is the installation key, typed on purpose.
  role: z.enum(['viewer', 'operator']),
});

export const RedeemPairingCodeBodySchema = z.object({ code: z.string().max(12) });

function hashCode(pepper: string, code: string): string {
  return createHmac('sha256', pepper).update(`pairing:${code}`).digest('hex');
}

/**
 * The live codes holding this value, in every workspace. A device has no credential when it
 * pairs, so the default workspace serves its request whichever workspace issued the code; the
 * code's own row says where the token belongs. The pepper is the installation's, so a value
 * hashes alike everywhere, and issuing draws one that no live code holds anywhere.
 */
function liveCodes(options: Options, codeHash: string) {
  const now = options.now?.() ?? new Date();
  return options.db
    .select()
    .from(pairingCodes)
    .where(
      and(
        eq(pairingCodes.codeHash, codeHash),
        isNull(pairingCodes.usedAt),
        gt(pairingCodes.expiresAt, now),
      ),
    );
}

export interface IssuedPairingCode {
  id: string;
  code: string;
  deviceName: string;
  role: 'viewer' | 'operator';
  expiresAt: string;
}

export async function issuePairingCode(
  options: Options,
  body: z.infer<typeof IssuePairingCodeBodySchema>,
  actor: string,
): Promise<IssuedPairingCode> {
  const now = options.now?.() ?? new Date();
  // Draw again in the one-in-a-million case that a live code already holds the value.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = hashCode(options.pepper, code);
    if ((await liveCodes(options, codeHash)).length > 0) continue;
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
    const [row] = await options.db
      .insert(pairingCodes)
      .values({
        workspaceId: options.workspaceId,
        codeHash,
        role: body.role,
        deviceName: body.deviceName,
        createdBy: actor,
        createdAt: now,
        expiresAt,
      })
      .returning({ id: pairingCodes.id });
    return {
      id: (row as { id: string }).id,
      code,
      deviceName: body.deviceName,
      role: body.role,
      expiresAt: expiresAt.toISOString(),
    };
  }
  throw new DomainError(ErrorCode.CONFLICT, 'Could not draw a free pairing code; try again');
}

export interface RedeemedPairing {
  token: string;
  tokenId: string;
  role: 'viewer' | 'operator';
  deviceName: string;
  /** The workspace that issued the code, which the device's token belongs to. */
  workspaceId: string;
}

const refused = (): DomainError =>
  new DomainError(ErrorCode.INVALID_PAIRING_CODE, 'That code is wrong or has expired');

export async function redeemPairingCode(options: Options, code: string): Promise<RedeemedPairing> {
  if (!/^\d{6}$/u.test(code)) throw refused();
  const codeHash = hashCode(options.pepper, code);
  const live = await liveCodes(options, codeHash);
  // Two live codes with one value — issued in two workspaces before issuing checked them all —
  // are refused rather than guessed between: either guess could seat a device in the wrong one.
  const [row] = live;
  if (row === undefined || live.length > 1) throw refused();
  // Equal by construction of the query; compared in constant time anyway, so the one
  // comparison that decides a credential is not the one place that takes a shortcut.
  if (!timingSafeEqual(Buffer.from(row.codeHash), Buffer.from(codeHash))) throw refused();
  const now = options.now?.() ?? new Date();
  // Spend the code first, conditionally: of two devices racing one code, one wins.
  const spent = await options.db
    .update(pairingCodes)
    .set({ usedAt: now })
    .where(and(eq(pairingCodes.id, row.id), isNull(pairingCodes.usedAt)))
    .returning({ id: pairingCodes.id });
  if (spent.length === 0) throw refused();
  const role = row.role as 'viewer' | 'operator';
  const created = await createAccessToken(
    { db: options.db, workspaceId: row.workspaceId },
    { name: `device: ${row.deviceName}`, role },
    `pairing:${row.id}`,
  );
  await options.db
    .update(pairingCodes)
    .set({ tokenId: created.summary.id })
    .where(eq(pairingCodes.id, row.id));
  return {
    token: created.token,
    tokenId: created.summary.id,
    role,
    deviceName: row.deviceName,
    workspaceId: row.workspaceId,
  };
}
