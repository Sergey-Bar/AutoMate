import { asc, gt } from 'drizzle-orm';
import { outboxEvents, type createDbClient } from '@automate/db';

type Database = ReturnType<typeof createDbClient>;

export class DrizzleRealtimeFeed {
  constructor(private readonly db: Database) {}

  async readAfter(sequence: number, limit = 100) {
    return this.db
      .select()
      .from(outboxEvents)
      .where(gt(outboxEvents.sequence, sequence))
      .orderBy(asc(outboxEvents.sequence))
      .limit(limit);
  }
}
