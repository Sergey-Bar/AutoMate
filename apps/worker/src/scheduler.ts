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

/**
 * Due report schedules, each turned into one queued delivery.
 *
 * Always `run_once`, never a catch-up: a daily report missed for five days is one report
 * on the sixth, not five. The idempotency key is the same `schedule:<id>:<dueAt>` a run
 * uses, and it is unique in `report_deliveries`, so two workers polling one occurrence
 * queue it once.
 *
 * @returns how many deliveries this poll queued
 */
export async function pollReportSchedules(
  store: ExecutionStore,
  now: Date,
  limit: number,
): Promise<number> {
  if (store.listDueReportSchedules === undefined || store.enqueueScheduledReport === undefined) {
    return 0;
  }
  let queued = 0;
  for (const schedule of await store.listDueReportSchedules(now, limit)) {
    assertTimezone(schedule.timezone);
    const cron = new Cron(schedule.cronExpr, { timezone: schedule.timezone });
    const following = requireNext(cron, now);
    const enqueued = await store.enqueueScheduledReport({
      schedule,
      scheduledFor: schedule.nextRunAt,
      nextRunAt: following.toISOString(),
      idempotencyKey: `schedule:${schedule.id}:${schedule.nextRunAt}`,
    });
    if (enqueued) queued += 1;
  }
  return queued;
}

/**
 * The UTC hour (`2026-10-23T11`) or day (`2026-10-23`) a moment falls in, and the instant the
 * next one starts. The slot is the sync's idempotency key, so a source is synced at most once
 * per slot however many workers poll it.
 */
export function deliverySlot(
  cadence: 'hourly' | 'daily',
  now: Date,
): { slot: string; next: string } {
  const iso = now.toISOString();
  if (cadence === 'hourly') {
    const start = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
    );
    return { slot: iso.slice(0, 13), next: new Date(start + 3_600_000).toISOString() };
  }
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { slot: iso.slice(0, 10), next: new Date(start + 86_400_000).toISOString() };
}

/**
 * Due delivery sources, each turned into one queued sync.
 *
 * Like a report, never a catch-up: a source missed for five days is synced once on the sixth,
 * and its cursors make that one sync read everything the five would have. The key is
 * `delivery:<sourceId>:<slot>` and is unique in `delivery_syncs`.
 *
 * @returns how many syncs this poll queued
 */
export async function pollDeliverySyncs(
  store: ExecutionStore,
  now: Date,
  limit: number,
): Promise<number> {
  if (store.listDueDeliverySources === undefined || store.enqueueDeliverySync === undefined) {
    return 0;
  }
  let queued = 0;
  for (const source of await store.listDueDeliverySources(now, limit)) {
    const { slot, next } = deliverySlot(source.cadence, now);
    const enqueued = await store.enqueueDeliverySync({
      source,
      now: now.toISOString(),
      nextSyncAt: next,
      idempotencyKey: `delivery:${source.id}:${slot}`,
    });
    if (enqueued) queued += 1;
  }
  return queued;
}
