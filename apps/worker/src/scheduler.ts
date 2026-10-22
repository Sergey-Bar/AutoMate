import { Cron } from 'croner';
import type { ExecutionStore, ScheduledEnqueueResult } from './types.js';

export class UnsupportedScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedScheduleError';
  }
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new UnsupportedScheduleError(`Invalid schedule timezone: ${timezone}`);
  }
}

function requireNext(cron: Cron, after: Date): Date {
  const next = cron.nextRun(after);
  if (!next) throw new UnsupportedScheduleError('Schedule has no future occurrence');
  return next;
}

type DueSchedule = Awaited<ReturnType<ExecutionStore['listDueSchedules']>>[number];

/** `skip` discards every missed occurrence: the pointer jumps to the first future one. */
async function skipMissed(
  store: ExecutionStore,
  schedule: DueSchedule,
  cron: Cron,
  now: Date,
  first: Date,
): Promise<void> {
  let next = first;
  while (next.getTime() <= now.getTime()) {
    // `dueAt` is deliberately NOT advanced here. `skip` discards every missed
    // occurrence, so the schedule pointer jumps straight to the first future one
    // and the update below deliberately compares against the schedule's own
    // `nextRunAt`. Writing `dueAt` on the way past produced a value nothing read -
    // which is what ESLint 10's `no-useless-assignment` reported on this line.
    next = requireNext(cron, next);
  }
  await store.advanceSchedule(schedule.id, schedule.nextRunAt, next.toISOString());
}

/** `run_once` enqueues one run for the missed window and points at the next future occurrence. */
async function runOnceMissed(
  store: ExecutionStore,
  schedule: DueSchedule,
  cron: Cron,
  now: Date,
): Promise<ScheduledEnqueueResult[]> {
  const dueAt = schedule.nextRunAt;
  const following = requireNext(cron, now);
  const result = await store.enqueueScheduledRun({
    schedule,
    scheduledFor: dueAt,
    nextRunAt: following.toISOString(),
    idempotencyKey: `schedule:${schedule.id}:${dueAt}`,
  });
  return result ? [result] : [];
}

/** Anything else catches up: one run per missed occurrence, up to a hundred. */
async function catchUpMissed(
  store: ExecutionStore,
  schedule: DueSchedule,
  cron: Cron,
  now: Date,
  first: Date,
): Promise<ScheduledEnqueueResult[]> {
  const results: ScheduledEnqueueResult[] = [];
  let dueAt = schedule.nextRunAt;
  let next = first;
  let processed = 0;
  while (next.getTime() <= now.getTime()) {
    if (++processed > 100) {
      throw new UnsupportedScheduleError('Schedule catch-up exceeds 100 missed occurrences');
    }
    const result = await store.enqueueScheduledRun({
      schedule,
      scheduledFor: dueAt,
      nextRunAt: next.toISOString(),
      idempotencyKey: `schedule:${schedule.id}:${dueAt}`,
    });
    if (result) results.push(result);
    dueAt = next.toISOString();
    next = requireNext(cron, next);
  }
  await store.advanceSchedule(schedule.id, dueAt, next.toISOString());
  return results;
}

export async function pollSchedules(
  store: ExecutionStore,
  now: Date,
  limit: number,
): Promise<ScheduledEnqueueResult[]> {
  const schedules = await store.listDueSchedules(now, limit);
  const results: ScheduledEnqueueResult[] = [];
  for (const schedule of schedules) {
    if (schedule.blackoutWindows !== undefined) {
      throw new UnsupportedScheduleError('Blackout windows are not supported');
    }
    assertTimezone(schedule.timezone);
    const cron = new Cron(schedule.cronExpr, { timezone: schedule.timezone });
    const first = requireNext(cron, new Date(schedule.nextRunAt));
    if (schedule.misfirePolicy === 'skip') {
      await skipMissed(store, schedule, cron, now, first);
    } else if (schedule.misfirePolicy === 'run_once') {
      results.push(...(await runOnceMissed(store, schedule, cron, now)));
    } else {
      results.push(...(await catchUpMissed(store, schedule, cron, now, first)));
    }
  }
  return results;
}
