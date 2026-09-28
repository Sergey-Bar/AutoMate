import { describe, expect, it } from 'vitest';
import { playwrightJsonAdapter } from './adapters/playwright-json.js';
import { normalizeLegacyEvent } from './compatibility/legacy-reporter.js';

const context = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  projectId: 'project-1',
  sourceUri: 'artifact://run-1/report.json',
  sourceDigest: 'c'.repeat(64),
  producerVersion: '1.63.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-09-25T00:00:00.000Z',
  finishedAt: '2026-09-25T00:01:00.000Z',
};

describe('producer adapters', () => {
  it('parses nested Playwright suites and preserves attempts', () => {
    const result = playwrightJsonAdapter.parse(
      new TextEncoder().encode(
        JSON.stringify({
          suites: [
            {
              title: 'suite',
              file: 'tests/example.spec.ts',
              suites: [
                {
                  title: 'nested',
                  file: 'tests/example.spec.ts',
                  tests: [
                    {
                      title: 'works',
                      results: [
                        { status: 'failed', duration: 10 },
                        { status: 'passed', duration: 8 },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
      context,
    );
    expect(result.attempts).toHaveLength(2);
    // The retry history is evidence and is preserved verbatim.
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(['failed', 'passed']);
    // A test that failed once and then passed is flaky. The run is not green
    // and it is not a hard failure either.
    expect(result.attempts.every((attempt) => attempt.flakiness === 'observed')).toBe(true);
    expect(result.status).toBe('flaky');
  });

  it('reports a single-attempt pass as clean, not flaky', () => {
    const result = playwrightJsonAdapter.parse(
      new TextEncoder().encode(
        JSON.stringify({
          suites: [
            {
              title: 'suite',
              file: 'tests/example.spec.ts',
              tests: [{ title: 'works', results: [{ status: 'passed', duration: 5 }] }],
            },
          ],
        }),
      ),
      context,
    );
    expect(result.status).toBe('passed');
    expect(result.attempts[0]?.flakiness).toBe('unknown');
  });

  it('reports a test that failed on its final attempt as a hard failure', () => {
    const result = playwrightJsonAdapter.parse(
      new TextEncoder().encode(
        JSON.stringify({
          suites: [
            {
              title: 'suite',
              file: 'tests/example.spec.ts',
              tests: [
                {
                  title: 'stays broken',
                  results: [
                    { status: 'failed', duration: 5 },
                    { status: 'failed', duration: 6 },
                  ],
                },
              ],
            },
          ],
        }),
      ),
      context,
    );
    expect(result.status).toBe('failed');
  });

  it('preserves Playwright durations, errors, and artifacts', () => {
    const result = playwrightJsonAdapter.parse(
      new TextEncoder().encode(
        JSON.stringify({
          suites: [
            {
              title: 'suite',
              file: 'tests/example.spec.ts',
              tests: [
                {
                  title: 'fails',
                  results: [
                    {
                      status: 'failed',
                      duration: 42,
                      error: { message: 'boom' },
                      attachments: [
                        { name: 'trace.zip', contentType: 'application/zip', body: btoa('trace') },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
      context,
    );
    expect(result.attempts[0]).toMatchObject({
      durationMs: 42,
      status: 'failed',
      error: { message: 'boom' },
    });
    expect(result.evidence[0]?.digest).toHaveLength(64);
  });
  it('normalizes legacy flat events into the canonical envelope', () => {
    const event = normalizeLegacyEvent(
      { type: 'test:end', runId: 'run-1', payload: { testId: 'test-1', status: 'passed' } },
      { workspaceId: 'workspace-1', eventId: 'event-1', occurredAt: context.startedAt },
    );
    expect(event.type).toBe('check.completed');
    expect(event.contractVersion).toBe('2');
  });

  it('normalizes run and test lifecycle legacy events', () => {
    const contextData = {
      workspaceId: 'workspace-1',
      eventId: 'event-1',
      occurredAt: context.startedAt,
    };
    expect(normalizeLegacyEvent({ type: 'run:start', runId: 'run-1' }, contextData).type).toBe(
      'run.started',
    );
    expect(
      normalizeLegacyEvent(
        { type: 'run:end', runId: 'run-1', payload: { status: 'passed' } },
        contextData,
      ).type,
    ).toBe('run.completed');
    expect(
      normalizeLegacyEvent(
        { type: 'test:begin', runId: 'run-1', payload: { testId: 'test-1' } },
        contextData,
      ).type,
    ).toBe('check.started');
    expect(() => normalizeLegacyEvent(null, contextData)).toThrow();
  });
  it('rejects unsupported legacy event types', () => {
    expect(() =>
      normalizeLegacyEvent(
        { type: 'unknown', runId: 'run-1' },
        { workspaceId: 'workspace-1', eventId: 'event-1', occurredAt: context.startedAt },
      ),
    ).toThrow();
  });
});

describe('Playwright identity, and refusing an unreadable report', () => {
  it('gives every test in the report its own evidence URIs', async () => {
    // Ledger F-5. `testIndex` was the **spec's** position in the collected list, and
    // it was threaded unchanged into `evidenceFor` for every test inside that spec. So
    // two tests in one spec, with the same attempt index and the same attachment name
    // — two `trace.zip`, which Playwright emits for *every* test — produced
    // byte-identical evidence URIs. Nothing downstream de-duplicates by URI, so both
    // entries survived with the same `uri` and different digests.
    const report = {
      suites: [
        {
          title: 'suite',
          file: 'tests/a.spec.ts',
          tests: [
            {
              title: 'first',
              results: [
                {
                  status: 'passed',
                  attachments: [
                    {
                      name: 'trace.zip',
                      contentType: 'application/zip',
                      body: Buffer.from('trace-bytes').toString('base64'),
                    },
                  ],
                },
              ],
            },
            {
              title: 'second',
              results: [
                {
                  status: 'passed',
                  attachments: [
                    {
                      name: 'trace.zip',
                      contentType: 'application/zip',
                      body: Buffer.from('trace-bytes').toString('base64'),
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          title: 'other',
          file: 'tests/b.spec.ts',
          tests: [
            {
              title: 'first',
              results: [
                {
                  status: 'passed',
                  attachments: [
                    {
                      name: 'trace.zip',
                      contentType: 'application/zip',
                      body: Buffer.from('trace-bytes').toString('base64'),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = playwrightJsonAdapter.parse(
      new TextEncoder().encode(JSON.stringify(report)),
      context,
    );
    const uris = result.attempts.map((attempt) => attempt.evidence[0]?.uri);

    // Three tests, three attachments with the same name. Every URI must be distinct,
    // including the one in a *different spec* — a per-spec index would still collide
    // there, which is why the ordinal is taken across the whole report.
    expect(new Set(uris).size, `evidence URIs must be unique, got ${JSON.stringify(uris)}`).toBe(3);
  });

  it('gives an untitled test in each spec a distinct id', () => {
    // The same ordinal also backs the `test.title ?? …` fallback in `testId`, so two
    // untitled tests in different specs no longer share an id either.
    const report = {
      suites: [
        { title: 'one', file: 'tests/a.spec.ts', tests: [{ results: [{ status: 'passed' }] }] },
        { title: 'two', file: 'tests/b.spec.ts', tests: [{ results: [{ status: 'passed' }] }] },
      ],
    };

    const result = playwrightJsonAdapter.parse(
      new TextEncoder().encode(JSON.stringify(report)),
      context,
    );
    // Same spec file absent, so the fallback is the ordinal and the two must differ.
    const ids = result.attempts.map((attempt) => attempt.testId);
    expect(new Set(ids).size).toBe(2);
  });

  it('refuses a malformed report as an ingestion error, not a raw SyntaxError', () => {
    // Ledger F-7. `JSON.parse` on the uploaded body had no guard, and `parse` declares
    // no error channel, so a malformed upload escaped as a raw `SyntaxError` —
    // indistinguishable from the adapter's own deliberate refusals, which are plain
    // `Error`s. The API's equivalent parse is equally unguarded *inside* but the route
    // wraps it, so the boundary rendered a classified ingestion error for one and a
    // `SyntaxError` for the other. Same boundary, two different answers.
    const refuse = (body: string): unknown => {
      try {
        playwrightJsonAdapter.parse(new TextEncoder().encode(body), context);
        return undefined;
      } catch (error) {
        return error;
      }
    };

    const malformed = refuse('{ not json');
    expect(malformed, 'a malformed report must be refused').toBeInstanceOf(Error);
    expect(malformed).not.toBeInstanceOf(SyntaxError);
    expect((malformed as Error).message).toMatch(/playwright/i);
    // The underlying parser failure is carried, not discarded: an operator debugging
    // an upload needs the position, and wrapping without `cause` throws it away.
    expect((malformed as Error).cause).toBeInstanceOf(SyntaxError);

    // A body that parses but is not a report is a different refusal, and saying so is
    // more useful than letting a shape error surface from somewhere further in.
    expect((refuse('[]') as Error).message).toMatch(/not a JSON object/);
    expect((refuse('"a string"') as Error).message).toMatch(/not a JSON object/);
  });
});
