import { describe, expect, it } from 'vitest';
import { parseCodeowners } from './codeowners.js';

describe('parseCodeowners', () => {
  it('drops a trailing comment, keeps a `#` inside a token, and skips comment lines', () => {
    const rules = parseCodeowners('# owners\n/src/ @a @b   # the team\n/lib/a#b.ts @c\n');
    expect(rules.map((rule) => [rule.pattern, rule.owners])).toEqual([
      ['/src/', ['@a', '@b']],
      ['/lib/a#b.ts', ['@c']],
    ]);
  });

  it('reads a long run of whitespace in linear time (CodeQL js/polynomial-redos)', () => {
    // `/\s+#.*$/` retried from every character of a whitespace run with no `#` after it.
    const started = performance.now();
    const rules = parseCodeowners(`/src/ @a${' '.repeat(200_000)}@b`);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(rules[0]?.owners).toEqual(['@a', '@b']);
  });
});
