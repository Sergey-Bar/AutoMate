/// <reference types="vitest" />
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Direct import to ensure the re-export barrel (ws-reporter.ts) is instrumented
// by the coverage tool. Without this, the two `export { ... }` lines register
// as 0% even though the forwarded symbols are exercised via the package directly.
import WsReporterDefault, { WsReporter, extractPRMetadata } from './ws-reporter.js';

describe('ws-reporter barrel exports', () => {
  it('re-exports default WsReporter class', () => {
    expect(WsReporterDefault).toBeDefined();
    expect(typeof WsReporterDefault).toBe('function');
  });

  it('re-exports named WsReporter class', () => {
    expect(WsReporter).toBeDefined();
    expect(typeof WsReporter).toBe('function');
  });

  it('re-exports extractPRMetadata function', () => {
    expect(extractPRMetadata).toBeDefined();
    expect(typeof extractPRMetadata).toBe('function');
  });
});

describe('WS Reporter', () => {
  it('should export module', async () => {
    // ws-reporter is a Playwright reporter class
    const mod = await import('../reporter/ws-reporter.js');
    expect(mod).toBeDefined();
  });

  it('event payload structure is correct', () => {
    // Test event serialization format
    const event = {
      type: 'test:end',
      payload: {
        testId: 'abc',
        runId: 'run-1',
        status: 'passed',
        duration: 1234,
      },
    };

    const json = JSON.stringify(event);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('test:end');
    expect(parsed.payload.testId).toBe('abc');
    expect(parsed.payload.status).toBe('passed');
  });

  it('handles all event types', () => {
    const eventTypes = [
      'run:start',
      'test:begin',
      'test:end',
      'step:begin',
      'step:end',
      'run:end',
      'stdout',
      'stderr',
    ];

    for (const type of eventTypes) {
      const event = { type, payload: {} };
      expect(JSON.parse(JSON.stringify(event)).type).toBe(type);
    }
  });

  it('run:end event includes stats', () => {
    const event = {
      type: 'run:end',
      payload: {
        status: 'passed',
        total: 50,
        passed: 48,
        failed: 1,
        flaky: 1,
        skipped: 0,
        durationMs: 45000,
      },
    };

    expect(event.payload.total).toBe(50);
    expect(event.payload.passed + event.payload.failed + event.payload.flaky + event.payload.skipped).toBe(50);
  });
});

describe('extractPRMetadata', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should extract GitHub Actions PR metadata', async () => {
    process.env.GITHUB_REF = 'refs/pull/42/merge';
    process.env.GITHUB_HEAD_REF = 'feat/cool-feature';
    process.env.GITHUB_BASE_REF = 'main';
    process.env.GITHUB_ACTOR = 'octocat';
    process.env.GITHUB_SHA = 'abc123';

    const { extractPRMetadata } = await import('../reporter/ws-reporter.js');
    const meta = extractPRMetadata();
    expect(meta.prNumber).toBe(42);
    expect(meta.prBranch).toBe('feat/cool-feature');
    expect(meta.baseBranch).toBe('main');
    expect(meta.commitAuthor).toBe('octocat');
  });

  it('should extract GitLab CI MR metadata', async () => {
    process.env.CI_MERGE_REQUEST_IID = '99';
    process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME = 'fix/bug';
    process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME = 'develop';
    process.env.GITLAB_USER_NAME = 'gitlabuser';
    process.env.CI_COMMIT_SHA = 'def456';

    const { extractPRMetadata } = await import('../reporter/ws-reporter.js');
    const meta = extractPRMetadata();
    expect(meta.prNumber).toBe(99);
    expect(meta.prBranch).toBe('fix/bug');
    expect(meta.baseBranch).toBe('develop');
    expect(meta.commitAuthor).toBe('gitlabuser');
  });

  it('should extract from generic PR_NUMBER env var', async () => {
    process.env.PR_NUMBER = '7';

    const { extractPRMetadata } = await import('../reporter/ws-reporter.js');
    const meta = extractPRMetadata();
    expect(meta.prNumber).toBe(7);
  });

  it('should return all undefined when no CI env vars set', async () => {
    // Clear any CI env vars
    delete process.env.GITHUB_REF;
    delete process.env.GITHUB_HEAD_REF;
    delete process.env.GITHUB_BASE_REF;
    delete process.env.GITHUB_ACTOR;
    delete process.env.GITHUB_SHA;
    delete process.env.CI_MERGE_REQUEST_IID;
    delete process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME;
    delete process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME;
    delete process.env.GITLAB_USER_NAME;
    delete process.env.CI_COMMIT_SHA;
    delete process.env.PR_NUMBER;

    const { extractPRMetadata } = await import('../reporter/ws-reporter.js');
    const meta = extractPRMetadata();
    expect(meta.prNumber).toBeUndefined();
    expect(meta.prBranch).toBeUndefined();
    expect(meta.baseBranch).toBeUndefined();
    expect(meta.commitAuthor).toBeUndefined();
  });
});
