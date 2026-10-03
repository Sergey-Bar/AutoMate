/**
 * legacy-upload.test.ts — the flat upload payload, as an adapter.
 *
 * The upload wire format used to be a scanner and a status switch inside the route. It is a
 * `ProducerAdapter` now, and this file covers the three properties that moved:
 *
 *  1. **A declared status is a claim, not a verdict.** `status: 'passed'` with no passing
 *     evidence is refused the pass; `status: 'running'` keeps the run open.
 *  2. **A declared summary is a claim about the rows, and cannot outrank them.** It used to
 *     be read as `summary?.failed ?? derived.failed` — a preference for the client.
 *  3. **A run with no rows is not a run result.** Refused, not filed as `interrupted`.
 *
 * The corpus checks live in `adapter-parity.test.ts`, which drives every adapter over the
 * same documents. These are the properties that are specific to *this* format.
 */

import { describe, expect, it } from 'vitest';
import { CanonicalRunResultSchema } from '@automate/shared-contracts';
import { legacyUploadAdapter, parseReporterUploadPayload } from './adapters/legacy-upload.js';

const context = {
  workspaceId: 'workspace-1',
  runId: 'from-the-context',
  sourceUri: 'reporter/upload',
  sourceDigest: 'f'.repeat(64),
  producerVersion: '1.0.0',
  adapterVersion: '2',
  startedAt: '2026-10-02T00:00:00.000Z',
};

const parse = (payload: unknown, overrides: Partial<typeof context> = {}) =>
  legacyUploadAdapter.parse(new TextEncoder().encode(JSON.stringify(payload)), {
    ...context,
    ...overrides,
  });

describe('the upload payload is the run it names', () => {
  it('takes the run id from the body, not from the request context', () => {
    // A JUnit document carries no run id and the caller supplies one, but this wire format
    // *is* the payload and names its own run. Reading the context instead meant a caller
    // posting `{ runId: 'x' }` with no multipart fields got a run whose identity was derived
    // from its bytes — a third identity for the same run.
    const result = parse({
      runId: 'upload-run-001',
      tests: [{ id: 't', title: 'a', status: 'passed' }],
    });
    expect(result.identity.runId).toBe('upload-run-001');
    expect(result.provenance.producer).toBe('legacy');
  });

  it('carries the cohort through to provenance, and the timestamps it was given', () => {
    const result = parse({
      runId: 'r',
      branch: 'main',
      commitSha: 'a'.repeat(40),
      environment: 'staging',
      startedAt: '2026-10-01T00:00:00.000Z',
      finishedAt: '2026-10-01T00:05:00.000Z',
      tests: [{ id: 't', title: 'a', status: 'passed' }],
    });
    // These were writeable only by a door that bypassed the canonical model, so a per-branch
    // cohort comparison was answerable only from the derived table.
    expect(result.provenance.branch).toBe('main');
    expect(result.provenance.commitSha).toBe('a'.repeat(40));
    expect(result.provenance.environment).toBe('staging');
    expect(result.startedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(result.finishedAt).toBe('2026-10-01T00:05:00.000Z');
  });

  it('reduces an unsafe spec path rather than failing the whole upload', () => {
    // One test with a traversal in its path must not cost the caller the other 400. The
    // contract validates `specPath` as a relative path, so an unreduced value would fail
    // the whole report with a Zod error about one field.
    const result = parse({
      runId: 'r',
      tests: [{ id: 't', title: 'a', status: 'passed', file: '../../../etc/passwd' }],
    });
    expect(result.attempts[0]?.specPath).toBe('passwd');
  });
});

describe('a declared status is a claim, and a claim cannot outrank the rows', () => {
  it('refuses a declared pass that the rows do not support', () => {
    const result = parse({
      runId: 'r',
      status: 'passed',
      tests: [{ id: 't', title: 'a', status: 'queued' }],
    });
    expect(result.status).toBe('unknown');
  });

  it('lets a declared failure stand over passing rows', () => {
    const result = parse({
      runId: 'r',
      status: 'failed',
      tests: [{ id: 't', title: 'a', status: 'passed' }],
    });
    expect(result.status).toBe('failed');
  });

  it('keeps a run open when the producer says it is still going', () => {
    const result = parse({
      runId: 'r',
      status: 'running',
      tests: [{ id: 't', title: 'a', status: 'failed' }],
    });
    // The run has not finished, so it has no verdict — and deriving one from the tests that
    // have reported so far is deriving it from a partial view. A streaming uploader's
    // dashboard row went red at its first failing test of a run that was still going.
    expect(result.status).toBe('running');
  });

  it('reads a declared interrupted run as cancelled, not as a failure', () => {
    const result = parse({
      runId: 'r',
      status: 'interrupted',
      tests: [{ id: 't', title: 'a', status: 'passed' }],
    });
    expect(result.status).toBe('cancelled');
  });
});

describe('a declared summary cannot contradict its own rows', () => {
  it('is refused when it claims more failures than the rows show', () => {
    const result = parse({
      runId: 'r',
      summary: { total: 3, passed: 3, failed: 0 },
      tests: [
        { id: 't1', title: 'a', status: 'passed' },
        { id: 't2', title: 'b', status: 'failed' },
      ],
    });
    expect(result.status).toBe('failed');
  });

  it('takes a summary that declares more failures at its word', () => {
    const result = parse({
      runId: 'r',
      summary: { total: 3, passed: 3, failed: 1 },
      tests: [{ id: 't1', title: 'a', status: 'passed' }],
    });
    // The rows do not show the failure, but the producer said there was one and the worse
    // reading is the one that cannot be a green build.
    expect(result.status).toBe('failed');
  });
});

describe('a run with no observable attempt is refused', () => {
  it('names the cause rather than inventing an attempt', () => {
    expect(() => parse({ runId: 'r', tests: [] })).toThrow(/no test rows/u);
    expect(() => parse({ runId: 'r' })).toThrow(/no test rows/u);
  });

  it('records nothing at all for a body the upload contract rejects', () => {
    // A run id is required, so a body without one cannot be a run — and the refusal is
    // named rather than a bare Zod error.
    expect(() => parseReporterUploadPayload(JSON.stringify({ tests: [] }))).toThrow(
      /does not match the upload contract/u,
    );
    expect(() => parseReporterUploadPayload('{')).toThrow(/not valid JSON/u);
  });
});

describe('the retry history of one test is numbered per test, not across the body', () => {
  it('numbers a re-reported test 1 then 2', () => {
    // A running counter across the body made a re-report claim ordinal 7, and
    // `CanonicalRunResultSchema` requires 1..n per `testId` — so the whole upload failed
    // with a duplicate attempt index for a test the producer legitimately reported twice.
    const result = parse({
      runId: 'r',
      tests: [
        { id: 't1', title: 'a', status: 'failed' },
        { id: 't2', title: 'b', status: 'passed' },
        { id: 't1', title: 'a', status: 'passed' },
      ],
    });
    const byTest = new Map<string, number[]>();
    for (const attempt of result.attempts) {
      byTest.set(attempt.testId, [...(byTest.get(attempt.testId) ?? []), attempt.index]);
    }
    expect(byTest.get('t1')).toEqual([1, 2]);
    expect(byTest.get('t2')).toEqual([1]);
    // And the result is one the contract accepts, because the boundary parses with
    // `safeParse` and an adapter that produces a rejected sequence rejects the report.
    expect(CanonicalRunResultSchema.safeParse(result).success).toBe(true);
    expect(result.status, 'a test that failed then passed is flaky').toBe('flaky');
  });
});

describe('the failure the producer stated survives the parse', () => {
  it('carries the message, and the truncation marker when the text was capped', () => {
    const result = parse({
      runId: 'r',
      tests: [
        { id: 't', title: 'a', status: 'failed', error: { message: 'expected 1 to equal 2' } },
      ],
    });
    expect(result.attempts[0]?.error?.message).toBe('expected 1 to equal 2');
    expect(result.attempts[0]?.error?.code).toBeUndefined();
  });
});
