/**
 * The auto-quarantine policy: which flaky tests quarantine themselves, and when they come back.
 *
 * Run after each CI test report for the project (`POST /api/v1/projects/:id/tests/reports`),
 * over the project's recent history, before the report's verdict is computed — so a test that
 * passed on a retry in this run can be quarantined by this run.
 *
 * **What it may act on is FLAKE-4's rule, not a threshold of its own.** A test is quarantined
 * only when `flakeCost` calls it `autoEligible` — a retry pass or two outcomes on one commit,
 * while its latest decisive result is a pass — and `suggestQuarantine` would suggest it. A
 * test that only flips across commits is the test doing its job, and is left for a person.
 *
 * **It never overrides a person.** A test with any entry that is not `released` — pending,
 * approved or rejected, by anyone — is left alone. Only entries it wrote itself
 * (`quarantinedBy: 'automate'`) are ever released by it.
 *
 * **Release is a streak, not a rate.** An automatic entry is released once its test has
 * passed `releaseAfter` times in a row with no retry. A retry pass is still a pass, and is
 * exactly the evidence that quarantined it, so it resets the streak.
 */

import { storedTestIdentity, type QuarantinePolicy } from '@automate/shared-contracts';
import { flakeCost, suggestQuarantine } from '@automate/reporting';
import { flakeObservationsOf, QUARANTINE_THRESHOLDS } from '../execution/insights.js';
import type { ExecutionRun } from '../execution/types.js';
import type { WriteContext } from '../modules/dashboard/audit-sink.js';
import type { QuarantineStore } from '../modules/dashboard/quarantine.js';

export const AUTOMATE_ACTOR: WriteContext = { actorId: 'automate', actorType: 'system' };

export interface AutoQuarantineOutcome {
  /** Identities quarantined and approved by this pass. */
  quarantined: string[];
  /** Identities whose automatic entry this pass released. */
  released: string[];
}

/** Clean passes in a row at the end of the history, for one identity. */
export function cleanStreak(history: readonly ExecutionRun[], identity: string): number {
  let streak = 0;
  for (const run of history) {
    for (const test of run.tests) {
      if (storedTestIdentity(test) !== identity) continue;
      if (test.status === 'passed') streak += 1;
      else if (test.status !== 'skipped') streak = 0;
    }
  }
  return streak;
}

export async function applyQuarantinePolicy(input: {
  policy: QuarantinePolicy;
  projectId: string;
  /** Runs oldest first. Only this project's are read. */
  history: readonly ExecutionRun[];
  store: Pick<QuarantineStore, 'list' | 'add' | 'resolve'>;
}): Promise<AutoQuarantineOutcome> {
  const outcome: AutoQuarantineOutcome = { quarantined: [], released: [] };
  if (input.policy.mode !== 'auto') return outcome;
  const history = input.history.filter((run) => run.projectId === input.projectId);
  const entries = await input.store.list();
  const latest = new Map<string, { title: string; file: string }>();
  for (const run of history) {
    for (const test of run.tests) {
      latest.set(storedTestIdentity(test), { title: test.title, file: test.file ?? '' });
    }
  }
  const decided = (identity: string, title: string, file: string) =>
    entries.some(
      (entry) =>
        entry.status !== 'released' &&
        (entry.projectId === null || entry.projectId === input.projectId) &&
        (entry.stableId === null || entry.stableId === ''
          ? entry.testTitle === title && entry.testFile === file
          : entry.stableId === identity),
    );

  const eligible = suggestQuarantine(
    flakeCost(flakeObservationsOf(history)),
    QUARANTINE_THRESHOLDS,
  ).filter((suggestion) => suggestion.autoEligible);
  for (const suggestion of eligible) {
    const test = latest.get(suggestion.testKey);
    if (test === undefined || decided(suggestion.testKey, test.title, test.file)) continue;
    const created = await input.store.add(
      {
        testTitle: test.title,
        testFile: test.file,
        stableId: suggestion.testKey,
        projectId: input.projectId,
        quarantinedBy: 'automate',
        reason: suggestion.reason,
      },
      AUTOMATE_ACTOR,
    );
    const evidence = suggestion.evidence;
    await input.store.resolve(
      created.id,
      {
        status: 'approved',
        resolution:
          `Approved by the auto-quarantine policy: ${String(evidence.retryPasses)} retry pass(es) ` +
          `and ${String(evidence.sameCommit)} commit(s) with both outcomes.`,
      },
      AUTOMATE_ACTOR,
    );
    outcome.quarantined.push(suggestion.testKey);
  }

  for (const entry of entries) {
    if (
      entry.status !== 'approved' ||
      entry.quarantinedBy !== 'automate' ||
      entry.projectId !== input.projectId ||
      entry.stableId === null
    ) {
      continue;
    }
    if (cleanStreak(history, entry.stableId) < input.policy.releaseAfter) continue;
    await input.store.resolve(
      entry.id,
      {
        status: 'released',
        resolution: `Passed ${String(input.policy.releaseAfter)} runs in a row without a retry.`,
        resolutionType: 'auto-released',
      },
      AUTOMATE_ACTOR,
    );
    outcome.released.push(entry.stableId);
  }
  return outcome;
}
