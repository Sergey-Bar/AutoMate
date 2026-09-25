import { CanonicalRunResultSchema, type CanonicalRunResult } from '@automate/shared-contracts';
import { fingerprint } from '@automate/reporting';

export interface ReporterIngestionResult {
  status: 'accepted' | 'duplicate' | 'conflict';
  result?: CanonicalRunResult;
}

export class ReporterIngestionService {
  private readonly results = new Map<string, { fingerprint: string; result: CanonicalRunResult }>();

  constructor(private readonly workspaceId: string) {}

  ingest(input: unknown): ReporterIngestionResult {
    const parsed = CanonicalRunResultSchema.safeParse(input);
    if (!parsed.success) return { status: 'conflict' };
    if (parsed.data.identity.workspaceId !== this.workspaceId) return { status: 'conflict' };
    const digest = fingerprint(parsed.data);
    const existing = this.results.get(parsed.data.identity.runId);
    if (existing) {
      return existing.fingerprint === digest
        ? { status: 'duplicate', result: existing.result }
        : { status: 'conflict' };
    }
    this.results.set(parsed.data.identity.runId, { fingerprint: digest, result: parsed.data });
    return { status: 'accepted', result: parsed.data };
  }

  get(runId: string): CanonicalRunResult | undefined {
    return this.results.get(runId)?.result;
  }
}
