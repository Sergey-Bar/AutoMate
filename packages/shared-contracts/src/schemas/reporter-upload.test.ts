/**
 * reporter-upload.test.ts — the upload wire format's own validation.
 *
 * This schema is the contract for `POST /api/v1/reporter/upload` with a JSON body, and it is
 * the *only* thing standing between a caller and a row in the database. It used to live in
 * `apps/api/src/routes/reporter.ts`, where it described rows the canonical model had no
 * counterpart for. Two properties are worth a test of their own here:
 *
 *  1. **A row must identify its test.** `id` or `testId`, and the refinement is on the row
 *     rather than on a later write: a test the caller cannot name cannot be correlated with
 *     its own attempts, and a row skipped at persistence is a test that disappeared between
 *     the request and the table.
 *  2. **An absent run status has no default.** A defaulted `passed` would be a green build
 *     out of a body that said nothing, which is the one substitution a release gate cannot
 *     catch.
 */

import { describe, expect, it } from 'vitest';
import { ReporterUploadSchema, ReporterUploadTestSchema } from './reporter-upload.js';

describe('an uploaded test row', () => {
  it('accepts either spelling of its identity', () => {
    expect(
      ReporterUploadTestSchema.safeParse({ id: 't-1', title: 'a', status: 'passed' }).success,
    ).toBe(true);
    expect(
      ReporterUploadTestSchema.safeParse({ testId: 't-1', title: 'a', status: 'passed' }).success,
    ).toBe(true);
  });

  it('refuses a row with neither, because a test nobody can name cannot be correlated', () => {
    const parsed = ReporterUploadTestSchema.safeParse({ title: 'a', status: 'passed' });
    expect(parsed.success).toBe(false);
    // The failure is on the row and names the field, not a bare "invalid upload".
    expect(
      ReporterUploadTestSchema.safeParse({ title: 'a', status: 'passed' }).error?.issues[0]?.path,
    ).toEqual(['id']);
  });

  it('accepts both timeout spellings, and refuses a negative duration', () => {
    expect(
      ReporterUploadTestSchema.safeParse({ id: 't', title: 'a', status: 'timedOut' }).success,
    ).toBe(true);
    expect(
      ReporterUploadTestSchema.safeParse({ id: 't', title: 'a', status: 'timed_out' }).success,
    ).toBe(true);
    // The parser collapses them to one canonical status on the way in, so rejecting one
    // would fail a real upload — Playwright emits one and other reporters send the other.
    expect(
      ReporterUploadTestSchema.safeParse({
        id: 't',
        title: 'a',
        status: 'timedOut',
        durationMs: -1,
      }).success,
    ).toBe(false);
  });

  it('declares the reason a test failed, so it cannot be dropped again', () => {
    // The field was always accepted — the schema was `.passthrough()` — and then written
    // nowhere, which is why a failed run recorded *that* a test failed and nothing about why.
    const parsed = ReporterUploadTestSchema.safeParse({
      id: 't',
      title: 'a',
      status: 'failed',
      error: { message: 'expected 1 to equal 2', code: 'E_ASSERT' },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.error?.message).toBe('expected 1 to equal 2');
  });
});

describe('the upload body', () => {
  it('defaults tests to an empty list rather than to a green run', () => {
    const parsed = ReporterUploadSchema.parse({ runId: 'r' });
    expect(parsed.tests).toEqual([]);
    // And there is no default for `status`: absent means "derive it from the rows", and a
    // defaulted `passed` would be a green build out of a body that said nothing.
    expect(parsed.status).toBeUndefined();
  });

  it('refuses a status the run vocabulary does not contain', () => {
    // `queued` is a *test* status and the column's default, not something a caller may
    // declare for a finished run. `passed` and `failed` are; `interrupted` is the harness
    // stopping a run, and `running` is a partial report.
    for (const status of ['queued', 'flaky', 'nonsense']) {
      expect(ReporterUploadSchema.safeParse({ runId: 'r', status }).success, status).toBe(false);
    }
    for (const status of ['running', 'passed', 'failed', 'interrupted']) {
      expect(ReporterUploadSchema.safeParse({ runId: 'r', status }).success, status).toBe(true);
    }
  });

  it('requires a run id, because a body without one is not a run', () => {
    expect(ReporterUploadSchema.safeParse({ tests: [] }).success).toBe(false);
    expect(ReporterUploadSchema.safeParse({ runId: '' }).success).toBe(false);
    expect(ReporterUploadSchema.safeParse({ runId: 'r' }).success).toBe(true);
  });

  it('carries the cohort and the timings the projection needs', () => {
    const parsed = ReporterUploadSchema.parse({
      runId: 'r',
      branch: 'main',
      commitSha: 'a'.repeat(40),
      environment: 'staging',
      triggeredBy: 'ci',
      startedAt: '2026-10-02T00:00:00.000Z',
      finishedAt: '2026-10-02T00:05:00.000Z',
      durationMs: 300_000,
      summary: { total: 2, passed: 1, failed: 1, flaky: 0, skipped: 0 },
    });
    // These were writeable only by a door that bypassed the canonical model, so a per-branch
    // cohort comparison was answerable only from the derived table.
    expect(parsed.branch).toBe('main');
    expect(parsed.environment).toBe('staging');
    expect(parsed.triggeredBy).toBe('ci');
    expect(parsed.durationMs).toBe(300_000);
    expect(parsed.summary?.failed).toBe(1);
  });

  it('refuses a negative count in the declared summary', () => {
    expect(ReporterUploadSchema.safeParse({ runId: 'r', summary: { total: -1 } }).success).toBe(
      false,
    );
  });
});
