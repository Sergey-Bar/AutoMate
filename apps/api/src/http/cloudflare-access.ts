import type { JsonWebKey } from 'node:crypto';
import type { Context } from 'hono';
import { verify } from 'hono/jwt';
import type { CloudflareAccessConfig } from '@automate/config';
import type { Caller } from '../services/access-service.js';
import { roleForIdentity } from './role-map.js';

/**
 * Verifies the `Cf-Access-Jwt-Assertion` header Cloudflare Access adds to every request it
 * lets through to an application (ADR-014).
 *
 * **Why the header is not simply trusted.** A tunnel delivers Cloudflare's traffic to the
 * edge, but anything else that can reach the edge — a LAN client, another container — can
 * send the same header. The header is a claim; the signature is the proof. So every request
 * is verified against the team's published keys, for this application's audience, and a
 * request that fails is treated as carrying no Cloudflare identity at all.
 *
 * What is checked, and why each:
 *
 * - `alg` is exactly `RS256`, which is what Access signs with. Anything else — `none`, a
 *   symmetric algorithm whose "key" would be the public key, another asymmetric scheme — is
 *   refused before a key is fetched, so a hostile header cannot make this process fetch.
 * - the key is the team's, found by `kid` in `https://<team>/cdn-cgi/access/certs`;
 * - `iss` is the team, so a token from another Access team does not pass;
 * - `aud` contains this application's audience tag, so a token for another application of
 *   the same team does not pass;
 * - `exp` is present and in the future, and `nbf`/`iat` are not in the future.
 *
 * **The key set is cached** for `cacheTtlMs`, and an unknown `kid` refetches it — Cloudflare
 * rotates its keys — but at most once per `minRefetchMs`, so a stream of invented key ids
 * is a stream of refusals and not a stream of outbound requests.
 */
export interface CloudflareAccessSettings {
  /** `<team>.cloudflareaccess.com`, as `normalizeCloudflareTeamDomain` returns it. */
  teamDomain: string;
  /** The application's audience (AUD) tag, from the Access application's overview. */
  audience: string;
}

export interface CloudflareIdentity {
  /** Access's user id. Empty for a service token, which has no user. */
  subject: string;
  email: string | null;
  /** The service token's client id (`common_name`), when a machine presented one. */
  serviceTokenId: string | null;
  /** Groups the identity provider forwarded as a claim, if it was configured to. */
  groups: string[];
}

export type CloudflareVerification =
  { ok: true; identity: CloudflareIdentity } | { ok: false; reason: string };

export interface CloudflareAccessVerifier {
  verify(token: string): Promise<CloudflareVerification>;
}

export interface CloudflareAccessOptions {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** How long a fetched key set is used before it is fetched again. */
  cacheTtlMs?: number;
  /** The shortest gap between two fetches triggered by an unknown `kid`. */
  minRefetchMs?: number;
  /** The deadline on one key-set fetch. */
  timeoutMs?: number;
}

interface PublishedKey extends JsonWebKey {
  kid?: string;
}

function decodePart(part: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function identityOf(payload: Record<string, unknown>): CloudflareIdentity {
  const custom = payload['custom'];
  const customGroups =
    typeof custom === 'object' && custom !== null
      ? (custom as Record<string, unknown>)['groups']
      : undefined;
  const email = payload['email'];
  const commonName = payload['common_name'];
  return {
    subject: typeof payload['sub'] === 'string' ? payload['sub'] : '',
    email: typeof email === 'string' && email !== '' ? email : null,
    serviceTokenId: typeof commonName === 'string' && commonName !== '' ? commonName : null,
    groups: stringList(payload['groups']).length
      ? stringList(payload['groups'])
      : stringList(customGroups),
  };
}

/** What a failed verification says, from the class hono's verifier threw. */
function reasonFor(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const reasons: Record<string, string> = {
    JwtTokenExpired: 'the token has expired',
    JwtTokenNotBefore: 'the token is not valid yet',
    JwtTokenIssuedAt: 'the token is not valid yet',
    JwtTokenIssuer: 'the token was issued by another issuer',
    JwtTokenAudience: 'the token is for another audience',
    JwtPayloadRequiresAud: 'the token names no audience',
    JwtTokenSignatureMismatched: 'the signature does not verify',
  };
  return reasons[name] ?? `the token does not verify (${name || 'unknown error'})`;
}

export function createCloudflareAccessVerifier(
  settings: CloudflareAccessSettings,
  options: CloudflareAccessOptions = {},
): CloudflareAccessVerifier {
  const issuer = `https://${settings.teamDomain}`;
  const certs = `${issuer}/cdn-cgi/access/certs`;
  const fetchKeys = options.fetch ?? ((input, init) => fetch(input, init));
  const cacheTtlMs = options.cacheTtlMs ?? 10 * 60_000;
  const minRefetchMs = options.minRefetchMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 5_000;

  let keys = new Map<string, PublishedKey>();
  let fetchedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<string | null> | null = null;

  /** Fetches the key set. Resolves to a reason on failure, `null` on success. */
  const refresh = (): Promise<string | null> => {
    inFlight ??= (async (): Promise<string | null> => {
      fetchedAt = Date.now();
      try {
        const response = await fetchKeys(certs, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) {
          return `the Access key set answered ${String(response.status)}`;
        }
        const body = (await response.json()) as { keys?: unknown };
        const published = Array.isArray(body.keys) ? (body.keys as PublishedKey[]) : [];
        keys = new Map(
          published
            .filter((key) => typeof key.kid === 'string' && key.kty === 'RSA')
            .map((key) => [String(key.kid), key]),
        );
        return null;
      } catch (error) {
        return `the Access key set could not be fetched (${error instanceof Error ? error.name : 'error'})`;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const keyFor = async (kid: string): Promise<PublishedKey | string> => {
    const age = Date.now() - fetchedAt;
    const known = keys.get(kid);
    if (known !== undefined && age < cacheTtlMs) return known;
    if (known !== undefined || age >= minRefetchMs) {
      const failure = await refresh();
      if (failure !== null) return failure;
    }
    return keys.get(kid) ?? `no published Access key has the id ${JSON.stringify(kid)}`;
  };

  return {
    async verify(token) {
      const parts = token.split('.');
      if (parts.length !== 3 || parts[0] === '' || parts[1] === '') {
        return { ok: false, reason: 'the header is not a JWT' };
      }
      const header = decodePart(parts[0] ?? '');
      const payload = decodePart(parts[1] ?? '');
      if (header === null || payload === null) {
        return { ok: false, reason: 'the header is not a JWT' };
      }
      if (header['alg'] !== 'RS256') {
        return { ok: false, reason: 'Cloudflare Access signs with RS256 and nothing else' };
      }
      if (typeof header['kid'] !== 'string' || header['kid'] === '') {
        return { ok: false, reason: 'the token names no signing key' };
      }
      if (typeof payload['exp'] !== 'number') {
        return { ok: false, reason: 'the token has no expiry' };
      }
      const key = await keyFor(header['kid']);
      if (typeof key === 'string') return { ok: false, reason: key };
      try {
        const verified = await verify(token, key, {
          alg: 'RS256',
          iss: issuer,
          aud: settings.audience,
        });
        return { ok: true, identity: identityOf(verified as Record<string, unknown>) };
      } catch (error) {
        return { ok: false, reason: reasonFor(error) };
      }
    },
  };
}

/** How an Access identity reads in the audit trail: a person by email, a machine by client id. */
export function cloudflareActor(identity: CloudflareIdentity): string {
  if (identity.serviceTokenId !== null) return `cf-service:${identity.serviceTokenId}`;
  return `cf:${identity.email ?? identity.subject}`;
}

export const CF_ACCESS_HEADER = 'cf-access-jwt-assertion';

export type AccessLog = (message: string, fields: Record<string, unknown>) => void;

/**
 * The verified Access identity on this request, or `null` when it carries none. A header that
 * does not verify is `null` too, and is logged with the reason and never the token.
 */
export async function verifiedIdentity(
  verifier: CloudflareAccessVerifier,
  context: Context,
  log?: AccessLog,
): Promise<CloudflareIdentity | null> {
  const token = context.req.header(CF_ACCESS_HEADER);
  if (token === undefined || token === '') return null;
  const result = await verifier.verify(token);
  if (result.ok) return result.identity;
  log?.('cloudflare access refused a request', { reason: result.reason, path: context.req.path });
  return null;
}

/** A person, as opposed to a machine: an Access user with an email, not a service token. */
export function isPerson(identity: CloudflareIdentity): boolean {
  return identity.serviceTokenId === null && identity.email !== null && identity.subject !== '';
}

/** An identity read through the role map alone: a machine everywhere, a person on `startup`. */
export function roleMapCaller(
  identity: CloudflareIdentity,
  access: CloudflareAccessConfig,
): Caller {
  return {
    actor: cloudflareActor(identity),
    role: roleForIdentity(identity, access),
    uploaderFor: null,
  };
}

/**
 * The remote credential source `callerOf` asks after a token: the verified Access identity
 * on this request, with its mapped role, or `null`.
 *
 * An identity Access let in and the map gives no role is still returned, with `role: null`,
 * so the guards answer *forbidden* — the person is known, and not allowed — rather than
 * asking them to sign in again. A header that does not verify is `null`, and is logged with
 * the reason and never the token.
 */
export function createCloudflareCallerSource(
  verifier: CloudflareAccessVerifier,
  access: CloudflareAccessConfig,
  options: { log?: AccessLog } = {},
): (context: Context) => Promise<Caller | null> {
  return async (context) => {
    const identity = await verifiedIdentity(verifier, context, options.log);
    return identity === null ? null : roleMapCaller(identity, access);
  };
}
