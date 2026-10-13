/**
 * The boundary between the console and anything a tool runs.
 *
 * An agent that acts on a repository is a tool that can do damage, and the damage
 * a bounded token prevents is not exotic: it is a session that outlives the action
 * it was granted for, and is then used to write somewhere it was never meant to
 * reach.
 *
 * So this module owns exactly two things and does neither of them by accident:
 *
 * 1. **What a token grants.** A capability list, and nothing else. No credential,
 *    no bearer token, no path to a secret — a token that carried one would make
 *    this boundary a place secrets sit, and a place secrets sit is a place they
 *    leak from. The console mints a token and hands it to an adapter; the adapter
 *    cannot extract a credential from it because there is not one to extract.
 * 2. **When a token stops being valid.** An absolute expiry and a clock check. A
 *    token with no expiry is a key, and keys outlive the action that needed them.
 *
 * ## Why minting takes the domain
 *
 * `mintSessionToken` is given a `DomainDescriptor` and intersects the requested
 * capabilities with what the domain declares. A caller that asks for something the
 * domain does not have gets `null` rather than a token with that capability in it,
 * because the only alternative is a caller that can widen its own grant by asking.
 *
 * The domains themselves are in `domain.ts`, and they are derived from
 * `AgentDomainSchema` rather than written out a second time — the property this
 * module guards is the same one `agents.ts` guards: one authority for which domains
 * exist. A second list is how the boundary ends up granting capabilities to a
 * domain the contract does not describe.
 */

/** What a domain can be asked to do, declared once and read by the mint. */
export interface DomainDescriptor {
  readonly domain: string;
  /** The capabilities this domain may be granted. Intersected, never extended. */
  readonly capabilities: readonly string[];
  /** A human sentence saying what the domain does, for the error message. */
  readonly description: string;
}

/**
 * A bounded grant, and nothing else.
 *
 * `readonly` on every field, and the object handed out by `mintSessionToken` is
 * frozen, so an adapter cannot widen its own grant by assigning to one. That is a
 * property of the type rather than a convention: `token.capabilities.push(...)`
 * fails at runtime because the array is frozen, and `token.expiresAt = ...` fails
 * to compile.
 */
export interface SessionToken {
  readonly sessionId: string;
  readonly subject: string;
  readonly domain: string;
  readonly capabilities: readonly string[];
  readonly expiresAt: string;
}

/** The clock, so a test can be the one that decides whether a token is usable. */
export type Clock = () => number;

/**
 * The one place a grant is handed out.
 *
 * @param input the request, including the capabilities the caller wants
 * @param descriptor the domain, which is what bounds the request
 * @param clock the time, so the expiry is decided against a clock the caller chose
 * @returns the token, or `null` when the request asks for more than the domain grants
 */
export function mintSessionToken(
  input: {
    sessionId: string;
    subject: string;
    requested: readonly string[];
    ttlMs: number;
  },
  descriptor: DomainDescriptor,
  clock: Clock,
): SessionToken | null {
  if (input.sessionId.trim() === '') return null;
  if (input.subject.trim() === '') return null;
  if (!(input.ttlMs > 0)) return null;
  if (input.requested.length === 0) return null;

  // Fail closed. A request for something the domain does not grant is refused as a
  // whole rather than trimmed, because a caller that discovers its request was
  // quietly trimmed is a caller that will learn to ask for everything.
  const declared = new Set(descriptor.capabilities);
  const wantsTooMuch = input.requested.filter(
    (capability) => !declared.has(capability) || capability === '*',
  );
  if (wantsTooMuch.length > 0) return null;

  const expiresAt = new Date(clock() + input.ttlMs).toISOString();
  return Object.freeze({
    sessionId: input.sessionId,
    subject: input.subject,
    domain: descriptor.domain,
    capabilities: Object.freeze([...new Set(input.requested)]),
    expiresAt,
  });
}

/**
 * Whether a token is still good, against the clock given rather than the wall one.
 *
 * @param token the grant
 * @param clock the time to judge it against
 * @returns `true` only when the token is a minted shape and has not expired
 */
export function isUsable(token: SessionToken, clock: Clock): boolean {
  const expiry = Date.parse(token.expiresAt);
  if (Number.isNaN(expiry)) return false;
  // Expired is expired. A token minted with a negative or zero ttl is refused at
  // the mint, so reaching here means the grant was once real and its time has run
  // out — which is the case a boundary exists to catch.
  return clock() < expiry;
}

/**
 * A narrower token, or none.
 *
 * Narrowing is how an adapter acts on a sub-action without being handed the grant
 * it was given the whole time: an adapter asked to propose a diff gets a token that
 * cannot read a repository, if that capability is not being asked for. Widening is
 * not expressible — there is no function here that takes a token and returns one
 * with more capabilities, which is the property the type is for.
 *
 * @param token the grant to narrow
 * @param capabilities what the narrower grant must be able to do
 * @returns a token holding only the requested capabilities, or `null` if the
 *   original does not grant them
 */
export function narrowTo(
  token: SessionToken,
  capabilities: readonly string[],
): SessionToken | null {
  const held = new Set(token.capabilities);
  if (capabilities.some((capability) => !held.has(capability))) return null;
  return Object.freeze({
    sessionId: token.sessionId,
    subject: token.subject,
    domain: token.domain,
    capabilities: Object.freeze([...new Set(capabilities)]),
    expiresAt: token.expiresAt,
  });
}
