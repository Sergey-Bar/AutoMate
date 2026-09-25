import { describe, expect, it } from 'vitest';
import { InMemoryExecutionStore } from './in-memory-store.js';
import { pollSchedules, UnsupportedScheduleError } from './scheduler.js';
import type { WorkerSchedule } from './types.js';

const request = {
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  environmentId: 'environment-1',
  releaseId: 'release-1',
  branch: 'main',
  commit: 'abc123',
  requiredCapabilities: ['playwright'],
  configuration: { targetUrl: 'https://allowed.test' },
};

function schedule(overrides: Partial<WorkerSchedule> = {}): WorkerSchedule {
  return {
    id: 'schedule-1',
    cronExpr: '*/5 * * * *',
    timezone: 'UTC',
    enabled: true,
    nextRunAt: '2026-01-01T00:00:00.000Z',
    request,
    misfirePolicy: 'run_once',
    ...overrides,
  };
}

describe('schedule polling', () => {
  it('enqueues one deterministic UTC occurrence and advances atomically', async () => {
    const now = new Date('2026-01-01T00:05:00.000Z');
    const store = new InMemoryExecutionStore({ now: () => now });
    store.addSchedule(schedule());

    const results = await pollSchedules(store, now, 100);

    expect(results).toHaveLength(1);
    expect(store.listJobs()).toHaveLength(1);
    expect(store.listJobs()[0]).toMatchObject({
      runId: results[0]?.runId,
      availableAt: '2026-01-01T00:00:00.000Z',
      spec: { targetUrl: 'https://allowed.test' },
    });
    const duplicate = await store.enqueueScheduledRun({
      schedule: schedule(),
      scheduledFor: '2026-01-01T00:00:00.000Z',
      nextRunAt: '2026-01-01T00:10:00.000Z',
      idempotencyKey: 'schedule:schedule-1:2026-01-01T00:00:00.000Z',
    });
    expect(duplicate).toMatchObject({ runId: results[0]?.runId, duplicate: true });
  });

  it('supports bounded catch-up and rejects unsupported controls explicitly', async () => {
    const now = new Date('2026-01-01T03:00:00.000Z');
    const catchUp = new InMemoryExecutionStore({ now: () => now });
    catchUp.addSchedule(
      schedule({
        cronExpr: '0 * * * *',
        misfirePolicy: 'catch_up',
      }),
    );
    await pollSchedules(catchUp, now, 100);
    expect(catchUp.listJobs()).toHaveLength(3);

    const blackout = new InMemoryExecutionStore({ now: () => now });
    blackout.addSchedule(schedule({ blackoutWindows: [{ start: '23:00', end: '01:00' }] }));
    await expect(pollSchedules(blackout, now, 100)).rejects.toBeInstanceOf(
      UnsupportedScheduleError,
    );

    const timezone = new InMemoryExecutionStore({ now: () => now });
    timezone.addSchedule(schedule({ timezone: 'Mars/Olympus' }));
    await expect(pollSchedules(timezone, now, 100)).rejects.toBeInstanceOf(
      UnsupportedScheduleError,
    );
  });
});
