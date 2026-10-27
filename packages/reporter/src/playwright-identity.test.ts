import { describe, expect, it } from 'vitest';
import { testIdentity } from '@automate/shared-contracts';
import { playwrightJsonAdapter } from './adapters/playwright-json.js';
import type { ProducerContext } from './adapter.js';

/**
 * Which test a Playwright result is a result of.
 *
 * The report below is the shape Playwright's JSON reporter writes: one root suite per file
 * (titled with the file), a `describe` as a nested suite, specs carrying the title, and one
 * entry in `spec.tests` **per project**. A test has no `title` of its own — the spec has it.
 *
 * The adapter's `testId` was `${file}:${test.title ?? ordinal}`. `test.title` is always
 * absent, so the id was the test's position in the report: stable only until a test was
 * added above it, and the same test in two projects carried two positions and no project.
 */
const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  projectId: 'project-1',
  sourceUri: 'artifact://run-1/report',
  sourceDigest: 'f'.repeat(64),
  producerVersion: '1.0.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-09-25T00:00:00.000Z',
  finishedAt: '2026-09-25T00:00:10.000Z',
};

const result = (status: string) => ({ status, duration: 5, startTime: context.startedAt });

function report(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      suites: [
        {
          title: 'tests/checkout.spec.ts',
          file: 'tests/checkout.spec.ts',
          specs: [
            {
              title: 'loads',
              file: 'tests/checkout.spec.ts',
              tests: [{ projectName: 'chromium', status: 'expected', results: [result('passed')] }],
            },
          ],
          suites: [
            {
              title: 'guest',
              file: 'tests/checkout.spec.ts',
              specs: [
                {
                  title: 'pays',
                  file: 'tests/checkout.spec.ts',
                  tests: [
                    { projectName: 'chromium', status: 'expected', results: [result('passed')] },
                    { projectName: 'webkit', status: 'unexpected', results: [result('failed')] },
                  ],
                },
              ],
            },
            {
              title: 'member',
              file: 'tests/checkout.spec.ts',
              specs: [
                {
                  title: 'pays',
                  file: 'tests/checkout.spec.ts',
                  tests: [
                    { projectName: 'chromium', status: 'expected', results: [result('passed')] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  );
}

describe('Playwright test identity', () => {
  const attempts = playwrightJsonAdapter.parse(report(), context).attempts;

  it('is the shared identity: file, describe path, title and project', () => {
    expect(attempts.map((attempt) => attempt.testId)).toEqual([
      testIdentity({ file: 'tests/checkout.spec.ts', title: 'loads', project: 'chromium' }),
      testIdentity({
        file: 'tests/checkout.spec.ts',
        describePath: ['guest'],
        title: 'pays',
        project: 'chromium',
      }),
      testIdentity({
        file: 'tests/checkout.spec.ts',
        describePath: ['guest'],
        title: 'pays',
        project: 'webkit',
      }),
      testIdentity({
        file: 'tests/checkout.spec.ts',
        describePath: ['member'],
        title: 'pays',
        project: 'chromium',
      }),
    ]);
  });

  it('carries the project and the describe path on the attempt, not only inside the id', () => {
    const webkit = attempts[2];
    expect(webkit?.project).toBe('webkit');
    expect(webkit?.describePath).toEqual(['guest']);
    expect(webkit?.title).toBe('pays');
    // The root suite is the file, not a describe block.
    expect(attempts[0]?.describePath).toEqual([]);
  });

  it('does not depend on where the test sits in the report', () => {
    const ids = new Set(attempts.map((attempt) => attempt.testId));
    expect(ids.size).toBe(attempts.length);
    for (const id of ids) expect(id).not.toMatch(/:\d+$/u);
  });
});

describe('Playwright errors outside tests', () => {
  /** A report whose one test passed and whose worker teardown threw. */
  function withTopLevelError(): Uint8Array {
    const passing = JSON.parse(new TextDecoder().decode(report())) as Record<string, unknown>;
    return new TextEncoder().encode(
      JSON.stringify({ ...passing, errors: [{ message: 'Error: teardown failed\n    at x' }] }),
    );
  }

  it('records them on the result, and fails the run they belong to', () => {
    const result = playwrightJsonAdapter.parse(withTopLevelError(), context);
    expect(result.reportErrors).toEqual([{ message: 'Error: teardown failed\n    at x' }]);
    expect(result.status).toBe('failed');
  });

  it('records none for a report without any', () => {
    expect(playwrightJsonAdapter.parse(report(), context).reportErrors).toBeUndefined();
  });
});
