import { describe, expect, it } from 'vitest';
import type { Context } from 'hono';
import { registrationAuthorized } from './shared.js';

/**
 * `registrationAuthorized` decides whether an unauthenticated caller can register a
 * runner. A runner that registers can claim jobs, so this is the unauthenticated write
 * on the whole execution path.
 *
 * The rule it had was `secret === undefined → NODE_ENV !== 'production'`, which fails
 * open everywhere that is not production. The environments below are the ones that
 * mattered and nobody noticed: staging, development, a preview deployment for a pull
 * request, and any `NODE_ENV` a host had not heard of — which is the state every new
 * environment is in before someone has configured it.
 */

/** The only part of a Hono context `registrationAuthorized` reads. */
function contextWith(headers: Record<string, string> = {}): Context {
  return { req: { header: (name: string) => headers[name] } } as unknown as Context;
}

describe('registrationAuthorized', () => {
  it('allows registration in test when no secret is configured', () => {
    // The only environment where an absent secret is a fixture rather than a
    // deployment, and the existing suites depend on it.
    expect(registrationAuthorized(contextWith(), undefined, 'test')).toBe(true);
  });

  for (const [environment, why] of [
    ['staging', 'a staging deployment with no secret configured'],
    ['development', 'a development host with no secret configured'],
    ['preview', 'a preview deployment for a pull request'],
    ['production', 'production, the one case the old rule did catch'],
  ] as const) {
    it(`refuses in ${environment} when no secret is configured, because ${why}`, () => {
      expect(registrationAuthorized(contextWith(), undefined, environment)).toBe(false);
    });
  }

  it('refuses when the process has no NODE_ENV at all', () => {
    // The case an allow-by-exception rule always gets wrong: a process with no
    // NODE_ENV, which is what a bare `node dist/index.js` looks like. The old code
    // read `undefined !== 'production'` and allowed it.
    //
    // `registrationAuthorized` defaults its third argument from the environment, so
    // passing `undefined` explicitly would just re-read the same value — Vitest sets
    // `NODE_ENV=test`. The ambient variable is removed instead, which is the situation
    // being described.
    const ambient = process.env['NODE_ENV'];
    delete process.env['NODE_ENV'];
    try {
      expect(registrationAuthorized(contextWith(), undefined)).toBe(false);
    } finally {
      if (ambient !== undefined) process.env['NODE_ENV'] = ambient;
    }
  });

  it('refuses on an environment name it has never seen', () => {
    expect(registrationAuthorized(contextWith(), undefined, 'prod-eu-west-1')).toBe(false);
  });

  it('matches the test environment exactly, not by prefix', () => {
    // `'test-eu'` is not `'test'`, and a rule that allowed anything starting with
    // `test` would be a rule with a hole in it shaped like a flag.
    expect(registrationAuthorized(contextWith(), undefined, 'test-eu')).toBe(false);
    expect(registrationAuthorized(contextWith(), undefined, 'testing')).toBe(false);
  });

  it('still requires the secret when one is configured, in every environment', () => {
    for (const environment of ['test', 'development', 'staging', 'production']) {
      expect(registrationAuthorized(contextWith(), 'the-secret', environment)).toBe(false);
    }
    expect(
      registrationAuthorized(
        contextWith({ 'x-runner-registration-secret': 'the-secret' }),
        'the-secret',
        'production',
      ),
    ).toBe(true);
  });
});
