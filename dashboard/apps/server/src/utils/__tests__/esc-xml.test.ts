import { describe, expect, it } from 'vitest';

import { escXml } from '../esc-xml.js';

describe('escXml', () => {
  it('escapes ampersand entity', () => {
    expect(escXml('&')).toBe('&amp;');
  });

  it('escapes less-than entity', () => {
    expect(escXml('<')).toBe('&lt;');
  });

  it('escapes greater-than entity', () => {
    expect(escXml('>')).toBe('&gt;');
  });

  it('escapes double quote entity', () => {
    expect(escXml('"')).toBe('&quot;');
  });

  it('escapes single quote entity', () => {
    expect(escXml("'")).toBe('&apos;');
  });

  it('escapes all XML entities in one string', () => {
    expect(escXml(`&<>'"`)).toBe('&amp;&lt;&gt;&apos;&quot;');
  });

  it('returns same string when no entities are present', () => {
    expect(escXml('plain-text_123')).toBe('plain-text_123');
  });

  it('returns empty string unchanged', () => {
    expect(escXml('')).toBe('');
  });

  it('escapes string containing only special characters', () => {
    expect(escXml(`&<>&"'`)).toBe('&amp;&lt;&gt;&amp;&quot;&apos;');
  });

  it('double-escapes existing entity ampersand', () => {
    expect(escXml('&amp;')).toBe('&amp;amp;');
  });

  it('preserves unicode characters while escaping entities', () => {
    expect(escXml('Привет & 你好 <世界>')).toBe('Привет &amp; 你好 &lt;世界&gt;');
  });

  it('escapes very long strings', () => {
    const long = `${'a'.repeat(5000)}&${'b'.repeat(5000)}<${'c'.repeat(5000)}>`;
    const expected = `${'a'.repeat(5000)}&amp;${'b'.repeat(5000)}&lt;${'c'.repeat(5000)}&gt;`;
    expect(escXml(long)).toBe(expected);
  });

  it('preserves newlines in multi-line strings', () => {
    const input = 'line1\nline&2\n<line3>';
    const expected = 'line1\nline&amp;2\n&lt;line3&gt;';
    expect(escXml(input)).toBe(expected);
  });

  it('fully escapes script tags and quotes', () => {
    expect(escXml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });
});
