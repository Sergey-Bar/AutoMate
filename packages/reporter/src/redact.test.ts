import { describe, expect, it } from 'vitest';
import { REDACTED, redactSecrets } from './redact.js';

// Credential-shaped values are assembled at runtime, never written as literals, so the
// repository's own secret scanners have nothing to flag.
const github = () => ['gh', 'p_', 'A1b2C3d4'.repeat(5)].join('');
const aws = () => ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join('');
const jwt = () => ['ey', 'J', 'hbGciOiJI', '.', 'eyJzdWIiOiIx', '.', 'c2lnbmF0dXJlXw'].join('');
const pem = () =>
  [
    '-----BEGIN RSA ',
    'PRIVATE KEY-----\nMIIBOgIBAAJBAK\n',
    '-----END RSA ',
    'PRIVATE KEY-----',
  ].join('');

describe('redactSecrets', () => {
  it.each([
    ['a GitHub token', github()],
    ['an AWS access key id', aws()],
    ['a JWT', jwt()],
    ['a PEM private key', pem()],
    ['a bearer header', `Bearer ${'x'.repeat(24)}`],
    ['an OpenAI-style key', ['s', 'k-', 'q'.repeat(30)].join('')],
    ['an assignment', `api_key=${'v'.repeat(12)}`],
  ])('replaces %s', (_name, secret) => {
    const out = redactSecrets(`before ${secret} after`);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
    expect(out.startsWith('before ')).toBe(true);
  });

  it('replaces a registered literal of four characters or more, and not a shorter one', () => {
    expect(redactSecrets('the value hunter2 is here', ['hunter2'])).toBe(
      `the value ${REDACTED} is here`,
    );
    expect(redactSecrets('abc stays', ['abc'])).toBe('abc stays');
  });

  it('leaves ordinary prose alone', () => {
    const prose = 'The model answered: the token count was 42 and the password policy is strict.';
    expect(redactSecrets(prose)).toBe(prose);
  });

  it('redacts in linear time a text of many private-key headers with no end', () => {
    const header = ['-----BEGIN RSA ', 'PRIVATE KEY-----\n'].join('');
    const hostile = header.repeat(120_000);
    const started = performance.now();
    const out = redactSecrets(`${hostile}tail`);
    // Generous: every unmatched header used to rescan to the end of the input.
    expect(performance.now() - started).toBeLessThan(2000);
    // With no END there is no block, so nothing is replaced and nothing is lost.
    expect(out).toBe(`${hostile}tail`);
  });

  it('redacts every complete block, and a header with no end after the last one stays', () => {
    const header = ['-----BEGIN RSA ', 'PRIVATE KEY-----'].join('');
    const text = `a ${pem()} b ${pem()} c ${header} d`;
    expect(redactSecrets(text)).toBe(`a ${REDACTED} b ${REDACTED} c ${header} d`);
  });
});
