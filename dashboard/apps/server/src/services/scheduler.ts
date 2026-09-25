/**
 * apps/server/src/services/scheduler.ts
 *
 * Cron-based run scheduler. Reads the schedules table and triggers runs at cron times.
 */
import type { ReporterBridge } from './reporter-bridge.js';
import { db } from '../db/client.js';
import { schedules } from '../db/schema.js';
import { eq } from 'drizzle-orm';

interface SchedulerDeps {
  bridge: ReporterBridge;
  runner: { startRun: (options: Record<string, unknown>, bridge: ReporterBridge) => Promise<string> };
}

class Scheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private deps: SchedulerDeps | null = null;

  /** Start the scheduler — loads all enabled schedules and sets up intervals */
  async start(deps: SchedulerDeps) {
    this.deps = deps;
    await this.reload();
  }

  /** Reload schedules from DB */
  async reload() {
    // Clear existing timers
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();

    const rows = await db.select().from(schedules);
    for (const schedule of rows) {
      if (!schedule.enabled) continue;
      this.schedule(schedule);
    }
  }

  private schedule(schedule: typeof schedules.$inferSelect) {
    // Simple interval-based scheduling (cron parsing would use node-cron in production)
    // For now: parse cron expr for interval approximation
    const intervalMs = parseCronToInterval(schedule.cronExpr);
    if (intervalMs <= 0) return;

    const timer = setInterval(async () => {
      if (!this.deps) return;
      try {
        const options = schedule.runOptions ? JSON.parse(schedule.runOptions) : {};
        await this.deps.runner.startRun(options, this.deps.bridge);
        await db
          .update(schedules)
          .set({ lastRunAt: new Date().toISOString() })
          .where(eq(schedules.id, schedule.id));
      } catch (err) {
        process.stderr.write(`[scheduler] Failed to run schedule ${schedule.id}: ${(err as Error).message}\n`);
      }
    }, intervalMs);

    this.timers.set(schedule.id, timer);
  }

  stop() {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }
}

// Simple cron-to-interval converter.
// Supports: "* * * * *" (every minute), "*/5 * * * *" (every 5 min), etc.
// Falls back to 60 seconds for complex expressions.
function parseCronToInterval(expr: string): number {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return 60_000;

  const minute = parts[0] ?? '';
  const hour = parts[1] ?? '';

  // Every N minutes: */N * * * *
  if (minute.startsWith('*/')) {
    const n = parseInt(minute.slice(2), 10);
    return isNaN(n) ? 60_000 : n * 60_000;
  }

  // Every minute: * * * * *
  if (minute === '*' && hour === '*') return 60_000;

  // Every N hours: 0 */N * * * or fixed-minute */N
  if (hour.startsWith('*/')) {
    const n = parseInt(hour.slice(2), 10);
    return isNaN(n) ? 3_600_000 : n * 3_600_000;
  }

  // Fixed minute, every hour: N * * * *
  if (/^\d+$/.test(minute) && hour === '*') return 3_600_000;

  // Default: daily for complex expressions
  return 86_400_000;
}

export const scheduler = new Scheduler();
