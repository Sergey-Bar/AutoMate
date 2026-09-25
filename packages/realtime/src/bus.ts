import type { CanonicalRealtimeEnvelope } from '@automate/shared-contracts';

export interface RealtimeEventInput {
  eventType: string;
  runId?: string;
  workspaceId?: string;
  occurredAt: string;
  data: unknown;
}

export interface RealtimeSubscription {
  replay: CanonicalRealtimeEnvelope[];
  gap: boolean;
  nextCursor: string | null;
  onEvent(listener: (event: CanonicalRealtimeEnvelope) => void): () => void;
  close(): void;
}

export class InMemoryRealtimeBus {
  private readonly historyLimit: number;
  private cursor = 0;
  private readonly history: CanonicalRealtimeEnvelope[] = [];
  private readonly listeners = new Set<(event: CanonicalRealtimeEnvelope) => void>();

  constructor(historyLimit = 100) {
    if (!Number.isInteger(historyLimit) || historyLimit < 1) {
      throw new Error('historyLimit must be a positive integer');
    }
    this.historyLimit = historyLimit;
  }

  publish(input: RealtimeEventInput): CanonicalRealtimeEnvelope {
    this.cursor += 1;
    const event: CanonicalRealtimeEnvelope = {
      contractVersion: '2',
      cursor: String(this.cursor),
      eventType: input.eventType,
      runId: input.runId,
      workspaceId: input.workspaceId,
      occurredAt: input.occurredAt,
      data: input.data,
    };
    this.history.push(event);
    while (this.history.length > this.historyLimit) this.history.shift();
    for (const listener of this.listeners) listener(event);
    return event;
  }

  subscribe(afterCursor?: string): RealtimeSubscription {
    const requested = afterCursor === undefined ? this.cursor : Number(afterCursor);
    if (!Number.isInteger(requested) || requested < 0) throw new Error('Invalid cursor');
    const oldest = this.history[0] ? Number(this.history[0].cursor) : this.cursor + 1;
    const gap = requested + 1 < oldest;
    const replay = gap ? [] : this.history.filter((event) => Number(event.cursor) > requested);
    return {
      replay,
      gap,
      nextCursor: replay.at(-1)?.cursor ?? afterCursor ?? null,
      onEvent: (eventListener) => {
        const liveListener = (event: CanonicalRealtimeEnvelope) => {
          if (Number(event.cursor) > requested) eventListener(event);
        };
        this.listeners.add(liveListener);
        return () => this.listeners.delete(liveListener);
      },
      close: () => undefined,
    };
  }
}
