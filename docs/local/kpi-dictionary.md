# AUTOMATE (local) — KPI dictionary

**Status:** Draft
**Owner:** maintainers
**Last reviewed:** 2026-10-19

Every number the dashboard shows, defined once: what it is, how it is computed, when it
applies, what happens when data is missing or inconsistent, and which fixtures prove it. A
number that is not here is not shown.

## Rules that apply to every metric

- **Absent is not zero.** A value the sources do not contain is shown as missing, never `0`
  and never omitted.
- **Rates carry their denominator**, and say what was excluded from it and how many were
  excluded. Rates are computed over product outcomes only; indeterminate and non-product
  outcomes are reported beside the rate.
- **Do not combine incomparable denominators.** Test counts, attempt counts and coverage
  line counts are different units and are never added or compared.
- **A pass rate is not a quality score.** Nothing here infers application quality from it.
- **Flakiness is never inferred from one execution.** The only flakiness stated in the
  first release is what a report itself records (a retry that changed the outcome).
- **Different commits, configurations, environments or scopes are not compared** without
  the limitation being shown.
- Each metric has ten fields. A metric marked Planned has preconditions instead.

## Metrics in the first release

### K-01 Tests found

**Definition.** The number of test results across the runs selected, after duplicates are
removed.

**Formula.** Count of TestResult rows over distinct runs; runs from byte-identical artifacts
count once.

**Source data.** TestResult rows derived from ingested reports.

**Applicability.** Any selection containing at least one readable run.

**Freshness.** As old as the newest run in the selection; the age is shown beside it.

**Missing data.** No readable run: shown as missing with the reason (none found, all
rejected), not as 0. A zero-test report contributes a visible "reports no tests", not a
silent 0.

**Origin.** Calculated from reported results.

**Limitations.** "Found in reports" is not "exist in the repository". Tests that never ran
and left no record are not counted. Parameterised cases with one display name stay separate
results and raise a warning.

**Presentation.** A number with the run count and the oldest and newest report times.

**Validation.** `junit-basic`, `junit-basic-copy` (counted once), `junit-zero-tests`,
`junit-duplicate-names`.

### K-02 Tests by outcome

**Definition.** The number of test results per outcome: passed, failed, errored, skipped,
timed out, unknown, not run, aborted, infrastructure error.

**Formula.** Count of TestResult grouped by final outcome.

**Source data.** TestResult.outcome.

**Applicability.** As K-01.

**Freshness.** As K-01.

**Missing data.** An outcome with no results shows `0` only when at least one run was
readable. With no readable run the whole breakdown is missing.

**Origin.** Calculated; the outcome is the producer's, mapped through the vocabulary.

**Limitations.** Error and failure are distinguished only where the producer distinguishes
them. A producer that cannot say shows `failed`.

**Presentation.** A stacked bar with every segment labelled by count; unknown and
non-product outcomes visually distinct from product outcomes, never merged into them.

**Validation.** `junit-basic`, `junit-truncated`, `playwright-unknown-status`,
`node-junit`.

### K-03 First-pass rate

**Definition.** The share of product attempts that passed. The metric id is
`first-pass-rate`, taken from the existing reporting policy.

**Formula.** Passed attempts divided by product attempts. Product attempts exclude
unknown and non-product attempts, and the exclusions are shown.

**Source data.** Attempt rows.

**Applicability.** At least one product attempt.

**Freshness.** As K-01.

**Missing data.** No product attempt: missing, not 0%. If any contributing run is not
complete, the confidence is shown as low.

**Origin.** Calculated.

**Limitations.** It counts attempts, so a retried test contributes several attempts. It is
not the share of tests that passed, which K-02 gives. It says nothing about quality.

**Presentation.** A percentage with the numerator, denominator and exclusions on hover and
on the detail page.

**Validation.** `junit-basic`, `playwright-retries`, `junit-surefire-flaky`.

### K-04 Execution failure rate

**Definition.** The share of product attempts that failed. The metric id is
`execution-failure-rate`.

**Formula.** Failed attempts divided by product attempts. Errored and timed-out attempts are
reported beside it rather than folded in.

**Source data.** Attempt rows, as for K-03.

**Applicability.** At least one product attempt.

**Freshness.** As K-01.

**Missing data.** No product attempt: missing, not 0%. Contributing runs that are not
complete lower the confidence shown.

**Origin.** Calculated.

**Limitations.** As K-03. It is not the complement of K-03: skipped and timed-out attempts
are in neither numerator.

**Presentation.** As K-03.

**Validation.** `junit-basic`, `playwright-basic`.

### K-05 Retry-recovered rate

**Definition.** The share of product attempts belonging to a test that passed after at least
one failed attempt in the same report. The metric id is `flake-rate`.

**Formula.** Attempts with observed flakiness divided by product attempts.

**Source data.** Attempt.flakiness and TestResult.flakiness.

**Applicability.** Reports that record retries (Surefire rerun elements, Playwright result
lists).

**Freshness.** As K-01.

**Missing data.** A report that records no retry information shows this as not reported for
that report, not as 0.

**Origin.** Reported by the producer, then counted.

**Limitations.** One execution cannot show a test is stable or unstable. This counts only
what the report records and must not be labelled a flakiness score.

**Presentation.** Labelled "retry-recovered", with the explanation that history is needed
for a flakiness claim.

**Validation.** `playwright-retries`, `junit-surefire-flaky`, `junit-rerun-only`.

### K-06 and K-07 Duration, median and 95th percentile

**Definition.** The median and 95th percentile of attempt durations. Ids `duration-p50` and
`duration-p95`.

**Formula.** Nearest-rank quantile over attempts that have a duration.

**Source data.** Attempt.durationMs.

**Applicability.** At least one attempt with a duration.

**Freshness.** As K-01.

**Missing data.** Attempts with no or invalid duration are excluded and counted; none left
means missing.

**Origin.** Calculated.

**Limitations.** Durations from different machines and configurations are not comparable;
across formats they are measured differently. A report's total time is not the sum of its
attempts when tests run in parallel.

**Presentation.** Milliseconds with the number of attempts that contributed.

**Validation.** `junit-time-garbage`, `junit-basic`.

### K-08 Coverage by type

**Definition.** For each of lines, functions and branches: found, hit and percentage.

**Formula.** Hit divided by found, per type, over the files that report that type. Percent is
missing when found is zero.

**Source data.** CoverageSnapshot totals and FileCoverage.

**Applicability.** At least one readable coverage report.

**Freshness.** The age of the coverage report, shown, since coverage and test results are
often from different runs.

**Missing data.** A type no file reports is missing, not 0%. When only some files report it,
the figure covers those files and says so.

**Origin.** Calculated from reported counts; detail beats the report's own summary.

**Limitations.** Coverage is not correctness. Percentages from different tools or settings
are not comparable. Coverage and results may come from different commits.

**Presentation.** One row per type with found, hit, percent and the number of files
contributing.

**Validation.** `node-lcov`, `lcov-basic`, `lcov-empty-file`, `lcov-mismatch`.

### K-09 Report freshness

**Definition.** How old each report is: the time since the file was last modified and, when
the report records one, the time it says it ran.

**Formula.** Now minus the timestamp, per report; the newest per tool and format is shown.

**Source data.** ReportArtifact locations and TestRun.startedAt.

**Applicability.** Any ingested report.

**Freshness.** Recomputed on view.

**Missing data.** A report with no recorded time shows file time only, labelled as such.

**Origin.** Calculated.

**Limitations.** File time is when the file was written or copied, not when the tests ran. No
verdict of "stale" is given in the first release because the right threshold is unknown.

**Presentation.** An age beside every number, and the oldest contributing report highlighted.

**Validation.** Time handling in `junit-basic` (report time) and fixtures with no time
(`pair-junit` against `junit-zero-tests`).

### K-10 Report completeness

**Definition.** For each run, whether it is complete, partial, unknown or rejected, and why.

**Formula.** Count of runs per completeness value, with the warning codes that caused each.

**Source data.** TestRun.completeness and warnings.

**Applicability.** Any discovered report.

**Freshness.** As K-09.

**Missing data.** Not applicable: a rejected report is a countable result.

**Origin.** Reported by the parser, from its own checks.

**Limitations.** Completeness is what the parser can tell, not proof the report is whole. A
missing shard is only detectable when shard information exists.

**Presentation.** A list with a badge and a reason per report; the dashboard states how many
are not complete.

**Validation.** `junit-truncated`, `junit-undefined-entity`, `lcov-truncated`,
`playwright-null-suite`, `junit-many-tests`.

### K-11 Reports found and read

**Definition.** How many report files the scan found, how many were read into runs, and how
many were rejected or ignored.

**Formula.** Counts by state.

**Source data.** ReportArtifact and the scan record.

**Applicability.** Any scan.

**Freshness.** At the scan time.

**Missing data.** A scan that found nothing shows 0 found, which is a real zero.

**Origin.** Calculated.

**Limitations.** Reports in unrecognised formats, or in locations the scan does not look at,
are not counted.

**Presentation.** Three numbers with a link to each list.

**Validation.** `not-a-report`, `empty`, `junit-wrong-root`, `junit-basic`.

### K-12 Test tools detected

**Definition.** The tools and frameworks the repository appears to use, per project, each
with the evidence for it.

**Formula.** The detector output; no scoring beyond the detector's confidence.

**Source data.** ToolInstallation.

**Applicability.** Any scanned repository.

**Freshness.** At the scan time.

**Missing data.** An unrecognised repository shows "nothing recognised", not an empty
success.

**Origin.** Calculated from manifests and configuration files.

**Limitations.** Detected is not configured and not runnable. A tool named in a dependency
list may be unused.

**Presentation.** A list with evidence links; confidence labelled as the detector's.

**Validation.** The detector tests in `packages/projects`, and the Phase 0 repository corpus.

### K-13 Disagreements between reports

**Definition.** Tests on which two reports of one execution disagree, and groups that are
contested.

**Formula.** Count of disagreement entries and contested groups from reconciliation.

**Source data.** The reconciliation output.

**Applicability.** At least two grouped reports.

**Freshness.** As K-09.

**Missing data.** With no grouped reports it is not applicable, shown as such.

**Origin.** Calculated.

**Limitations.** Grouping is by evidence with stated confidence; a wrong grouping creates a
false disagreement, and the confidence is shown with it.

**Presentation.** A count with each disagreement listing both outcomes and no winner.

**Validation.** `contradict-junit`, `contradict-playwright`, `pair-junit`, `pair-playwright`.

## Planned metrics

Each needs its preconditions met before it is shown.

### K-14 New failures

**Status:** Planned

**Preconditions.** A previous run that is comparable (same project, configuration and
environment, and a known commit relation) must exist; otherwise the metric is not shown.

### K-15 Repeated failures

**Status:** Planned

**Preconditions.** At least the configured number of comparable runs, with the number shown.

### K-16 Flakiness from history

**Status:** Planned

**Preconditions.** Enough comparable executions of the same code state to distinguish
instability from change; the minimum is stated beside the label.

### K-17 Test layer distribution

**Status:** Planned

**Preconditions.** A reliable classification of tests into layers, which no detector
provides today.

### K-18 Coverage gaps

**Status:** Planned

**Preconditions.** Coverage and results from comparable runs, and a stated definition of a
gap that does not treat missing coverage as zero.

### K-19 Execution reliability

**Status:** Planned

**Preconditions.** The runner exists and has recorded enough executions to measure.

## Existing metrics in the reporting policy

The reporting package computes five metrics. Their disposition:

| Metric id                | Disposition                                                      |
| ------------------------ | ---------------------------------------------------------------- |
| `first-pass-rate`        | Adopted as K-03.                                                 |
| `execution-failure-rate` | Adopted as K-04.                                                 |
| `flake-rate`             | Adopted as K-05, renamed in the interface to say what it counts. |
| `duration-p50`           | Adopted as K-06.                                                 |
| `duration-p95`           | Adopted as K-07.                                                 |

## Drill-down

Every figure leads to the next level, and the last level is the original file.

1. A metric opens the runs and results that contributed, with the exclusions listed.
2. A result opens its attempts, messages and the run it came from.
3. A run opens its report artifact: format, completeness, warnings and every location the
   same bytes were found.
4. An artifact opens the raw file, unmodified, from the content store.
