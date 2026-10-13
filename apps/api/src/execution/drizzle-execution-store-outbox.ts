import { EVENT_VERSION } from '@automate/shared-contracts';
import { DrizzleOutboxRepository, type OutboxDatabase } from '@automate/db';
import { sanitizeOutboxEnvelope } from '../infrastructure/outbox-sanitizer.js';
import {
  type DrizzleExecutionStoreOptions,
  type OutboxAppend,
  type AnyPgDb,
} from './drizzle-execution-store-rows.js';

const OUTBOX_DEFAULT_RETENTION_HOURS = 24;

/**
 * The transactional outbox every durable write in this store passes through.
 *
 * Extracted first of the four modules, because it is the one with no
 * dependencies on the others: it takes a transaction and a list of envelopes,
 * and answers nothing back. That is what makes it the right place to start — a
 * mistake here is visible to every other module, so it is the one worth
 * splitting out early and proving before anything leans on it.
 *
 * The retention policy lives here too, because the row it belongs to is written
 * here: `expiresAt` is the instant the sweep in `infrastructure/outbox-retention.ts`
 * is allowed to purge the envelope, and the two numbers cannot be decided in
 * different files without drifting.
 */
export class DrizzleExecutionOutbox {
  private readonly db: AnyPgDb;
  private readonly options: DrizzleExecutionStoreOptions;

  constructor(options: DrizzleExecutionStoreOptions) {
    this.db = options.db;
    this.options = options;
  }

  async append(tx: unknown, event: OutboxAppend): Promise<void> {
    await this.appendBatch(tx, [event]);
  }

  async appendBatch(tx: unknown, events: OutboxAppend[]): Promise<void> {
    if (events.length === 0) return;
    const repository = new DrizzleOutboxRepository(tx as OutboxDatabase);
    await repository.appendMany(
      events.map((event) => ({
        workspaceId: event.workspaceId,
        aggregateType: 'run',
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        eventVersion: EVENT_VERSION,
        payload: sanitizeOutboxEnvelope(event.payload),
        dedupeKey: event.dedupeKey,
        occurredAt: event.occurredAt,
        expiresAt: new Date(
          event.occurredAt.getTime() +
            (this.options.outboxRetentionHours ?? OUTBOX_DEFAULT_RETENTION_HOURS) * 3_600_000,
        ),
      })),
    );
  }
}
