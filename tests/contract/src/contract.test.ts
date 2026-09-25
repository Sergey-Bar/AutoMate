import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CanonicalRunResultSchema } from '@automate/shared-contracts';
import { playwrightJsonAdapter } from '@automate/reporter';
import { InMemoryRealtimeBus } from '@automate/realtime';

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/canonical-run.json', import.meta.url), 'utf8'),
) as unknown;

describe('canonical contract fixtures', () => {
  it('parses the producer fixture', () => {
    expect(CanonicalRunResultSchema.safeParse(fixture).success).toBe(true);
  });

  it('replays events with stable cursors', () => {
    const bus = new InMemoryRealtimeBus(2);
    bus.publish({ eventType: 'run.updated', occurredAt: '2026-09-25T00:00:00.000Z', data: {} });
    bus.publish({ eventType: 'run.updated', occurredAt: '2026-09-25T00:00:01.000Z', data: {} });
    const replay = bus.subscribe('1');
    expect(replay.replay.map((event) => event.cursor)).toEqual(['2']);
  });

  it('keeps the producer adapter deterministic', () => {
    const input = new TextEncoder().encode(
      JSON.stringify({
        suites: [
          {
            title: 'suite',
            file: 'tests/example.spec.ts',
            tests: [{ title: 'works', results: [{ status: 'passed' }] }],
          },
        ],
      }),
    );
    const context = {
      workspaceId: 'workspace-1',
      runId: 'run-1',
      sourceUri: 'artifact://run-1/report.json',
      sourceDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      producerVersion: '1.63.0',
      adapterVersion: '1.0.0',
      startedAt: '2026-09-25T00:00:00.000Z',
    };
    expect(playwrightJsonAdapter.parse(input, context).attempts).toHaveLength(1);
  });
});
