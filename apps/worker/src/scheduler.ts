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
    let dueAt = schedule.nextRunAt;
    let next = requireNext(cron, new Date(dueAt));
    if (schedule.misfirePolicy === 'skip') {
      while (next.getTime() <= now.getTime()) {
        dueAt = next.toISOString();
        next = requireNext(cron, next);
      }
      await store.advanceSchedule(schedule.id, schedule.nextRunAt, next.toISOString());
      continue;
    }
    if (schedule.misfirePolicy === 'run_once') {
      const following = requireNext(cron, now);
      const result = await store.enqueueScheduledRun({
        schedule,
        scheduledFor: dueAt,
        nextRunAt: following.toISOString(),
        idempotencyKey: `schedule:${schedule.id}:${dueAt}`,
      });
      if (result) results.push(result);
      continue;
    }
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
  }
  return results;
}
