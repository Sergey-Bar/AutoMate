/**
 * canonical-ingestion.ts — the one write path from a canonical result to both tables.
 *
 * **The canonical row is written first and is authoritative; the projection follows from
 * it.** That ordering is the whole content of this module. A door that wrote `runs` and
 * then, separately, `canonical_run_results`, had two systems — which is ledger row P-73,
 * and it was live while a customer's entire test history arrived through the supported
 * door and answered `proofCeiling: 'unknown'` to every KPI.
 *
 * The projection is *derived from the result that was just accepted*, not recomputed from
 * the stored row. `ReporterIngestionService.ingest` returns the result it accepted (or the
 * stored one for a duplicate), so the bytes the projection sees are the bytes that were
 * fingerprinted, and a replay and a fresh post project identically.
 */

import type { CanonicalRunResult } from '@automate/shared-contracts';
import { projectCanonicalRun, type CanonicalProjection } from './canonical-projection.js';
import type { ReporterIngestionResult, ReporterResultStore } from './reporter-ingestion.js';
import type { RunRepository } from '../repositories/run-repository.js';
import type { RealtimeBus } from '../realtime/realtime-bus.js';
import { RUN_UPDATED_EVENT_TYPE } from '@automate/shared-contracts';

export interface CanonicalIngestOptions {
  store: ReporterResultStore;
  repository: RunRepository;
  bus?: RealtimeBus;
  /** What wrote this result, recorded on `runs.triggeredBy`. */
  triggeredBy?: string;
}

export interface CanonicalIngestOutcome extends ReporterIngestionResult {
  projection: CanonicalProjection;
}

/**
 * Ingest a canonical result and project it.
 *
 * A `conflict` is **not** projected. It means a row for this `runId` already exists with a
 * different fingerprint, so the two results disagree and writing the projection of the
 * newer one would replace the dashboard's view of a run whose canonical evidence is the
 * older one. The conflict is reported and nothing is written: a caller can look at both
 * and decide, which is the only thing a conflict is for.
 */
export async function ingestCanonicalResult(
  result: CanonicalRunResult,
  options: CanonicalIngestOptions,
): Promise<CanonicalIngestOutcome> {
  const outcome = await options.store.ingest(result);
  if (outcome.status === 'conflict' || outcome.result === undefined) {
    const projection = projectCanonicalRun(result, { triggeredBy: options.triggeredBy });
    return { status: outcome.status, projection };
  }

  const projection = await writeProjection(options, outcome.result);
  return { status: outcome.status, projection };
}

async function writeProjection(
  options: CanonicalIngestOptions,
  result: CanonicalRunResult,
): Promise<CanonicalProjection> {
  const projection = projectCanonicalRun(result, { triggeredBy: options.triggeredBy });
  await options.repository.upsertRun(projection.run);
  for (const test of projection.tests) {
    await options.repository.upsertTest(test);
  }
  if (options.bus) {
    // Fire-and-forget: the durable bus contract is non-rejecting, so there is nothing to
    // await. Marked so the intent is visible here rather than left implicit.
    void options.bus.publish({
      type: RUN_UPDATED_EVENT_TYPE,
      version: '1',
      runId: projection.run.id,
      status: projection.run.status,
      timestamp: new Date().toISOString(),
    });
  }
  return projection;
}
