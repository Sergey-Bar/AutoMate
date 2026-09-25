import { describe, expect, it } from 'vitest';

import { escapeMarkdown, escapeSlackMrkdwn } from '../sanitize-text.js';

describe('escapeMarkdown', () => {
  it('escapes pipe characters', () => {
    expect(escapeMarkdown('cell|content')).toBe('cell\\|content');
  });

  it('replaces newlines with spaces', () => {
    expect(escapeMarkdown('line1\nline2')).toBe('line1 line2');
  });

  it('escapes backticks', () => {
    expect(escapeMarkdown('`code`')).toBe('\\`code\\`');
  });

  it('escapes asterisks', () => {
    expect(escapeMarkdown('**bold**')).toBe('\\*\\*bold\\*\\*');
  });

  it('escapes underscores', () => {
    expect(escapeMarkdown('_italic_')).toBe('\\_italic\\_');
  });

  it('escapes square brackets', () => {
    expect(escapeMarkdown('[link](url)')).toBe('\\[link\\](url)');
  });

  it('escapes all special characters at once', () => {
    const input = '|pipe| `tick` *bold* _under_ [bracket]';
    const expected = '\\|pipe\\| \\`tick\\` \\*bold\\* \\_under\\_ \\[bracket\\]';
    expect(escapeMarkdown(input)).toBe(expected);
  });

  it('returns plain text unchanged', () => {
    expect(escapeMarkdown('normal text 123')).toBe('normal text 123');
  });

  it('returns empty string unchanged', () => {
    expect(escapeMarkdown('')).toBe('');
  });

  it('handles realistic malicious test title', () => {
    const title = 'test | `DROP TABLE` | **evil**\ninjected row';
    const result = escapeMarkdown(title);
    // All pipes are escaped
    expect(result).not.toMatch(/(?<!\\)\|/);
    expect(result).not.toContain('\n');
    // All backticks are escaped
    expect(result).not.toMatch(/(?<!\\)`/);
  });
});

describe('escapeSlackMrkdwn', () => {
  it('escapes ampersand', () => {
    expect(escapeSlackMrkdwn('a&b')).toBe('a&amp;b');
  });

  it('escapes angle brackets', () => {
    expect(escapeSlackMrkdwn('<script>')).toBe('&lt;script&gt;');
  });

  it('neutralises bold asterisks', () => {
    const result = escapeSlackMrkdwn('*bold*');
    expect(result).toContain('\u200B');  // zero-width space injected
  });

  it('neutralises italic underscores', () => {
    const result = escapeSlackMrkdwn('_italic_');
    expect(result).toContain('\u200B');
  });

  it('neutralises strikethrough tildes', () => {
    const result = escapeSlackMrkdwn('~strike~');
    expect(result).toContain('\u200B');
  });

  it('neutralises code backticks', () => {
    const result = escapeSlackMrkdwn('`code`');
    expect(result).toContain('\u200B');
  });

  it('returns plain text unchanged', () => {
    expect(escapeSlackMrkdwn('normal text 123')).toBe('normal text 123');
  });

  it('returns empty string unchanged', () => {
    expect(escapeSlackMrkdwn('')).toBe('');
  });

  it('handles realistic malicious branch name', () => {
    const branch = 'feature/<script>&*_bold_~strike~';
    const result = escapeSlackMrkdwn(branch);
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('&s');  // not raw &
  });

  it('does not double-escape already safe text', () => {
    expect(escapeSlackMrkdwn('hello world')).toBe('hello world');
  });
});
