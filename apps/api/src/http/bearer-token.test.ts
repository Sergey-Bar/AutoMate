import { describe, expect, it } from 'vitest';
import { bearerToken } from './bearer-token.js';

/**
 * The one bearer parser, and what it replaced.
 *
 * The five parsers this module replaced are transcribed below as *executable* code
 * rather than as expected values, so the divergence is something the suite runs
 * rather than something a comment claims.
 */

describe('bearerToken', () => {
  it('reads the credential from a well-formed header', () => {
    expect(bearerToken('Bearer abc123')).toBe('abc123');
  });

  it('accepts the scheme in any case, as RFC 6750 requires', () => {
    // All five parsers tested `startsWith('Bearer ')`. RFC 6750 §2.1 defines the
    // scheme as case-insensitive, so `bearer <token>` and `BEARER <token>` are
    // valid requests that every one of them rejected.
    expect(bearerToken('bearer abc123')).toBe('abc123');
    expect(bearerToken('BEARER abc123')).toBe('abc123');
    expect(bearerToken('BeArEr abc123')).toBe('abc123');
  });

  it('tolerates extra whitespace, which is how a client actually builds the header', () => {
    // `'Bearer ' + token` where the token was already trimmed by something else
    // produces two spaces. Two of the five parsers accepted that and three did not,
    // so the same credential worked against some routes and not others.
    expect(bearerToken('Bearer  abc123')).toBe('abc123');
    expect(bearerToken('Bearer   abc123')).toBe('abc123');
    // A trailing newline from a proxy, or a hand-rolled client.
    expect(bearerToken('Bearer abc123\n')).toBe('abc123');
    expect(bearerToken('  Bearer abc123  ')).toBe('abc123');
  });

  it('answers "no credential" for every way of not having one', () => {
    // One answer, because a caller cannot act on these differently. `reporter.ts`
    // used to treat an empty token as a *wrong* token and answered 403 where every
    // other route answered 401, so a client could not tell "you sent nothing" from
    // "you sent the wrong thing".
    for (const header of [
      undefined,
      null,
      '',
      'Bearer',
      'Bearer ',
      'Bearer      ',
      'Basic abc123',
      'Token abc123',
      'Bearerabc123',
      'XBearer abc123',
    ]) {
      expect(bearerToken(header), `header ${JSON.stringify(header)}`).toBeUndefined();
    }
  });

  it('is the one parser all five routes now share, and it is never stricter', () => {
    const old = {
      'middleware/auth.ts': (header: string | undefined) =>
        header?.startsWith('Bearer ') ? header.slice(7) : undefined,
      'routes/execution.ts': (value: string | undefined) => {
        if (!value?.startsWith('Bearer ')) return undefined;
        const token = value.slice(7).trim();
        return token.length > 0 ? token : undefined;
      },
      'routes/reporter.ts': (header: string | undefined) =>
        header?.startsWith('Bearer ') ? header.slice(7) : undefined,
      'routes/reporter-results.ts': (header: string | undefined) =>
        header?.startsWith('Bearer ') ? header.slice(7).trim() || '' : '',
      'routes/runner.ts': (header: string | undefined) =>
        header?.startsWith('Bearer ') ? header.slice(7).trim() : '',
    } satisfies Record<string, (header: string | undefined) => string | undefined>;

    const cases = [
      'Bearer abc',
      'Bearer  abc',
      'Bearer   abc',
      'bearer abc',
      'BEARER abc',
      'Bearer ',
      'Bearer    ',
      'Basic abc',
      'Bearer abc\n',
    ];

    let disagreements = 0;
    for (const [name, parse] of Object.entries(old)) {
      for (const header of cases) {
        const before = parse(header) ?? '';
        const now = bearerToken(header) ?? '';
        if (before === now) continue;
        disagreements += 1;
        // Every disagreement must be the shared parser *accepting* something: either
        // a header the old parser rejected outright, or the same header with its
        // surrounding whitespace removed. A row where the shared parser accepts
        // strictly less would lock out a caller who works today, and the test says
        // so rather than absorbing it.
        expect(
          before === '' || now === before.trim(),
          `${name} on ${JSON.stringify(header)}: old=${JSON.stringify(before)} new=${JSON.stringify(now)}`,
        ).toBe(true);
      }
    }
    // The parsers really did disagree, so the loop above is not vacuous.
    expect(disagreements).toBeGreaterThan(0);
  });

  it('never returns a credential it trimmed to nothing', () => {
    // The specific case the old `reporter.ts` turned into a 403: a header with the
    // scheme and only whitespace after it.
    expect(bearerToken('Bearer    ')).toBeUndefined();
  });
});
