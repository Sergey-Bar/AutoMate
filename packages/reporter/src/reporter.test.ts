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
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(['failed', 'passed']);
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
