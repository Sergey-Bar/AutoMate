import { and, eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { PgliteQueryResultHKT } from 'drizzle-orm/pglite';
import { canonicalRunResults } from '@automate/db';
import { CanonicalRunResultSchema, type CanonicalRunResult } from '@automate/shared-contracts';
import { fingerprint } from '@automate/reporting';
import type { ReporterIngestionResult, ReporterResultStore } from './reporter-ingestion.js';

type AnyPgDb =
  | PgDatabase<PgQueryResultHKT, Record<string, unknown>>
  | PgDatabase<PgliteQueryResultHKT, Record<string, unknown>>;

export class DrizzleReporterIngestionService implements ReporterResultStore {
  constructor(
    private readonly db: AnyPgDb,
    private readonly workspaceId: string,
  ) {}

  async ingest(input: unknown): Promise<ReporterIngestionResult> {
    const parsed = CanonicalRunResultSchema.safeParse(input);
    if (!parsed.success || parsed.data.identity.workspaceId !== this.workspaceId) {
      return { status: 'conflict' };
    }
    const result = parsed.data;
    const digest = fingerprint(result);
    const existing = await this.find(result.identity.runId);
    if (existing) {
      return existing.fingerprint === digest
        ? { status: 'duplicate', result: this.parseResult(existing.result) }
        : { status: 'conflict' };
    }
    const inserted = await this.db
      .insert(canonicalRunResults)
      .values({
        workspaceId: this.workspaceId,
        runId: result.identity.runId,
        fingerprint: digest,
        result: result as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: [canonicalRunResults.workspaceId, canonicalRunResults.runId] })
      .returning({
        fingerprint: canonicalRunResults.fingerprint,
        result: canonicalRunResults.result,
      });
    if (inserted[0]) return { status: 'accepted', result };
    const raced = await this.find(result.identity.runId);
    return raced?.fingerprint === digest
      ? { status: 'duplicate', result: this.parseResult(raced.result) }
      : { status: 'conflict' };
  }

  async get(runId: string): Promise<CanonicalRunResult | undefined> {
    const existing = await this.find(runId);
    return existing ? this.parseResult(existing.result) : undefined;
  }

  async list(): Promise<CanonicalRunResult[]> {
    const rows = await this.db
      .select({ result: canonicalRunResults.result })
      .from(canonicalRunResults)
      .where(eq(canonicalRunResults.workspaceId, this.workspaceId));
    return rows.map((row) => this.parseResult(row.result));
  }

  private async find(
    runId: string,
  ): Promise<{ fingerprint: string; result: Record<string, unknown> } | null> {
    const rows = await this.db
      .select({ fingerprint: canonicalRunResults.fingerprint, result: canonicalRunResults.result })
      .from(canonicalRunResults)
      .where(
        and(
          eq(canonicalRunResults.workspaceId, this.workspaceId),
          eq(canonicalRunResults.runId, runId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private parseResult(value: Record<string, unknown>): CanonicalRunResult {
    const parsed = CanonicalRunResultSchema.safeParse(value);
    if (!parsed.success) throw new Error('Stored canonical result is invalid');
    return parsed.data;
  }
}
