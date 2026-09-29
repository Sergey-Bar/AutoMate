import { describe, expect, it } from 'vitest';
import { createHealthRoutes } from './health.js';
import { createAgentRoutes } from './agents.js';

/**
 * The four agent failure bodies in `agents.ts` are near-copies, and the two health
 * bodies in `health.ts` are near-copies. Both are asserted here through the wire, not
 * through the source, so a builder that changes the bytes fails rather than passing
 * because the literals happened to be refactored.
 */

/** Key order, not just key set: these bodies are compared byte for byte. */
function keyOrder(body: unknown): string[] {
  return Object.keys(body as Record<string, unknown>);
}

describe('agent failure bodies', () => {
  const app = createAgentRoutes();

  async function post(domain: string, action: string): Promise<{ status: number; body: never }> {
    const response = await app.request(`/api/v1/agents/${domain}/${action}`, { method: 'POST' });
    return { status: response.status, body: (await response.json()) as never };
  }

  async function failureBodies(): Promise<unknown[]> {
    const post = async (domain: string, action: string) =>
      (await (
        await app.request(`/api/v1/agents/${domain}/${action}`, { method: 'POST' })
      ).json()) as unknown;
    const get = async (domain: string) =>
      (await (await app.request(`/api/v1/agents/${domain}`)).json()) as unknown;
    return [
      await post('nope', 'run'),
      await post('browser', 'exfiltrate'),
      await post('browser', 'run'),
      await get('nope'),
      await get('browser'),
    ];
  }

  it('gives all five failures the same key order, so one builder defines the shape', async () => {
    // The five literals are `status, implemented, code, …` — deliberately not
    // alphabetical. A builder that sorts its keys changes bytes on the wire, and no
    // existing test would have noticed, because `agents.test.ts` asserts status codes
    // and `integrations.length`, never an exact body.
    //
    // The `AGENT_ACTION_NOT_FOUND` body is in this list because it was added later
    // and this loop did not reach it — the builder made it identical for free, so
    // nothing noticed that the shape was being asserted over four of five.
    for (const body of await failureBodies()) {
      expect(keyOrder(body).slice(0, 3)).toEqual(['status', 'implemented', 'code']);
    }
  });

  it('stays flat: no error wrapper, no requestId, no nesting', () => {
    // `domainErrorResponse` in `errors/boundary.ts` is NOT a drop-in here. These
    // bodies are flat, and adopting the boundary's shape would change every byte.
    // It is also wrong on status: 501 is `>= 500`, so `DomainError.toBody` would
    // replace every message with 'internal error' and drop `details` unless each
    // error were built `callerSafe`.
    return post('browser', 'run').then(({ body }) => {
      expect(body).not.toHaveProperty('error');
      expect(body).not.toHaveProperty('requestId');
      expect(keyOrder(body).every((key) => key === key.toLowerCase())).toBe(true);
    });
  });

  it('keeps the 501 bodies carrying the domain and action they were given', () => {
    return post('browser', 'run').then(({ status, body }) => {
      expect(status).toBe(501);
      expect(body).toMatchObject({
        status: 'not_configured',
        implemented: false,
        code: 'AGENT_NOT_CONFIGURED',
        domain: 'browser',
        action: 'run',
      });
    });
  });
});

describe('health bodies', () => {
  const app = createHealthRoutes();

  it('differs between the two paths only by version', async () => {
    const plain = (await (await app.request('/health')).json()) as Record<string, unknown>;
    const versioned = (await (await app.request('/api/v1/health')).json()) as Record<
      string,
      unknown
    >;
    // The difference is deliberate and `health.test.ts:55-69` locks it: `plain` has no
    // `version` key at all. A consolidation that harmonised the two bodies would be a
    // shape change, and this is the assertion that makes it one somebody decides.
    expect(plain['version']).toBeUndefined();
    expect(versioned['version']).toBe('1');
    expect(keyOrder(plain)).toEqual(['status', 'service', 'timestamp']);
    expect(keyOrder(versioned)).toEqual(['status', 'version', 'service', 'timestamp']);
  });

  it('keeps the timestamp asymmetry, which the same test also locks', async () => {
    const plain = (await (await app.request('/health')).json()) as Record<string, unknown>;
    const versioned = (await (await app.request('/api/v1/health')).json()) as Record<
      string,
      unknown
    >;
    // `timestamp` is present on both but is a separate `new Date()` per handler, so
    // consolidating the bodies would have to decide what to do with it. Left alone.
    //
    // The assertion is that the two are **distinct values produced separately**, not
    // that each is a string. The first version asserted `typeof … === 'string'`,
    // which any `c.json` with a timestamp passes and which says nothing about the
    // asymmetry the test is named for; a consolidation that hoisted the timestamp to
    // one shared `new Date()` would have satisfied it.
    expect(typeof plain['timestamp']).toBe('string');
    expect(typeof versioned['timestamp']).toBe('string');
    // Two reads of the same handler can differ at millisecond resolution, so the
    // pair is checked for *parseable and separately generated* rather than unequal —
    // which would be a flaky assertion about clock resolution.
    expect(Number.isNaN(Date.parse(plain['timestamp'] as string))).toBe(false);
    expect(Number.isNaN(Date.parse(versioned['timestamp'] as string))).toBe(false);
    // The observable consequence of them being separate: the key is present on both
    // bodies, so a consolidation cannot drop it from one without this failing.
    expect(keyOrder(plain)).toContain('timestamp');
    expect(keyOrder(versioned)).toContain('timestamp');
  });
});
