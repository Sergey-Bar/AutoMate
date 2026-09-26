import {
  DrizzleOutboxRepository,
  type AppendOutboxEvent,
  type OutboxDatabase,
  type OutboxEvent,
  type OutboxReadPage,
} from '@automate/db';

type FeedListener = (event: OutboxEvent) => void | Promise<void>;

interface FeedSubscription {
  cursor: number;
  listener: FeedListener;
}

interface FeedPump {
  cursor: number;
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  subscriptions: Set<FeedSubscription>;
}

export class DrizzleRealtimeFeed {
  private readonly outbox: DrizzleOutboxRepository;
  private readonly pumps = new Map<string, FeedPump>();

  constructor(db: OutboxDatabase) {
    this.outbox = new DrizzleOutboxRepository(db);
  }

  append(event: AppendOutboxEvent) {
    return this.outbox.append(event);
  }

  appendMany(events: AppendOutboxEvent[]) {
    return this.outbox.appendMany(events);
  }

  readAfter(page: OutboxReadPage) {
    return this.outbox.readAfter(page);
  }

  getRetentionFloor(workspaceId?: string) {
    return this.outbox.getRetentionFloor(workspaceId);
  }

  purgeExpired(now?: Date) {
    return this.outbox.purgeExpired(now);
  }

  subscribe(
    workspaceId: string,
    afterSequence: number,
    listener: FeedListener,
    pollIntervalMs = 1000,
  ): () => void {
    const pump = this.pumps.get(workspaceId) ?? {
      cursor: afterSequence,
      intervalMs: pollIntervalMs,
      timer: null,
      running: false,
      subscriptions: new Set<FeedSubscription>(),
    };
    const subscription: FeedSubscription = { cursor: afterSequence, listener };
    pump.subscriptions.add(subscription);
    pump.cursor = Math.min(pump.cursor, afterSequence);
    if (!pump.timer) {
      pump.timer = setInterval(() => void this.pump(workspaceId, pump), pump.intervalMs);
      pump.timer.unref?.();
    }
    this.pumps.set(workspaceId, pump);
    void this.pump(workspaceId, pump);
    return () => {
      pump.subscriptions.delete(subscription);
      this.recomputeCursor(pump);
      if (pump.subscriptions.size === 0 && pump.timer) {
        clearInterval(pump.timer);
        pump.timer = null;
        this.pumps.delete(workspaceId);
      }
    };
  }

  private recomputeCursor(pump: FeedPump): void {
    if (pump.subscriptions.size === 0) return;
    pump.cursor = Math.min(...[...pump.subscriptions].map((subscription) => subscription.cursor));
  }

  /**
   * Delivers a page to every subscription, one at a time and in isolation.
   *
   * Three properties, all of which the previous version got wrong:
   *
   *  - **A subscription's cursor advances only after its listener resolves.** It
   *    used to advance *before* the call, so a listener that threw — an SSE write
   *    to a client that had already gone away — advanced the cursor past an
   *    event that was therefore never delivered and never delivered again. The
   *    loss was silent and permanent.
   *  - **One failing subscriber does not stall the others.** The loop was
   *    `for (subscription) await subscription.listener(...)`, so a throw on the
   *    first subscriber aborted the page for every remaining subscriber of the
   *    same workspace. Each is now called in its own `try`, and the shared
   *    cursor is derived from the subscriptions rather than advanced
   *    independently, so a lagging subscriber cannot be skipped.
   *  - **A failure is logged.** The `catch { return; }` around the whole pump
   *    discarded the error, so an outbox that had started failing looked
   *    exactly like an outbox with nothing to say.
   */
  private async pump(workspaceId: string, pump: FeedPump): Promise<void> {
    if (pump.running || pump.subscriptions.size === 0) return;
    pump.running = true;
    try {
      this.recomputeCursor(pump);
      const page = await this.outbox.readAfter({
        workspaceId,
        afterSequence: pump.cursor,
        limit: 100,
      });
      for (const event of page) {
        for (const subscription of pump.subscriptions) {
          if (event.sequence <= subscription.cursor) continue;
          try {
            await subscription.listener(event);
            // Only now is the event this subscriber's.
            subscription.cursor = event.sequence;
          } catch (error) {
            // Deliberately not advancing: the next pump retries the event, which
            // is the point of `evidence before claims` applied to a live stream.
            console.error('outbox subscription failed; event will be retried', {
              workspaceId,
              sequence: event.sequence,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    } catch (error) {
      console.error('outbox pump failed', {
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      pump.running = false;
    }
  }
}
