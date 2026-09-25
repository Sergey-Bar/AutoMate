import { describe, expect, it } from 'vitest';
import { buildJiraDescription } from './service.js';

describe('buildJiraDescription', () => {
  it('includes test title and file details', () => {
    const description = buildJiraDescription({
      title: 'login should work',
      file: 'tests/auth.spec.ts',
    });

    expect(description).toContain('*Test:* login should work');
    expect(description).toContain('*File:* `tests/auth.spec.ts`');
    expect(description).toContain('_Created automatically by Automate');
  });

  it('formats error message in Jira code block', () => {
    const description = buildJiraDescription({
      title: 'checkout fails',
      file: 'tests/checkout.spec.ts',
      errorMessage: 'Expected 200 but received 500',
    });

    expect(description).toContain('*Error:*\n{code}Expected 200 but received 500{code}');
  });

  it('formats error stack in Jira code block when provided', () => {
    const description = buildJiraDescription({
      title: 'stack test',
      file: 'tests/stack.spec.ts',
      errorStack: 'Error: something\n  at foo (bar.ts:1:1)',
    });

    expect(description).toContain('*Stack:*\n{code}Error: something\n  at foo (bar.ts:1:1){code}');
  });

  it('truncates error stack to 2000 characters', () => {
    const longStack = 'x'.repeat(3000);
    const description = buildJiraDescription({
      title: 'long stack test',
      file: 'tests/long.spec.ts',
      errorStack: longStack,
    });

    expect(description).toContain('{code}' + 'x'.repeat(2000) + '{code}');
    expect(description).not.toContain('{code}' + 'x'.repeat(2001));
  });

  it('includes screenshot URL as a Jira link when provided', () => {
    const description = buildJiraDescription({
      title: 'screenshot test',
      file: 'tests/screenshot.spec.ts',
      screenshotUrl: 'https://example.com/screenshot.png',
    });

    expect(description).toContain('[Screenshot|https://example.com/screenshot.png]');
  });

  it('omits error stack section when errorStack is not provided', () => {
    const description = buildJiraDescription({
      title: 'no stack',
      file: 'tests/no-stack.spec.ts',
    });

    expect(description).not.toContain('*Stack:*');
  });

  it('omits screenshot section when screenshotUrl is not provided', () => {
    const description = buildJiraDescription({
      title: 'no screenshot',
      file: 'tests/no-screenshot.spec.ts',
    });

    expect(description).not.toContain('[Screenshot|');
  });

  it('includes all optional fields when all are provided', () => {
    const description = buildJiraDescription({
      title: 'full test',
      file: 'tests/full.spec.ts',
      errorMessage: 'Assertion failed',
      errorStack: 'Error: Assertion failed\n  at test (full.spec.ts:10:5)',
      screenshotUrl: 'https://cdn.example.com/shots/full.png',
    });

    expect(description).toContain('*Error:*\n{code}Assertion failed{code}');
    expect(description).toContain('*Stack:*\n{code}Error: Assertion failed\n  at test (full.spec.ts:10:5){code}');
    expect(description).toContain('[Screenshot|https://cdn.example.com/shots/full.png]');
  });
});
