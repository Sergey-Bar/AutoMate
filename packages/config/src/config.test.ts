import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECRET_MIN_LENGTH, apiProxyTarget, isSecretPlaceholder, parseConfig } from './config.js';

/** Long enough to clear the floor, and not a placeholder, so only the check under test fires. */
const long = (character: string): string => character.repeat(SECRET_MIN_LENGTH);

describe('apiProxyTarget', () => {
  // The quick start was broken, and it was broken in the most expensive way a
  // document can be broken: it looked right. `README.md` said to start the API on
  // `PORT=3456`; the web dev proxy hardcoded `http://127.0.0.1:3000`, and
  // `.env.example` and `AGENTS.md` both said `3000`. A reader who followed the
  // README exactly got a dashboard whose every `/api` call went to a port nothing
  // was listening on — with no error, because a failed fetch and a failed login
  // render identically.
  //
  // These make the two numbers the same computation rather than two constants
  // somebody has to keep in agreement by hand.

  it('is derived from the same PORT the API reads', () => {
    expect(apiProxyTarget({ PORT: '3456' })).toBe(
      `http://127.0.0.1:${String(parseConfig({ PORT: '3456' }).port)}`,
    );
  });

  it('agrees with the API default without restating it', () => {
    // The assertion that closes the defect. `parseConfig({})` takes the schema
    // default; `apiProxyTarget({})` must reach the same number from the same
    // source, or the two drift the next time either one changes.
    expect(apiProxyTarget({})).toBe(`http://127.0.0.1:${String(parseConfig({}).port)}`);
  });

  it('agrees with the API about which ports are usable, at the boundaries', () => {
    // Both read the same `PORT_SCHEMA`, and this is what makes that a fact rather
    // than a claim: every boundary is asserted against `parseConfig` itself, so
    // widening the schema without widening the proxy (or the reverse) fails here.
    for (const value of ['0', '1', '3000', '65535', '65536', '3000.5', '-1', 'abc', '']) {
      let apiPort: number;
      try {
        apiPort = parseConfig({ PORT: value }).port;
      } catch {
        // The API refuses this port outright, so the proxy must not use it either.
        expect(apiProxyTarget({ PORT: value })).toBe('http://127.0.0.1:3000');
        continue;
      }
      expect(apiProxyTarget({ PORT: value })).toBe(`http://127.0.0.1:${String(apiPort)}`);
    }
  });

  it('falls back to the default rather than to an unusable URL', () => {
    // An unset, empty, or non-numeric PORT must not produce `:NaN` or
    // `:undefined`, which fail at request time with a DNS-shaped error rather
    // than a configuration one.
    for (const value of [undefined, '', 'not-a-port']) {
      expect(apiProxyTarget({ PORT: value })).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    }
  });

  it('refuses a HOST that would move the proxy somewhere else', () => {
    // The one path that can send traffic somewhere unintended, and it was
    // interpolating `HOST` into a URL authority with no validation at all.
    //
    // `HOST=127.0.0.1:3000@evil.example.com` parses as a URL whose real host is
    // `evil.example.com`, so every `/api` request — including the login body
    // carrying `AUTOMATE_API_KEY` — would be proxied off-box, with a proxy target
    // that still *looks* like loopback in a log. Anything that is not a plain
    // host or IP literal is refused and falls back to the default.
    for (const value of [
      '127.0.0.1:3000@evil.example.com',
      'evil.example.com/path',
      'a b c',
      'host#fragment',
      'host?query=1',
      'user@host',
    ]) {
      expect(apiProxyTarget({ HOST: value })).toBe('http://127.0.0.1:3000');
    }
  });

  it('brackets an IPv6 literal so the URL authority stays parseable', () => {
    // A bare `::1` in an authority is not a URL — the first colon reads as the
    // port separator. Bracketed, it is.
    expect(apiProxyTarget({ HOST: '::1' })).toBe('http://[::1]:3000');
    expect(apiProxyTarget({ HOST: '0.0.0.0' })).toBe('http://0.0.0.0:3000');
  });

  it('honours a bind address, and falls back only for a blank one', () => {
    // `HOST=0.0.0.0` is a bind address the API is genuinely reachable on, so
    // proxying there is correct. A blank or absent one is not a host, and
    // substituting it would send the proxy to a literal `:0.0.0.0` authority.
    expect(apiProxyTarget({ HOST: '' })).toBe('http://127.0.0.1:3000');
    expect(apiProxyTarget({ HOST: '   ' })).toBe('http://127.0.0.1:3000');
    expect(apiProxyTarget({ HOST: 'localhost' })).toBe('http://localhost:3000');
  });

  it('refuses a HOST whose first or last character is not alphanumeric', () => {
    // The character set and the boundary rule are two different checks, and a
    // single regex with a nested quantifier merges them — which is both the shape
    // the security rule flags and the shape that made the original ambiguous.
    // `.local` and `host-` pass the character check and must still be refused.
    for (const value of ['.example.com', 'example.com.', '-host', 'host-', '_host', 'host_']) {
      expect(apiProxyTarget({ HOST: value })).toBe('http://127.0.0.1:3000');
    }
    // And an already-bracketed literal is accepted in its URL form, not
    // re-bracketed into `[[::1]]`.
    expect(apiProxyTarget({ HOST: '[::1]' })).toBe('http://[::1]:3000');
  });

  it('is what the web dev proxy actually uses', () => {
    // The fix rests on this. A hardcoded number in `apps/web/vite.config.ts` is
    // exactly what let the README and the running system disagree while each was
    // green in its own gate.
    const source = readFileSync(
      path.join(import.meta.dirname, '..', '..', '..', 'apps', 'web', 'vite.config.ts'),
      'utf8',
    );
    // Matched as a *call*, not as a name: a comment mentioning `apiProxyTarget`
    // would satisfy a substring check while the config went on using a literal.
    expect(source).toMatch(/target:\s*apiProxyTarget\(/);
    // Any URL literal, not only a loopback one. `http://localhost:3000` and
    // `http://0.0.0.0:3000` reintroduce exactly the same drift.
    expect(source).not.toMatch(/target:\s*['"`]http/);
  });
});

describe('the documented quick start', () => {
  const readme = readFileSync(
    path.join(import.meta.dirname, '..', '..', '..', 'README.md'),
    'utf8',
  );

  it('does not send the reader to a port of its own', () => {
    // Deriving the proxy is not enough if the document still overrides the port,
    // so this fails the moment a `PORT=` line reappears in the quick start.
    //
    // Whitespace-tolerant on purpose. The README's own PowerShell block spells
    // every other variable `$env:NAME='value'`, so `/PORT=/` would not match a
    // re-introduction written `$env:PORT = '3456'` — which is the most likely
    // way it comes back, and the one that would silently un-fix the defect.
    expect(readme).not.toMatch(/PORT\s*=\s*['"`]?\d+/i);
  });

  it('signs in with the key it tells the reader to set', () => {
    // The other half of the broken quick start: it set
    // `AUTOMATE_API_KEY=local-installation-key-32-characters` and then said to
    // sign in with `local-installation-key`, which is a different string and
    // cannot authenticate — `verifyCredential` compares the whole value.
    const assigned = /AUTOMATE_API_KEY=['"]?([A-Za-z0-9-]+)['"]?/.exec(readme);
    expect(assigned).not.toBeNull();
    const value = assigned?.[1] ?? '';
    expect(readme).toContain(`Sign in with \`${value}\``);
    // And it has to clear the floor `packages/config` enforces, or the API
    // refuses to start on the documented path with an error naming a secret
    // rather than a port.
    expect(value.length).toBeGreaterThanOrEqual(SECRET_MIN_LENGTH);
    // This asserts the documented value *matches* the documented instruction. It
    // deliberately does not assert that a working key stays published — that is a
    // product decision about the sample, and freezing it here would make a
    // credential-lifetime change fail an unrelated port test.
  });
});

describe('parseConfig', () => {
  it('uses COOKIE_SECRET before the compatibility alias', () => {
    const config = parseConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/automate',
      COOKIE_SECRET: long('c'),
      SESSION_SECRET: long('s'),
      VAULT_SECRET: long('v'),
    });
    expect(config.cookieSecret).toBe(long('c'));
  });

  it('treats empty optional development values as absent', () => {
    const config = parseConfig({ DATABASE_URL: '', COOKIE_SECRET: '' });
    expect(config.databaseUrl).toBeUndefined();
    expect(config.cookieSecret).toContain('development');
  });

  it('fails production startup without required secrets', () => {
    expect(() => parseConfig({ NODE_ENV: 'production' })).toThrow('COOKIE_SECRET');
  });

  it('validates ports, URLs, and production vault requirements', () => {
    expect(() => parseConfig({ PORT: '70000' })).toThrow();
    expect(() => parseConfig({ DATABASE_URL: 'not-a-url' })).toThrow();
    expect(() =>
      parseConfig({
        NODE_ENV: 'production',
        COOKIE_SECRET: long('c'),
        DATABASE_URL: 'postgresql://localhost/db',
      }),
    ).toThrow('VAULT_SECRET');
  });

  it('rejects a Kilo URL without an API key', () => {
    expect(() => parseConfig({ KILO_GATEWAY_URL: 'https://kilo.example' })).toThrow('KILO_API_KEY');
  });
});

/**
 * One floor, and the placeholder check ahead of the length check.
 *
 * These are the two halves of finding P-6, and the second one is the half that only
 * shows up at a raised floor: at 16 characters a 9-character `change-me` was reported
 * as *too small*, and an operator told their secret is too small has no way to know
 * the real problem is that they copied the example. Zod collects both issues, so the
 * placeholder is now always among them.
 */
describe('the secret floor', () => {
  /**
   * Every floored variable, paired with the key it lands under in a parsed config.
   *
   * A parallel pair rather than two lists, because the two have to be the same length and
   * the same order for the case below to mean anything. Written as a ternary chain it was
   * seven nested branches whose only job was a lookup, and it read as if the mapping were
   * a rule rather than a naming convention.
   */
  const VARIABLES = [
    ['COOKIE_SECRET', 'cookieSecret'],
    ['SESSION_SECRET', 'sessionSecret'],
    ['VAULT_SECRET', 'vaultSecret'],
    ['AUTOMATE_API_KEY', 'installationApiKey'],
    ['REPORTER_SECRET', 'reporterSecret'],
    ['RUNNER_REGISTRATION_SECRET', 'runnerRegistrationSecret'],
    ['KILO_API_KEY', 'kiloApiKey'],
  ] as const satisfies ReadonlyArray<readonly [string, keyof ReturnType<typeof parseConfig>]>;

  it.each(VARIABLES)('%s is refused one character below the floor', (variable, key) => {
    // One below, and long enough to be unambiguously a length problem: at this width
    // the value cannot be a placeholder, so only the floor can be the reason.
    expect(() => parseConfig({ [variable]: 'x'.repeat(SECRET_MIN_LENGTH - 1) })).toThrow();
    expect(parseConfig({ [variable]: 'x'.repeat(SECRET_MIN_LENGTH) })[key]).toBeDefined();
  });

  it('names a short placeholder as a placeholder, not as a length problem', () => {
    // The regression this exists for. `change-me` is 9 characters, so at a 32 floor
    // the length check fires first — and before the re-ordering, the message an
    // operator got named a number and not the mistake.
    const error = captureError({ REPORTER_SECRET: 'change-me' });
    expect(error).toContain('REPORTER_SECRET must not be a placeholder');
  });

  it('names the cookie secret placeholder even though it is long enough to pass', () => {
    // The other direction: a value that satisfies the floor and is still not a secret.
    // A floor that is the only check would accept it.
    const error = captureError({ COOKIE_SECRET: 'development-only-cookie-secret-32-chars' });
    expect(error).toContain('COOKIE_SECRET must not be a placeholder');
  });

  it('accepts a documented example value, which is not a placeholder', () => {
    // The counterweight, and the reason the check is not a substring match. The
    // quickstart values in `README.md` are 30-plus characters and contain
    // `change-me`; a check that refused any value containing it would refuse a
    // working configuration in order to catch a broken one.
    expect(() =>
      parseConfig({ REPORTER_SECRET: 'replace-with-a-reporter-secret-32-chars' }),
    ).not.toThrow();
  });
});

describe('isSecretPlaceholder', () => {
  it('refuses the documented placeholders for the variable that owns them', () => {
    expect(isSecretPlaceholder('REPORTER_SECRET', 'reporter-secret')).toBe(true);
    expect(isSecretPlaceholder('RUNNER_REGISTRATION_SECRET', 'change-me')).toBe(true);
    expect(isSecretPlaceholder('AUTOMATE_API_KEY', 'automate')).toBe(true);
    expect(isSecretPlaceholder('COOKIE_SECRET', 'development-only-cookie-secret-32-chars')).toBe(
      true,
    );
  });

  it('does not treat one variable’s placeholder as another’s', () => {
    // Exact per variable, so `reporter-secret` is a placeholder for the reporter
    // credential and nothing else. A shared list would refuse a perfectly good
    // vault secret because the reporter one was left at its default.
    expect(isSecretPlaceholder('VAULT_SECRET', 'reporter-secret')).toBe(false);
    expect(isSecretPlaceholder('AUTOMATE_API_KEY', 'reporter-secret')).toBe(false);
  });

  it('accepts a value long enough to be a real secret', () => {
    expect(isSecretPlaceholder('COOKIE_SECRET', long('c'))).toBe(false);
    expect(isSecretPlaceholder('REPORTER_SECRET', 'replace-with-a-reporter-secret')).toBe(false);
  });
});

/** @param env @returns the thrown message, so a ZodError's issue list is assertable. */
function captureError(env: Record<string, string>): string {
  try {
    parseConfig(env);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`expected ${JSON.stringify(env)} to be refused`);
}
