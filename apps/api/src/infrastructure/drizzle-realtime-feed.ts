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
          if (event.sequence > subscription.cursor) {
            subscription.cursor = event.sequence;
            await subscription.listener(event);
          }
        }
        pump.cursor = Math.max(pump.cursor, event.sequence);
      }
    } catch {
      return;
    } finally {
      pump.running = false;
    }
  }
}
