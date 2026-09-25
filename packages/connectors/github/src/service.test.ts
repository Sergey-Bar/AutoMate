import { describe, expect, it } from 'vitest';
import { buildSummaryMarkdown } from './service.js';

describe('buildSummaryMarkdown', () => {
  it('includes Playwright results header and computed pass rate', () => {
    const markdown = buildSummaryMarkdown({
      status: 'passed',
      total: 10,
      passed: 8,
      failed: 1,
      flaky: 1,
      skipped: 0,
      durationMs: 15_000,
      branch: 'feat/test',
      dashboardUrl: 'https://example.com/run/1',
    });

    expect(markdown).toContain('Playwright Test Results');
    expect(markdown).toContain('| **Pass Rate** | 80.0% |');
    expect(markdown).toContain('[📊 View in Dashboard](https://example.com/run/1)');
    expect(markdown).toContain('_Posted by Automate');
  });

  it('renders failed tests section when failed tests are present', () => {
    const markdown = buildSummaryMarkdown({
      status: 'failed',
      total: 2,
      passed: 1,
      failed: 1,
      flaky: 0,
      skipped: 0,
      failedTests: [
        {
          title: 'should login',
          file: 'tests/auth.spec.ts',
          errorMessage: 'Expected true to be false',
        },
      ],
    });

    expect(markdown).toContain('### ❌ Failed Tests');
    expect(markdown).toContain('| should login | `tests/auth.spec.ts` | Expected true to be false |');
  });

  it('truncates failed tests to 20 and appends overflow count when more than 20 failed', () => {
    const failedTests = Array.from({ length: 25 }, (_, i) => ({
      title: `Test ${i + 1}`,
      file: `tests/test${i + 1}.spec.ts`,
      errorMessage: `Error ${i + 1}`,
    }));

    const markdown = buildSummaryMarkdown({
      status: 'failed',
      total: 25,
      passed: 0,
      failed: 25,
      flaky: 0,
      skipped: 0,
      failedTests,
    });

    expect(markdown).toContain('_...and 5 more failed tests_');
    // Only first 20 should appear
    expect(markdown).toContain('| Test 20 |');
    expect(markdown).not.toContain('| Test 21 |');
  });

  it('does not append overflow count when exactly 20 failed tests', () => {
    const failedTests = Array.from({ length: 20 }, (_, i) => ({
      title: `Test ${i + 1}`,
      file: `tests/test${i + 1}.spec.ts`,
    }));

    const markdown = buildSummaryMarkdown({
      status: 'failed',
      total: 20,
      passed: 0,
      failed: 20,
      flaky: 0,
      skipped: 0,
      failedTests,
    });

    expect(markdown).not.toContain('more failed tests');
  });

  it('handles zero total tests with 0% pass rate', () => {
    const markdown = buildSummaryMarkdown({
      status: 'failed',
      total: 0,
      passed: 0,
      failed: 0,
      flaky: 0,
      skipped: 0,
    });

    expect(markdown).toContain('| **Pass Rate** | 0% |');
  });

  it('omits dashboard link when dashboardUrl is not provided', () => {
    const markdown = buildSummaryMarkdown({
      status: 'passed',
      total: 5,
      passed: 5,
      failed: 0,
      flaky: 0,
      skipped: 0,
    });

    expect(markdown).not.toContain('View in Dashboard');
  });

  it('renders N/A for branch when branch is not provided', () => {
    const markdown = buildSummaryMarkdown({
      status: 'passed',
      total: 5,
      passed: 5,
      failed: 0,
      flaky: 0,
      skipped: 0,
    });

    expect(markdown).toContain('| **Branch** | N/A |');
  });

  it('renders N/A for duration when durationMs is not provided', () => {
    const markdown = buildSummaryMarkdown({
      status: 'passed',
      total: 5,
      passed: 5,
      failed: 0,
      flaky: 0,
      skipped: 0,
    });

    expect(markdown).toContain('| **Duration** | N/A |');
  });

  it('uses warning emoji for non-passed non-failed status', () => {
    const markdown = buildSummaryMarkdown({
      status: 'timedout',
      total: 5,
      passed: 3,
      failed: 0,
      flaky: 0,
      skipped: 2,
    });

    expect(markdown).toContain('⚠️');
  });

  it('truncates long error messages at 80 chars and escapes pipe characters', () => {
    const longError = 'A'.repeat(100);
    const errorWithPipe = 'Error | with | pipes';

    const markdown = buildSummaryMarkdown({
      status: 'failed',
      total: 2,
      passed: 0,
      failed: 2,
      flaky: 0,
      skipped: 0,
      failedTests: [
        { title: 'long error', file: 'tests/a.spec.ts', errorMessage: longError },
        { title: 'pipe error', file: 'tests/b.spec.ts', errorMessage: errorWithPipe },
      ],
    });

    // 80 chars of 'A'
    expect(markdown).toContain('A'.repeat(80));
    expect(markdown).not.toContain('A'.repeat(81));
    // Pipes should be escaped
    expect(markdown).toContain('Error \\| with \\| pipes');
  });

  it('renders em dash when errorMessage is absent in failed test', () => {
    const markdown = buildSummaryMarkdown({
      status: 'failed',
      total: 1,
      passed: 0,
      failed: 1,
      flaky: 0,
      skipped: 0,
      failedTests: [{ title: 'no error msg', file: 'tests/c.spec.ts' }],
    });

    expect(markdown).toContain('| no error msg | `tests/c.spec.ts` | — |');
  });
});
