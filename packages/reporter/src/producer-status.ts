/**
 * producer-status.ts — the one place a producer's own status vocabulary becomes a
 * canonical one.
 *
 * Three doors reached the same outcome with three answers, and every one of the three was
 * written by a different person for a different adapter:
 *
 *   - `playwright-json.ts` had a `mapStatus` switch;
 *   - `junit-xml.ts` had a `statusFrom` that read the same names from an XML attribute;
 *   - `routes/reporter.ts` had a `mapPlaywrightStatus` that mapped `interrupted` to
 *     `failed` — a harness event counted as a product failure — and no rung at all for
 *     anything it did not recognise.
 *
 * So the status a customer saw depended on which door the report came through, which is the
 * exact defect `canonical-run-result.ts` was written to end, one level further down.
 *
 * **There are two tables, not one, because a test's status and a run's status are
 * different questions.** `running` is the case that proves it: a *test* that is still going
 * is an unobserved test (`unknown` — nothing has been reported), while a *run* that is
 * still going has not produced an outcome at all (`running`). One table would have to pick
 * one of them, and whichever it picked would be wrong for the other.
 *
 * **Both tables are exhaustive over their input, and the exhaustiveness is compile-time.** A
 * producer status with no row here is a compile error rather than a silent `unknown`, which
 * is the difference between "a producer shipped a new outcome and the build stopped" and
 * "the outcome became an unobserved test and a release gate counted it as neither pass nor
 * failure".
 */

import type { CanonicalRunResult } from '@automate/shared-contracts';

export type CanonicalStatus = CanonicalRunResult['status'];

/**
 * The producers whose vocabularies this repository ingests.
 *
 * A union rather than a string, so the `satisfies` guard below can insist the table covers
 * every member of it. Adding a producer means adding its vocabulary here, which is the
 * point: a new adapter that maps statuses in its own file is the defect this module exists
 * to prevent.
 */
export const INGESTED_PRODUCERS = ['playwright', 'junit', 'legacy', 'k6', 'zap'] as const;
export type IngestedProducer = (typeof INGESTED_PRODUCERS)[number];

/**
 * Test status → canonical status, one table per producer.
 *
 * **Exported because the table's keys *are* the claim** "this producer emits exactly these
 * words" — and a claim another test asserts is worth more than a comment about one. It is
 * not a second copy: the test reads these keys.
 *
 * The keys are the producer's whole vocabulary, which is why the `satisfies` guard covers
 * *every* member of {@link INGESTED_PRODUCERS}: a producer added to the union without a
 * table here is a compile error, not a document nobody checks.
 *
 * Two decisions carry the weight, and both are the ones the blueprint calls out:
 *
 *  - **`interrupted` is `cancelled`, not `failed`.** Playwright emits `interrupted` when the
 *    *harness* stopped the run — the user pressed Ctrl-C, the CI job was cancelled, a global
 *    timeout fired. The product under test produced no outcome at all, and `policy.ts` puts
 *    `cancelled` in `nonProduct` for exactly that reason. Reporting it as `failed` inflated
 *    the failure rate with the harness's own interruptions, and it was the one mapping in the
 *    repository that converted an absence of evidence into a statement about the product.
 *
 *  - **`running` and `queued` are `unknown`.** A test that has been declared but has not
 *    reported is unobserved, and it is the one status that must never be a pass. Note that
 *    this is *not* what `running` means for a **run** — see {@link canonicalRunStatusFrom}.
 */
export const TEST_STATUS_MAPPING = {
  // Playwright's own test status set. `flaky` is absent because Playwright never emits it:
  // a retry is expressed as several entries in `results[]` with different outcomes, and the
  // adapter *computes* flakiness from that history rather than reading a word. Listing a
  // status the producer cannot produce would be a claim about Playwright that is false, and
  // the table's value is that every row in it is true.
  playwright: {
    passed: 'passed',
    failed: 'failed',
    skipped: 'skipped',
    timedOut: 'timedOut',
    timed_out: 'timedOut',
    cancelled: 'cancelled',
    interrupted: 'cancelled',
  },
  // JUnit declares no status attribute of its own — the outcome children are the evidence
  // — but several tools emit `status="flaky"` for a retried test, and the canonical adapter
  // already honoured it, so it stays honoured here.
  junit: {
    passed: 'passed',
    failed: 'failed',
    skipped: 'skipped',
    flaky: 'flaky',
    timedOut: 'timedOut',
    timed_out: 'timedOut',
  },
  legacy: {
    passed: 'passed',
    failed: 'failed',
    skipped: 'skipped',
    flaky: 'flaky',
    timedOut: 'timedOut',
    timed_out: 'timedOut',
    running: 'unknown',
    queued: 'unknown',
    cancelled: 'cancelled',
    interrupted: 'cancelled',
  },
  // k6 emits no test status at all: a summary carries metrics and thresholds, and
  // the k6 adapter *computes* each attempt's status by evaluating a threshold
  // against a metric. This table is therefore the vocabulary the adapter reads
  // when a metric has to be named as a status-bearing entity at all, and it is
  // kept rather than omitted so the `satisfies` guard below stays exhaustive:
  // adding `k6` to the union without a row here is a compile error, which is the
  // only thing stopping a new adapter from mapping statuses in its own file.
  k6: {
    passed: 'passed',
    failed: 'failed',
    skipped: 'skipped',
    flaky: 'flaky',
    timedOut: 'timedOut',
    timed_out: 'timedOut',
    unknown: 'unknown',
    unmeasured: 'unknown',
  },
  // ZAP's alert risks. `riskcode` is a scanner's severity, not a test outcome,
  // and the adapter maps it to a canonical status itself — this table is the
  // vocabulary the adapter *declares*, so `adapters/zap-xml.test.ts` asserts
  // every riskcode resolves through it rather than hard-coding a number.
  zap: {
    passed: 'passed',
    failed: 'failed',
    skipped: 'skipped',
    flaky: 'flaky',
    timedOut: 'timedOut',
    timed_out: 'timedOut',
    informational: 'skipped',
    low: 'failed',
    medium: 'failed',
    high: 'failed',
  },
} as const satisfies {
  [P in IngestedProducer]: Record<string, CanonicalStatus>;
};

/**
 * Every status string an upload or an event may put on a **run**.
 *
 * One vocabulary, because `POST /reporter/upload`'s `status` field and the event door's
 * `run:end` payload are the same wire vocabulary — the upload format *is* the format the
 * legacy reporter SDK speaks. JUnit and Playwright do not appear: their run status is
 * derived from their tests by `runStatusFrom`, not declared by them.
 */
const RUN_STATUS_MAPPING = {
  running: 'running',
  queued: 'running',
  passed: 'passed',
  failed: 'failed',
  skipped: 'skipped',
  flaky: 'flaky',
  timedOut: 'timedOut',
  cancelled: 'cancelled',
  interrupted: 'cancelled',
} as const satisfies Record<string, CanonicalStatus>;

/**
 * What a producer status this build has never heard of resolves to.
 *
 * `unknown` for a *test*, and the same for a *run*, because both are the vocabulary's own
 * word for "we observed nothing". It is exported because `producer-status.test.ts` asserts
 * the fallbacks against it rather than against the string.
 */
export const UNKNOWN_RAW_STATUS = 'unknown';

/**
 * A producer's own **test** status, as a canonical one.
 *
 * A value outside the producer's declared vocabulary is `unknown` rather than an error,
 * because the boundary already accepted it: the upload contract admits a status a given
 * adapter will never produce, and refusing the whole upload for it would turn a widened
 * vocabulary into a rejected run. It resolves to the one status that cannot be read as a
 * pass.
 */
export function canonicalTestStatusFrom<P extends IngestedProducer>(
  producer: P,
  rawStatus: string,
): CanonicalStatus {
  const table = TEST_STATUS_MAPPING[producer] as Readonly<Record<string, CanonicalStatus>>;
  return table[rawStatus] ?? (UNKNOWN_RAW_STATUS as CanonicalStatus);
}

/**
 * A declared **run** status, as a canonical one.
 *
 * Separate from {@link canonicalTestStatusFrom} because `running` means two different
 * things: an unobserved *test*, and a *run* that has not finished. `runs.status` has always
 * carried `running` and the product's own upload door has always accepted it, because a
 * reporter SDK streams partial uploads; before `running` existed in the canonical vocabulary
 * the only way to express it was as a `runs.status` the canonical row did not agree with,
 * so a streaming run went red at its first failing test while its projection said it was
 * still going.
 */
export function canonicalRunStatusFrom(rawStatus: string): CanonicalStatus {
  const table = RUN_STATUS_MAPPING as Readonly<Record<string, CanonicalStatus>>;
  return table[rawStatus] ?? (UNKNOWN_RAW_STATUS as CanonicalStatus);
}

/**
 * Whether a producer reported this test as having needed a retry.
 *
 * A producer that says `flaky` has observed a retry, which is the same evidence the JUnit
 * adapter reads out of `<rerunFailure>` and the Playwright adapter computes from a changed
 * outcome across `results[]`. Naming it here means all three agree on what
 * `flakiness: 'observed'` means, instead of each deciding.
 */
export function flakinessFrom(rawStatus: string): 'unknown' | 'observed' {
  return rawStatus === 'flaky' ? 'observed' : 'unknown';
}

/**
 * The list a run's status is derived from: its tests' own outcomes, plus whatever the job
 * claimed about the run.
 *
 * The claim is **appended, not substituted**, so it goes through the same ladder as the
 * rows and cannot outrank them — with the single exception of `running`, which the ladder
 * checks first precisely because a run that has not finished has no verdict. That is why
 * this is a function rather than `declaredRunStatus ? [mapped] : outcomes` in each adapter:
 * three adapters each doing the substitution is three places where "the claim wins" and
 * "the rows win" can quietly differ.
 */
export function outcomesWithDeclaredRunStatus(
  outcomes: readonly CanonicalStatus[],
  declaredRunStatus: string | undefined,
): CanonicalStatus[] {
  if (declaredRunStatus === undefined) return [...outcomes];
  return [...outcomes, canonicalRunStatusFrom(declaredRunStatus)];
}
