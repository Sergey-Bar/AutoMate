/// <reference types="vitest" />
import { describe, it, expect } from 'vitest';
import {
  TestStatus,
  RunStatus,
  RunSchema,
  TestSchema,
  ResultSchema,
  parseResult,
} from './types';

describe('Zod schemas — round-trip validation', () => {
  describe('TestStatus enum', () => {
    it('accepts valid statuses', () => {
      expect(TestStatus.parse('passed')).toBe('passed');
      expect(TestStatus.parse('failed')).toBe('failed');
      expect(TestStatus.parse('flaky')).toBe('flaky');
      expect(TestStatus.parse('skipped')).toBe('skipped');
      expect(TestStatus.parse('timedOut')).toBe('timedOut');
      expect(TestStatus.parse('running')).toBe('running');
      expect(TestStatus.parse('queued')).toBe('queued');
    });

    it('rejects invalid statuses', () => {
      expect(() => TestStatus.parse('invalid')).toThrow();
    });
  });

  describe('RunStatus enum', () => {
    it('accepts valid statuses', () => {
      expect(RunStatus.parse('running')).toBe('running');
      expect(RunStatus.parse('passed')).toBe('passed');
      expect(RunStatus.parse('failed')).toBe('failed');
      expect(RunStatus.parse('interrupted')).toBe('interrupted');
    });
  });

  describe('RunSchema', () => {
    const validRun = {
      id: 'run-1',
      startedAt: '2024-01-01T00:00:00Z',
      finishedAt: '2024-01-01T00:01:00Z',
      status: 'passed' as const,
      total: 100,
      passed: 95,
      failed: 3,
      flaky: 2,
      skipped: 0,
      durationMs: 60000,
      branch: 'main',
      commitSha: 'abc1234',
      commitMessage: 'fix: bug',
      triggeredBy: 'manual',
      config: '{}',
      rawArgs: '--workers=4',
    };

    it('parses valid run', () => {
      const result = RunSchema.parse(validRun);
      expect(result.id).toBe('run-1');
      expect(result.status).toBe('passed');
    });

    it('accepts nullable fields', () => {
      const run = { ...validRun, finishedAt: null, durationMs: null, branch: null, commitSha: null, commitMessage: null, triggeredBy: null, config: null, rawArgs: null };
      const result = RunSchema.parse(run);
      expect(result.finishedAt).toBeNull();
    });

    it('rejects missing required fields', () => {
      expect(() => RunSchema.parse({ id: 'run-1' })).toThrow();
    });
  });

  describe('TestSchema', () => {
    const validTest = {
      id: 'test-1',
      runId: 'run-1',
      suiteId: 'suite-1',
      title: 'should login',
      file: 'tests/login.spec.ts',
      line: 10,
      column: 5,
      status: 'passed' as const,
      durationMs: 1500,
      tags: '["@smoke"]',
      annotations: '[]',
      retryCount: 0,
      expectedStatus: 'passed',
      workerIndex: 0,
      stableId: 'abc1234567890123',
    };

    it('parses valid test', () => {
      const result = TestSchema.parse(validTest);
      expect(result.title).toBe('should login');
    });

    it('accepts nullable fields', () => {
      const test = { ...validTest, suiteId: null, line: null, column: null, durationMs: null, tags: null, annotations: null, retryCount: null, expectedStatus: null, workerIndex: null, stableId: null };
      const result = TestSchema.parse(test);
      expect(result.suiteId).toBeNull();
    });
  });

  describe('ResultSchema', () => {
    const validResult = {
      id: 'result-1',
      testId: 'test-1',
      runId: 'run-1',
      retry: 0,
      status: 'passed' as const,
      durationMs: 1200,
      startedAt: '2024-01-01T00:00:00Z',
      errorMessage: null,
      errorStack: null,
      workerIndex: 0,
      parallelIndex: 0,
      stdout: null,
      stderr: null,
      steps: null,
      attachments: null,
    };

    it('parses valid result', () => {
      const result = ResultSchema.parse(validResult);
      expect(result.testId).toBe('test-1');
    });
  });

  describe('parseResult', () => {
    it('parses steps JSON', () => {
      const result = {
        id: 'r1',
        testId: 't1',
        runId: 'run1',
        retry: 0,
        status: 'passed' as const,
        durationMs: 100,
        startedAt: null,
        errorMessage: null,
        errorStack: null,
        workerIndex: null,
        parallelIndex: null,
        stdout: null,
        stderr: null,
        steps: JSON.stringify([{ title: 'click', category: 'action', steps: [] }]),
        attachments: JSON.stringify([{ name: 'screenshot.png', contentType: 'image/png' }]),
      };

      const parsed = parseResult(result);
      expect(parsed.steps).toHaveLength(1);
      expect(parsed.steps[0].title).toBe('click');
      expect(parsed.attachments).toHaveLength(1);
    });

    it('handles null steps/attachments', () => {
      const result = {
        id: 'r2',
        testId: 't2',
        runId: 'run2',
        retry: 0,
        status: 'failed' as const,
        durationMs: null,
        startedAt: null,
        errorMessage: 'assertion failed',
        errorStack: 'Error: assertion\n  at test.spec.ts:10',
        workerIndex: null,
        parallelIndex: null,
        stdout: null,
        stderr: null,
        steps: null,
        attachments: null,
      };

      const parsed = parseResult(result);
      expect(parsed.steps).toEqual([]);
      expect(parsed.attachments).toEqual([]);
      expect(parsed.error?.message).toBe('assertion failed');
    });
  });
});
