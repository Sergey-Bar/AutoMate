import { describe, expect, it } from 'vitest';
import { SECRET_MIN_LENGTH, isSecretPlaceholder, parseConfig } from './config.js';

/** Long enough to clear the floor, and not a placeholder, so only the check under test fires. */
const long = (character: string): string => character.repeat(SECRET_MIN_LENGTH);

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
