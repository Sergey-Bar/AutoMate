# AUTOMATE (local) — quality, performance and observability

**Status:** Draft
**Owner:** maintainers
**Last reviewed:** 2026-10-19

What "good enough to release" means for the first release, how each criterion is checked,
and how the product explains itself. No result in this document is a measurement unless it
says where and when it was measured.

## Acceptance criteria

| Area                     | Criterion                                                                                      | How it is verified                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Functional correctness   | Every fixture matches its hand-written golden                                                  | The corpus test over `local/corpus`, moved into the product tests                        |
| Scanner accuracy         | Every tool and report in the repository corpus is found with evidence; none is invented        | Corpus run with expected-findings files; any finding without evidence fails              |
| Read-only                | A scan leaves the repository tree unchanged                                                    | Hash before and after, including read-only files and symlinks                            |
| Report parsing           | No unknown, missing or incomplete outcome reported as a pass; counts reconcile                 | Property assertions over the whole corpus                                                |
| Hostile input            | Size, depth and count limits hold; no entity expansion; no file or network access from parsing | Hostile fixtures against the real parser; a check that the parsing modules import no I/O |
| Deduplication            | Identical files once; groups carry confidence; contradictions have no winner                   | The reconciliation tests                                                                 |
| Metric correctness       | Every KPI in the dictionary matches a hand computation on its named fixtures                   | Table-driven tests per KPI with the fixtures the dictionary names                        |
| Evidence preservation    | Stored bytes equal source bytes; tampering and loss are detected; ingestion is atomic          | The store tests, including the killed-process case                                       |
| Recovery                 | After a crash, a full disk or a newer schema, the store is consistent and says what happened   | The store tests                                                                          |
| Local interface security | Loopback only; token required; foreign Host or Origin refused                                  | Integration tests against the running engine                                             |
| Offline                  | Full first-release flow with the network disabled; no outbound connection attempted            | An end-to-end test in a network-denied environment                                       |
| Runner safety (Phase 2)  | After timeout or cancel, no descendant remains, including when the supervisor is killed        | The process-tree tests on each supported platform                                        |
| Accessibility            | No serious violations on any screen in any state; everything operable by keyboard              | Automated check per screen and state; a manual screen-reader pass                        |
| Packaging and upgrade    | A fresh install works; an upgrade keeps data; a downgrade refuses safely                       | Install and upgrade tests per platform                                                   |

## Performance and resource targets

These are **initial engineering targets**, not results. None has been measured. Each needs a
named workload, hardware and method before it can be claimed.

| Target (initial engineering)                                  | Workload to define                                      | Hardware to name             | Method                                                |
| ------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------- | ----------------------------------------------------- |
| A scan stays responsive and cancellable on a large repository | A repository with a stated number of files and depth    | A named laptop-class machine | Time to first result, time to cancel, memory at peak  |
| Ingesting a large report does not exhaust memory              | A report with a stated number of tests and message size | The same                     | Peak memory and elapsed time at the configured limits |
| The dashboard renders from stored data quickly                | A store with a stated number of runs and results        | The same                     | Time from request to first complete render            |
| The engine's idle footprint is small                          | The engine running with a repository registered         | The same                     | Resident memory and CPU over a stated interval        |

One observation exists and is only that: on one Windows machine with Node v24.21.0, the
spike's reader parsed a synthetic report of twenty thousand tests in about seventy
milliseconds in a single run. It shows nothing quadratic is hiding in the reader; it is not
a target and not representative.

## Test strategy

- **Unit tests** for parsers, detectors, reconciliation and analysis, colocated with the
  code. Written to fail first, shown failing, then made to pass.
- **Parser fixture tests**: the corpus with provenance and goldens. A fixture without a
  golden fails the documentation gate.
- **Property tests** where an invariant is the point: counts reconcile; unknown never becomes
  pass; the model round-trips.
- **Fuzz and hostile input** for every parser that reads untrusted bytes: malformed,
  truncated, deeply nested, entity-heavy, oversized, wrongly encoded.
- **Integration tests** of scan to store to API against real directories.
- **End-to-end tests** of the interface against a running engine.
- **Security tests**: the interface's token and header checks; the read-only guarantee;
  redaction.
- **Cross-platform tests**: path handling, long paths, case sensitivity, process trees, on
  each platform the release claims.
- **Compatibility tests** against the Phase 0 repository corpus.
- **Regression tests**: every defect found gets a fixture and a test before it is fixed.

### Test matrix

| Dimension        | Values                                                                                |
| ---------------- | ------------------------------------------------------------------------------------- |
| Operating system | Windows (first), macOS, Linux                                                         |
| Ecosystem        | JavaScript, Java or Kotlin, Python, .NET, mixed                                       |
| Repository shape | No reports, one project, monorepo, nested repositories, very large                    |
| Report formats   | JUnit XML, Playwright JSON, lcov                                                      |
| Report condition | Complete, truncated, malformed, empty, zero tests, duplicated, sharded, contradicting |
| Filesystem       | Case-sensitive and not, long paths, symlinks and junctions, read-only files           |

## Release criteria

A release candidate needs: every criterion above that applies to its phase verified; the
documentation gate green; no open item in the threat model that is neither mitigated nor an
accepted risk with an owner; and a recorded list of what was not verified. A release does
not wait for a performance number nobody can measure yet; it states that the number is
unmeasured.

## Observability of the product itself

- **Structured local logs** in the application's data directory, one record per event, with
  a level, a component and a correlation identifier. Components: scan, detection, parsing,
  ingestion, metric computation, recommendation, runner, interface, application.
- **Correlation.** A scan, an ingest or a run gets an identifier carried in the log, the
  stored record, the artifacts and the events the interface receives, so a figure on screen
  leads back to what produced it.
- **No secrets and no personal data in logs.** Paths are repository-relative; host names are
  not logged; registered secret values are removed.
- **Diagnostic export.** A user action that writes a file containing recent logs, versions
  and the scan summary. The user opens it before sharing. Nothing is sent by the product.
- **Telemetry.** None is required for any function. If it is ever proposed, it is off by
  default, lists exactly what it collects, requires an explicit opt-in and has an opt-out.
- **Errors** shown to users name the cause and the action; the log holds the detail.
