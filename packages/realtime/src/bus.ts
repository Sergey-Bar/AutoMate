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

export interface InMemoryRealtimeBusOptions {
  /** How many events to retain. */
  historyLimit?: number;
  /**
   * Approximate retained payload budget, in bytes.
   *
   * The count alone is not a memory bound, and a single event is not small: one frame
   * with a stack trace in `data` is orders of magnitude larger than one with a status
   * string, so `historyLimit: 100` bounds nothing a reader can predict. Both bounds are
   * enforced and the older of the two evicts, so the retained set is small *and* cheap
   * (ledger R-5).
   */
  historyBytes?: number;
  /**
   * The cursor this process should continue from.
   *
   * Cursors are a per-process `1..n` counter, while the durable bus numbers them from
   * the outbox sequence. The two schemes are unrelated, so a cursor obtained from one
   * is meaningless to the other and a client reconnecting across a restart silently
   * restarts the stream (ledger R-6).
   *
   * This option is how a process continues the durable numbering rather than inventing
   * its own. It is **not** the fix for a multi-process deployment, and a deployment
   * that needs cross-process ordering must use `DurableRealtimeBus`, where the outbox
   * sequence is genuinely authoritative. What is fixed here is the silent part: a
   * process no longer starts at 1 and reports a complete history it does not have.
   */
  initialCursor?: number;
}

/** A cursor is a decimal integer and nothing else. */
const CURSOR_PATTERN = /^(0|[1-9][0-9]*)$/;

/**
 * Parse a cursor strictly.
 *
 * `Number()` accepts `''` as 0 and `'0x10'` as 16, both of which pass an
 * `isInteger && >= 0` guard and neither of which is a cursor (ledger R-3). The empty
 * string is the dangerous one: it is what a client sends when it has no cursor, and
 * coercing it to 0 is indistinguishable from a genuine "from the beginning" request.
 *
 * @param value the cursor as it arrived
 * @returns the cursor, or `null` when the input is not one
 */
export function parseCursor(value: string): number | null {
  if (!CURSOR_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export class InMemoryRealtimeBus {
  private readonly historyLimit: number;
  private readonly historyBytesLimit: number;
  private cursor: number;
  private historyBytes = 0;
  private readonly history: CanonicalRealtimeEnvelope[] = [];
  private readonly listeners = new Set<(event: CanonicalRealtimeEnvelope) => void>();

  constructor(options: number | InMemoryRealtimeBusOptions = {}) {
    // A bare number is the original single-argument form, kept so existing callers and
    // tests do not change shape. It is the *count* limit, which is what a number has
    // always meant here.
    const config: InMemoryRealtimeBusOptions =
      typeof options === 'number' ? { historyLimit: options } : options;
    const historyLimit = config.historyLimit ?? 100;
    if (!Number.isInteger(historyLimit) || historyLimit < 1) {
      throw new Error('historyLimit must be a positive integer');
    }
    const historyBytes = config.historyBytes ?? DEFAULT_HISTORY_BYTES;
    if (!Number.isInteger(historyBytes) || historyBytes < 1) {
      throw new Error('historyBytes must be a positive integer');
    }
    const initialCursor = config.initialCursor ?? 0;
    if (!Number.isInteger(initialCursor) || initialCursor < 0) {
      throw new Error('initialCursor must be a non-negative integer');
    }
    this.historyLimit = historyLimit;
    this.historyBytesLimit = historyBytes;
    this.cursor = initialCursor;
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
    this.historyBytes += envelopeBytes(event);
    this.evict();
    for (const listener of this.listeners) listener(event);
    return event;
  }

  subscribe(afterCursor?: string): RealtimeSubscription {
    // **No cursor means "from the beginning", not "you are current".**
    //
    // The previous code substituted `this.cursor` for a missing cursor, telling a
    // brand-new subscriber it was caught up on a stream it had not read a single event
    // of (ledger R-4). That is the worst shape this class of bug takes: the
    // subscription is silent, looks healthy, and permanently omits every event that had
    // already happened. Starting from 0 asks for the whole retained history and lets
    // `gap` below report honestly whether the retained window still covers it.
    const requested = afterCursor === undefined ? 0 : parseCursor(afterCursor);
    if (requested === null) throw new Error('Invalid cursor');

    const oldest = this.history[0] ? Number(this.history[0].cursor) : this.cursor + 1;
    const gap = requested + 1 < oldest;
    const replay = gap ? [] : this.history.filter((event) => Number(event.cursor) > requested);

    // Every listener this subscription adds, so `close()` can remove exactly its own.
    // The previous `close` was `() => undefined`, which left the listener registered on
    // the bus for the life of the process: a closed subscription kept receiving events
    // and kept its closure alive (ledger R-1).
    const added = new Set<(event: CanonicalRealtimeEnvelope) => void>();

    return {
      replay,
      gap,
      nextCursor: replay.at(-1)?.cursor ?? afterCursor ?? null,
      onEvent: (eventListener) => {
        const liveListener = (event: CanonicalRealtimeEnvelope) => {
          if (Number(event.cursor) > requested) eventListener(event);
        };
        this.listeners.add(liveListener);
        added.add(liveListener);
        return () => {
          this.listeners.delete(liveListener);
          added.delete(liveListener);
        };
      },
      close: () => {
        for (const listener of added) this.listeners.delete(listener);
        added.clear();
      },
    };
  }

  /** How many live listeners the bus holds. For tests, and for leak detection. */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /**
   * How many events the buffer is holding.
   *
   * Exposed because the byte bound is otherwise unobservable: both bounds trim, and a
   * caller that cannot ask how much survived cannot tell which one bound. It is a
   * development and test double, so a diagnostic accessor is a reasonable price.
   */
  get retainedCount(): number {
    return this.history.length;
  }

  /** The approximate bytes currently retained, against the configured budget. */
  get retainedBytes(): number {
    return this.historyBytes;
  }

  /**
   * Drop the oldest events until both bounds hold.
   *
   * The count bound is retained because it is the predictable one; the byte bound is
   * what makes it a memory bound rather than an event count. Either can be the binding
   * constraint, so both are checked rather than one assumed sufficient.
   */
  private evict(): void {
    while (this.history.length > 0) {
      const overCount = this.history.length > this.historyLimit;
      const overBytes = this.historyBytes > this.historyBytesLimit;
      if (!overCount && !overBytes) return;
      const dropped = this.history.shift();
      if (dropped === undefined) return;
      this.historyBytes -= envelopeBytes(dropped);
    }
  }
}

/** 1 MiB: a bound on a development double, not a memory limit in practice. */
const DEFAULT_HISTORY_BYTES = 1024 * 1024;

/**
 * An envelope's approximate retained size.
 *
 * Approximate on purpose: the true cost is the serialized envelope, and serializing
 * every event to measure a budget that is itself approximate would cost more than the
 * budget saves. What matters is that the number scales with the payload, so one large
 * event cannot slip past a bound expressed in events.
 *
 * @param event the envelope to measure
 * @returns an approximate byte count
 */
function envelopeBytes(event: CanonicalRealtimeEnvelope): number {
  let size = 64;
  for (const value of [
    event.cursor,
    event.eventType,
    event.occurredAt,
    event.runId,
    event.workspaceId,
  ]) {
    if (typeof value === 'string') size += value.length;
  }
  try {
    size += JSON.stringify(event.data ?? null).length;
  } catch {
    // A value that will not serialize is not one the envelope can carry either. Count
    // it as small rather than throwing from a publish path.
    size += 0;
  }
  return size;
}
