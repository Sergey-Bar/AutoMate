import { describe, expect, it } from 'vitest';
import {
  evaluateLicence,
  formatLicenceExpression,
  LicenceExpressionError,
  parseLicenceExpression,
  type LicenceExpression,
  type LicencePolicy,
} from './licence.js';

function parsed(text: string): LicenceExpression {
  const result = parseLicenceExpression(text);
  if (result.status !== 'parsed') throw new Error(`expected ${text} to parse`);
  return result.expression;
}

describe('parseLicenceExpression', () => {
  it('reads a single id and keeps the casing it was written in', () => {
    expect(parsed('mit')).toEqual({ kind: 'licence', id: 'mit', orLater: false, exception: null });
    expect(parsed('  Apache-2.0  ')).toEqual({
      kind: 'licence',
      id: 'Apache-2.0',
      orLater: false,
      exception: null,
    });
  });

  it('reads the + suffix as "or later"', () => {
    expect(parsed('GPL-2.0+')).toEqual({
      kind: 'licence',
      id: 'GPL-2.0',
      orLater: true,
      exception: null,
    });
  });

  it('reads LicenseRef and DocumentRef references', () => {
    expect(parsed('LicenseRef-acme-1.0')).toMatchObject({ id: 'LicenseRef-acme-1.0' });
    expect(parsed('DocumentRef-spdx-tool:LicenseRef-acme')).toMatchObject({
      id: 'DocumentRef-spdx-tool:LicenseRef-acme',
    });
    expect(parsed('documentref-a:licenseref-b')).toMatchObject({
      id: 'documentref-a:licenseref-b',
    });
  });

  it('attaches a WITH exception to the id before it', () => {
    expect(parsed('GPL-2.0-only with Classpath-exception-2.0')).toEqual({
      kind: 'licence',
      id: 'GPL-2.0-only',
      orLater: false,
      exception: 'Classpath-exception-2.0',
    });
  });

  it('binds AND tighter than OR, and WITH tighter than AND', () => {
    expect(parsed('MIT OR Apache-2.0 AND GPL-2.0 WITH x')).toEqual({
      kind: 'or',
      left: { kind: 'licence', id: 'MIT', orLater: false, exception: null },
      right: {
        kind: 'and',
        left: { kind: 'licence', id: 'Apache-2.0', orLater: false, exception: null },
        right: { kind: 'licence', id: 'GPL-2.0', orLater: false, exception: 'x' },
      },
    });
  });

  it('honours parentheses and lower-case operators', () => {
    expect(parsed('(MIT or Apache-2.0) and ISC')).toEqual({
      kind: 'and',
      left: {
        kind: 'or',
        left: { kind: 'licence', id: 'MIT', orLater: false, exception: null },
        right: { kind: 'licence', id: 'Apache-2.0', orLater: false, exception: null },
      },
      right: { kind: 'licence', id: 'ISC', orLater: false, exception: null },
    });
    expect(parsed('(((MIT)))')).toMatchObject({ kind: 'licence', id: 'MIT' });
    expect(parsed('(MIT)AND(ISC)')).toMatchObject({ kind: 'and' });
  });

  it('is left-associative for a chain of one operator', () => {
    expect(formatLicenceExpression(parsed('A OR B OR C'))).toBe('(A OR B) OR C');
    expect(formatLicenceExpression(parsed('A AND B AND C'))).toBe('(A AND B) AND C');
  });

  it.each([null, undefined, '', '   ', 'NOASSERTION', 'noassertion', 'NONE', ' none '])(
    'reports %j as unknown rather than parsing it',
    (text) => {
      expect(parseLicenceExpression(text).status).toBe('unknown');
    },
  );

  it.each([
    ['MIT AND', 'expected a licence id'],
    ['AND MIT', 'expected a licence id'],
    ['MIT OR OR ISC', 'expected a licence id'],
    ['(MIT', "expected ')'"],
    ['MIT)', "unexpected ')'"],
    ['MIT ISC', "unexpected 'ISC'"],
    ['MIT WITH', 'expected an exception id'],
    ['MIT WITH (x)', 'expected an exception id'],
    ['(MIT OR ISC) WITH x', 'WITH applies to a single licence'],
    ['MIT WITH x WITH y', 'WITH applies to a single licence'],
    ['LicenseRef-x+', "invalid licence id 'LicenseRef-x+'"],
    ['MIT++', "invalid licence id 'MIT++'"],
    ['M!T', "invalid licence id 'M!T'"],
    ['MIT OR NOASSERTION', 'NOASSERTION cannot be combined'],
    ['NONE AND MIT', 'NONE cannot be combined'],
    ['MIT WITH x+', "invalid exception id 'x+'"],
    ['DocumentRef-x:MIT', "invalid licence id 'DocumentRef-x:MIT'"],
    ['Doc-x:LicenseRef-y', "invalid licence id 'Doc-x:LicenseRef-y'"],
    ['()', 'expected a licence id'],
  ])('refuses %j (%s)', (text, message) => {
    expect(() => parseLicenceExpression(text)).toThrow(LicenceExpressionError);
    expect(() => parseLicenceExpression(text)).toThrow(message);
  });

  it('records where in the text the error was found', () => {
    try {
      parseLicenceExpression('MIT OR )');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LicenceExpressionError);
      expect((error as LicenceExpressionError).offset).toBe(7);
      expect((error as LicenceExpressionError).name).toBe('LicenceExpressionError');
    }
    try {
      parseLicenceExpression('MIT OR');
      expect.unreachable();
    } catch (error) {
      expect((error as LicenceExpressionError).offset).toBe(6);
    }
  });

  it('formats an expression it can read back', () => {
    const text = 'MIT OR (GPL-2.0+ WITH Classpath-exception-2.0 AND LicenseRef-x)';
    const once = formatLicenceExpression(parsed(text));
    expect(once).toBe('MIT OR (GPL-2.0+ WITH Classpath-exception-2.0 AND LicenseRef-x)');
    expect(parsed(once)).toEqual(parsed(text));
    expect(formatLicenceExpression(parsed('mit with x'))).toBe('mit WITH x');
  });

  it('says why an undeclared licence is unknown', () => {
    expect(parseLicenceExpression(null)).toEqual({
      status: 'unknown',
      reason: 'No licence is declared',
    });
    expect(parseLicenceExpression('none')).toEqual({
      status: 'unknown',
      reason: 'The licence is declared as NONE',
    });
  });
});

describe('evaluateLicence', () => {
  const policy: LicencePolicy = {
    allow: ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'GPL-2.0 WITH Classpath-exception-2.0'],
    deny: ['GPL-2.0', 'GPL-3.0', 'AGPL-3.0'],
  };

  // The truth table: one row per shape of decision the gate has to make.
  it.each([
    ['MIT', 'allowed', ['MIT']],
    ['mit', 'allowed', ['mit']],
    ['GPL-3.0', 'denied', ['GPL-3.0']],
    ['ISC', 'unlisted', ['ISC']],
    ['MIT OR GPL-3.0', 'allowed', ['MIT']],
    ['GPL-3.0 OR MIT', 'allowed', ['MIT']],
    ['MIT AND GPL-3.0', 'denied', ['MIT', 'GPL-3.0']],
    ['MIT AND ISC', 'unlisted', ['MIT', 'ISC']],
    ['ISC OR GPL-3.0', 'unlisted', ['ISC']],
    ['GPL-3.0 OR AGPL-3.0', 'denied', ['GPL-3.0']],
    ['(MIT OR GPL-3.0) AND (Apache-2.0 OR ISC)', 'allowed', ['MIT', 'Apache-2.0']],
    ['(GPL-3.0 OR ISC) AND MIT', 'unlisted', ['ISC', 'MIT']],
    ['GPL-2.0 WITH Classpath-exception-2.0', 'allowed', ['GPL-2.0 WITH Classpath-exception-2.0']],
    ['GPL-2.0 WITH Other-exception', 'denied', ['GPL-2.0 WITH Other-exception']],
    ['MIT WITH Some-exception', 'allowed', ['MIT WITH Some-exception']],
    ['GPL-2.0+', 'denied', ['GPL-2.0+']],
    ['BSD-3-Clause+', 'allowed', ['BSD-3-Clause+']],
    ['LicenseRef-acme', 'unlisted', ['LicenseRef-acme']],
  ] as const)('%s → %s', (expression, verdict, chosen) => {
    const result = evaluateLicence(expression, policy);
    expect(result.verdict).toBe(verdict);
    expect(result.chosen).toEqual(chosen);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('names the denied and the unlisted licences in its reason', () => {
    expect(evaluateLicence('MIT AND GPL-3.0', policy).reason).toContain('GPL-3.0');
    expect(evaluateLicence('MIT AND ISC', policy).reason).toContain('ISC');
    expect(evaluateLicence('MIT', policy).reason).toContain('MIT');
  });

  it('treats an undeclared or unreadable licence as unknown, never allowed', () => {
    for (const expression of [null, '', 'NOASSERTION', 'NONE']) {
      const result = evaluateLicence(expression, { deny: ['GPL-3.0'] });
      expect(result.verdict).toBe('unknown');
      expect(result.chosen).toBeNull();
    }
    const broken = evaluateLicence('MIT AND', { allow: ['MIT'] });
    expect(broken).toMatchObject({ verdict: 'unknown', chosen: null });
    expect(broken.reason).toContain('expected a licence id');
  });

  it('allows anything not denied when there is only a deny list', () => {
    expect(evaluateLicence('ISC', { deny: ['GPL-3.0'] }).verdict).toBe('allowed');
    expect(evaluateLicence('GPL-3.0 OR ISC', { deny: ['GPL-3.0'] }).chosen).toEqual(['ISC']);
    expect(evaluateLicence('gpl-3.0', { deny: ['GPL-3.0'] }).verdict).toBe('denied');
  });

  it('allows everything under an empty policy, and nothing under an empty allow list', () => {
    expect(evaluateLicence('GPL-3.0', {}).verdict).toBe('allowed');
    expect(evaluateLicence('MIT', { allow: [] }).verdict).toBe('unlisted');
  });

  it('lets deny win over allow for the same licence', () => {
    expect(evaluateLicence('MIT', { allow: ['MIT'], deny: ['mit'] }).verdict).toBe('denied');
  });

  it('lets a full "X WITH Y" entry override an entry for X alone, in either direction', () => {
    expect(
      evaluateLicence('Apache-2.0 WITH LLVM-exception', {
        allow: ['Apache-2.0'],
        deny: ['apache-2.0  with  llvm-exception'],
      }).verdict,
    ).toBe('denied');
    expect(
      evaluateLicence('GPL-2.0 WITH Classpath-exception-2.0', {
        deny: ['GPL-2.0'],
        allow: ['GPL-2.0 WITH Classpath-exception-2.0'],
      }).verdict,
    ).toBe('allowed');
  });

  it('reads "or later" entries on both sides of the policy', () => {
    expect(evaluateLicence('GPL-2.0+', { deny: ['GPL-2.0+'] }).verdict).toBe('denied');
    expect(evaluateLicence('GPL-2.0+', { deny: ['GPL-2.0-or-later'] }).verdict).toBe('denied');
    expect(evaluateLicence('GPL-2.0', { deny: ['GPL-2.0+'] }).verdict).toBe('allowed');
    expect(evaluateLicence('LGPL-2.1+', { allow: ['LGPL-2.1-or-later'] }).verdict).toBe('allowed');
    expect(
      evaluateLicence('GPL-2.0+ WITH Classpath-exception-2.0', {
        allow: ['GPL-2.0+ WITH Classpath-exception-2.0'],
      }).verdict,
    ).toBe('allowed');
  });
});
