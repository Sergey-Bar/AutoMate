import { qualityGateConfig, quarantine } from '@automate/db';
import { asc, eq, ne } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { PgliteQueryResultHKT } from 'drizzle-orm/pglite';
import { randomUUID } from 'node:crypto';
import type { QualityGate, QualityGateStore } from './quality-gates.js';
import type { QuarantineEntry, QuarantineStore } from './quarantine.js';

type AnyPgDb =
  | PgDatabase<PgQueryResultHKT, Record<string, unknown>>
  | PgDatabase<PgliteQueryResultHKT, Record<string, unknown>>;

export class DrizzleQuarantineStore implements QuarantineStore {
  constructor(private readonly db: AnyPgDb) {}

  async list(): Promise<QuarantineEntry[]> {
    const rows = await this.db.select().from(quarantine).orderBy(asc(quarantine.quarantinedAt));
    return rows.map((row) => ({
      id: row.id,
      testTitle: row.testTitle,
      testFile: row.testFile,
      reason: row.reason ?? null,
      quarantinedAt: row.quarantinedAt.toISOString(),
    }));
  }

  async add(entry: Omit<QuarantineEntry, 'id' | 'quarantinedAt'>): Promise<QuarantineEntry> {
    const id = randomUUID();
    const now = new Date();
    await this.db.insert(quarantine).values({
      id,
      testTitle: entry.testTitle,
      testFile: entry.testFile,
      reason: entry.reason ?? null,
      quarantinedAt: now,
    });
    return {
      id,
      testTitle: entry.testTitle,
      testFile: entry.testFile,
      reason: entry.reason ?? null,
      quarantinedAt: now.toISOString(),
    };
  }

  async remove(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(quarantine)
      .where(eq(quarantine.id, id))
      .returning({ id: quarantine.id });
    return rows.length > 0;
  }
}

export class DrizzleQualityGateStore implements QualityGateStore {
  constructor(private readonly db: AnyPgDb) {}

  async list(): Promise<QualityGate[]> {
    const rows = await this.db
      .select()
      .from(qualityGateConfig)
      .where(ne(qualityGateConfig.id, 'global'))
      .orderBy(asc(qualityGateConfig.updatedAt));
    return rows.map((row) => ({
      id: row.id,
      name: row.workspaceId ?? 'Unnamed gate',
      passRateThreshold: row.passRateThreshold,
      createdAt: row.updatedAt.toISOString(),
    }));
  }

  async add(gate: Omit<QualityGate, 'id' | 'createdAt'>): Promise<QualityGate> {
    const id = randomUUID();
    const now = new Date();
    await this.db.insert(qualityGateConfig).values({
      id,
      workspaceId: gate.name,
      passRateThreshold: gate.passRateThreshold,
      updatedAt: now,
    });

    return {
      id,
      name: gate.name,
      passRateThreshold: gate.passRateThreshold,
      createdAt: now.toISOString(),
    };
  }

  async get(id: string): Promise<QualityGate | null> {
    const rows = await this.db
      .select()
      .from(qualityGateConfig)
      .where(eq(qualityGateConfig.id, id))
      .limit(1);
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id,
      name: row.workspaceId ?? 'Unnamed gate',
      passRateThreshold: row.passRateThreshold,
      createdAt: row.updatedAt.toISOString(),
    };
  }
}
