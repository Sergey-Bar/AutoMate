# AUTOMATE (local) — data contracts

**Status:** Draft
**Owner:** maintainers
**Last reviewed:** 2026-10-19

The canonical data model for the first slice of AUTOMATE (local): what is stored, how it is
identified, how outcomes are named, and how it relates to the server platform's contract.
Only the entities needed by the first slice (MVP-0) are specified. Everything else in the
product brief is named in the last section and marked Planned.

The model was exercised by a feasibility spike against a fixture corpus; the spike and its
limits are described in `docs/local/feasibility.md` once that document is written. Where a
statement here depends on spike evidence it says so, and where the evidence does not exist
yet it is marked Proposed.

## Principles

These are requirements on every entity below, and each has a test in the spike.

1. **Raw evidence is the source of truth.** The original bytes of every report are stored
   unchanged and addressed by their SHA-256. Everything else (runs, results, coverage) is
   derived and can be rebuilt by re-parsing.
2. **Absent is not zero.** A metric a report does not contain is `null`, never `0`.
3. **Unknown stays unknown.** A test whose outcome was not observed is `unknown`, and no
   rule turns `unknown` into `passed`.
4. **Nothing is dropped silently.** Anything the model cannot represent becomes a warning
   code on the run, and the original text stays in the raw artifact.
5. **Counts are derived, never stored.** A run's totals are computed from its results, so
   there is no second number that can disagree with the first.
6. **A rejection is a result.** "This could not be read" and "this contained nothing" are
   different answers and are stored differently.

## Entities (MVP-0)

All identifiers are lowercase hexadecimal digests unless stated. All timestamps are UTC
ISO-8601 strings ending in `Z`; a report that carries no timestamp yields `null`, and the
time of ingestion is stored separately as `observedAt` so it is never mistaken for the time
the tests ran.

### Repository and Project

| Entity     | Field            | Type            | Notes                                                           |
| ---------- | ---------------- | --------------- | --------------------------------------------------------------- |
| Repository | `id`             | digest          | Hash of the canonical absolute root path chosen by the user.    |
| Repository | `rootPath`       | text            | As selected. Never written to; the scanner is read-only.        |
| Repository | `lastScanAt`     | timestamp, null | `null` until a scan completes.                                  |
| Project    | `id`             | digest          | Hash of `repositoryId` and `relativePath`.                      |
| Project    | `relativePath`   | text            | POSIX separators, `.` for the root.                             |
| Project    | `ecosystem`      | text, null      | From detection; `null` when nothing was recognised.             |
| Project    | `packageManager` | text, null      | Same.                                                           |
| Project    | `evidence`       | list of text    | Each entry is `path:line` text. A project with none is invalid. |

### ToolInstallation (detected)

A tool the repository appears to use, with the evidence for that belief. It is not a claim
that the tool runs.

| Field        | Type          | Notes                                                               |
| ------------ | ------------- | ------------------------------------------------------------------- |
| `id`         | digest        | Hash of `projectId` and the tool name.                              |
| `tool`       | text          | A name from the detector vocabulary.                                |
| `confidence` | number 0 to 1 | A property of the detector, not a gate; see the discovery document. |
| `evidence`   | list of text  | Required, at least one entry.                                       |

### ReportArtifact

| Field       | Type    | Notes                                                                        |
| ----------- | ------- | ---------------------------------------------------------------------------- |
| `id`        | digest  | SHA-256 of the raw bytes. Two files with equal bytes are one artifact.       |
| `byteSize`  | integer | Of the raw bytes.                                                            |
| `format`    | text    | Detected from content: `junit-xml`, `playwright-json`, `lcov`, or `unknown`. |
| `locations` | list    | Each entry: repository, relative path, modification time, time seen.         |
| `storedAt`  | text    | Path of the content-addressed copy. Proposed; see Storage below.             |

### TestRun and TestResult

| Entity     | Field          | Type            | Notes                                                                          |
| ---------- | -------------- | --------------- | ------------------------------------------------------------------------------ |
| TestRun    | `id`           | digest          | Hash of `artifactId`, parser name and parser version. Re-ingest is idempotent. |
| TestRun    | `artifactId`   | digest          | The raw evidence this run was derived from.                                    |
| TestRun    | `format`       | text            | As on the artifact.                                                            |
| TestRun    | `startedAt`    | timestamp, null | From the report only.                                                          |
| TestRun    | `observedAt`   | timestamp       | When AUTOMATE ingested it.                                                     |
| TestRun    | `completeness` | text            | `complete`, `partial`, `unknown` or `rejected`. See below.                     |
| TestRun    | `runStatus`    | text            | See below.                                                                     |
| TestRun    | `runErrors`    | integer         | Errors reported by the run itself, as opposed to by a test.                    |
| TestRun    | `warnings`     | list of text    | Codes from the registry below.                                                 |
| TestResult | `id`           | digest          | Hash of `runId`, `key` and the occurrence number.                              |
| TestResult | `key`          | digest          | Identity: suite, class name, name, project and raw file text.                  |
| TestResult | `name`         | text            | As reported.                                                                   |
| TestResult | `suite`        | text, null      |                                                                                |
| TestResult | `project`      | text, null      | Part of the identity. See the gap list below.                                  |
| TestResult | `file`         | text, null      | Repository-relative POSIX path, or `null`. Never an absolute path.             |
| TestResult | `fileRaw`      | text, null      | Exactly what the report wrote.                                                 |
| TestResult | `outcome`      | text            | From the outcome table. The last attempt's outcome.                            |
| TestResult | `flakiness`    | text            | `observed` or `unknown`. Never `none`: one run cannot show a test is stable.   |
| Attempt    | `index`        | integer         | 1-based within the result.                                                     |
| Attempt    | `outcome`      | text            | As the outcome table.                                                          |
| Attempt    | `rawStatus`    | text            | The producer's own word, kept.                                                 |
| Attempt    | `durationMs`   | number, null    | `null` when absent or invalid.                                                 |
| Attempt    | `message`      | text, null      | Capped; `messageTruncated` records the cap.                                    |

### CoverageSnapshot

| Entity       | Field          | Type         | Notes                                                                     |
| ------------ | -------------- | ------------ | ------------------------------------------------------------------------- |
| Coverage     | `id`           | digest       | Hash of `artifactId`, parser name and parser version.                     |
| Coverage     | `completeness` | text         | As for runs.                                                              |
| Coverage     | `totals`       | object       | `lines`, `functions`, `branches`: each `{found, hit, percent}` or `null`. |
| FileCoverage | `path`         | text         | As in the report.                                                         |
| FileCoverage | `lines`        | object       | `{found, hit}`.                                                           |
| FileCoverage | `functions`    | object, null | `null` when the file reports no function data.                            |
| FileCoverage | `branches`     | object, null | `null` when the file reports no branch data.                              |

`percent` is `null` when `found` is zero. A file with no executable lines is neither 0% nor
100% covered. Totals cover the files that report a metric, and the warning
`metric-not-reported-by-all-files` is raised when that is fewer than all of them.

## Status vocabulary

### Outcomes

| Outcome      | Class         | Meaning                                                      |
| ------------ | ------------- | ------------------------------------------------------------ |
| `passed`     | product       | The test ran and its assertions held.                        |
| `failed`     | product       | The test ran and an assertion did not hold.                  |
| `errored`    | product       | The test raised an unexpected error (JUnit `error`).         |
| `skipped`    | product       | The producer reported it as skipped.                         |
| `timedOut`   | product       | The test exceeded its time limit.                            |
| `unknown`    | indeterminate | No outcome was observed, or the report was cut before it.    |
| `notRun`     | nonProduct    | There is no evidence the test executed.                      |
| `aborted`    | nonProduct    | Stopped before an outcome existed.                           |
| `infraError` | nonProduct    | The harness failed: configuration, infrastructure or runner. |

Rates are computed over product outcomes only. Indeterminate and non-product outcomes are
counted and reported beside the rate, so a denominator is never silently changed.

### Run status

| Value          | Rule                                                                                |
| -------------- | ----------------------------------------------------------------------------------- |
| `failed`       | Any result is `failed`, `errored` or `timedOut`. A failure outranks incompleteness. |
| `errored`      | No test failed, but the run reported its own errors or a result is `infraError`.    |
| `noTests`      | The report is readable and contains no tests and no run errors.                     |
| `unknown`      | Not complete, or some result is not a product outcome, and nothing failed.          |
| `noneExecuted` | Complete and every result is skipped.                                               |
| `passed`       | Complete, no failure, every result a product outcome, and at least one passed.      |
| `rejected`     | The input could not be read. There are no results.                                  |

### Completeness

| Value      | Meaning                                                                         |
| ---------- | ------------------------------------------------------------------------------- |
| `complete` | The whole document parsed and no result is indeterminate.                       |
| `partial`  | A configured limit stopped ingestion; the results present are real but not all. |
| `unknown`  | The document was truncated, not well-formed, or holds an unknown result.        |
| `rejected` | Nothing usable could be read.                                                   |

## Mapping from the server contract

The server platform's run contract (`automate.run@2`) cannot express every case the local
model needs, so the local model is separate and maps from the contract in one direction.
The table below must list exactly the contract's status values;
`scripts/lib/blueprint-consistency.test.mjs` derives the contract's list from
`packages/shared-contracts/src/schemas/canonical-reporting.ts` and fails when this table and
that list differ in either direction. The spike's own test checks the same list against the
mapping in code.

| Contract status | Local outcome | Notes                                                                    |
| --------------- | ------------- | ------------------------------------------------------------------------ |
| `passed`        | `passed`      |                                                                          |
| `failed`        | `failed`      |                                                                          |
| `flaky`         | `passed`      | With `flakiness: observed`: it passed after at least one failed attempt. |
| `skipped`       | `skipped`     |                                                                          |
| `timedOut`      | `timedOut`    |                                                                          |
| `unknown`       | `unknown`     |                                                                          |
| `running`       | `unknown`     | The run was still going; the result is incomplete.                       |
| `cancelled`     | `aborted`     |                                                                          |
| `blocked`       | `notRun`      |                                                                          |
| `configFailed`  | `infraError`  | A non-product class in the contract; kept non-product.                   |
| `infraFailed`   | `infraError`  | Same.                                                                    |
| `runnerFailed`  | `infraError`  | Same.                                                                    |

There is deliberately no mapping into the contract. The local product never writes to it.

## Warning and rejection codes

A warning is data attached to a run. Codes are stable strings; a code is added here before
it is emitted.

| Code                               | Meaning                                                             | Effect on completeness |
| ---------------------------------- | ------------------------------------------------------------------- | ---------------------- |
| `doctype-ignored`                  | A document type declaration was present and was skipped, not read.  | none                   |
| `entity-undefined`                 | A reference to an entity the reader does not define; left as text.  | `unknown`              |
| `char-reference-invalid`           | A numeric character reference outside the allowed range.            | `unknown`              |
| `xml-malformed`                    | The document is not well-formed in a recoverable way.               | `unknown`              |
| `xml-truncated`                    | The document ended inside an element.                               | `unknown`              |
| `invalid-encoding-bytes`           | Bytes that are not valid in the declared encoding were replaced.    | none                   |
| `declared-count-mismatch`          | Counts the report declares disagree with its elements.              | none                   |
| `duplicate-identity`               | Several results share one identity with no retry evidence.          | none                   |
| `skipped-and-failed`               | One test carries both a skip and a failure marker.                  | none                   |
| `path-absolute`                    | A file name was absolute and could not be made repository-relative. | none                   |
| `path-unsafe`                      | A file name tried to leave the repository.                          | none                   |
| `duration-invalid`                 | A duration was not a non-negative number.                           | none                   |
| `message-truncated`                | A failure message exceeded the cap and was cut.                     | none                   |
| `test-limit-reached`               | The configured test count limit stopped ingestion.                  | `partial`              |
| `unknown-status`                   | A producer status this model has no mapping for.                    | `unknown`              |
| `no-results`                       | A test with no recorded attempts.                                   | `unknown`              |
| `null-entry`                       | A null suite or test, typically a worker that never reported.       | `unknown`              |
| `declared-flaky-mismatch`          | The producer's flaky flag disagrees with its attempt history.       | none                   |
| `run-level-errors`                 | The report carries errors that belong to the run, not to a test.    | none                   |
| `lcov-bad-line`                    | A coverage line that does not parse, or an unknown tag.             | `unknown`              |
| `lcov-truncated`                   | A coverage record that never closed.                                | `unknown`              |
| `lcov-count-mismatch`              | Declared line, function or branch totals disagree with the detail.  | none                   |
| `metric-not-reported-by-all-files` | A total covers only the files that report that metric.              | none                   |

Rejection codes: `empty-input`, `unrecognised-format`, `not-xml`, `not-junit`, `not-json`,
`not-playwright`, `not-lcov`, `too-large`, `too-deep`, `unsupported-encoding`.

## Identity, duplicates and reconciliation

Proposed, and exercised by a spike (RISK-2 in `docs/local/feasibility.md`). Parameters below
are proposals chosen without data from real CI systems.

- **Exact duplicates share an artifact.** The artifact id is the digest of the bytes, so
  two files with equal bytes are one artifact with two locations, and its results are
  counted once.
- **A result's `key` includes the project name**, so one test run in two browsers is two
  results.
- **Several results with the same `key` and no retry evidence stay separate** and raise
  `duplicate-identity`, because merging them could hide a failing parameterised case
  behind a passing one. Retry evidence is explicit: Surefire rerun and flaky elements, a
  Playwright `results` list.
- **Different formats of one execution are grouped, not merged.** A group needs evidence:
  a shared run key, the same commit, observation times within five minutes of each other,
  and at least half of the smaller report's tests present in both. Confidence is high with
  a shared run key, medium with a known commit and time, and low when the commit or the
  time is unknown, and the group records the limits that applied.
- **Reports from different commits are incomparable.** They are kept and listed and are not
  added together.
- **A contradiction is a finding.** When members of a group disagree about a test, both
  outcomes are recorded with no chosen winner, and the group is marked contested. The
  format ranking (a framework's own machine-readable report before JUnit) only decides
  which member is displayed first.
- **Shards add up.** Shards of one run (same run key and shard total, different index) are
  summed, and a missing shard makes the run partial.
- **Retries are attempts inside one result.** Nothing merges across results, so a retry is
  never mistaken for a duplicate.

The context a group needs (commit, run key, shard, observation time) comes from the
scanner and from the user. How the scanner obtains each is not yet specified.

## Storage, versioning and retention

Proposed, and exercised by a spike (RISK-3 and RISK-6 in `docs/local/feasibility.md`).

- A SQLite database holds metadata and derived tables, with write-ahead logging, full
  synchronous mode and foreign keys on.
- A content-addressed directory holds raw bytes, named by digest and sharded by the first
  two characters. A blob is written to a temporary file in the same directory, made durable,
  and renamed, before the transaction that references it. A crash between the two leaves an
  unreferenced blob and never a dangling reference.
- Ingestion is one transaction. The run id is the hash of the artifact id, parser name and
  parser version, so re-ingesting is a no-op.
- The schema version is stored in the database and checked on open. A newer database is
  refused untouched. Migrations are forward-only, copy the database file first, and roll
  back on failure.
- Derived tables can be dropped and rebuilt from the blobs, using the parse context stored
  with each run (for example the repository root used to make paths relative).
- Integrity is checked by re-hashing blobs. A missing or altered blob is reported, never
  papered over.
- A full disk or a full database is reported with a stable error code and loses nothing
  already stored.

The driver is not decided; see
[ADR-009](../adr/009-sqlite-and-content-addressed-evidence-store.md).

Retention: nothing is deleted unless the user asks or sets an age or size policy. Deleting a
raw artifact deletes the runs derived from it, and says so first.

## Inherited gaps

Read in the server platform's code; **not executed**, because the workspace dependencies
could not be installed in the environment that wrote this document. Each is a reason the
local model is separate rather than a bug report against the server platform.

| Gap                                                           | Where it was read                                              | Effect on the local product                                        |
| ------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `workspaceId` is required in a run's identity                 | `packages/shared-contracts/src/schemas/canonical-reporting.ts` | A single-user product would carry a constant it does not need.     |
| No `errored` status; JUnit `error` collapses to failed        | `packages/reporter/src/adapters/junit-xml.ts`                  | The distinction between a failed and an errored test is lost.      |
| `attempts` requires at least one entry                        | the same schema; both adapters throw on an empty report        | A run with zero tests cannot be represented, only refused.         |
| The quality gate wants `proof: verified`                      | `packages/reporting`; the adapters emit `unverified`           | Reusing the gate unchanged would fail every local run.             |
| Playwright identity ignores the project name                  | `packages/reporter/src/adapters/playwright-json.ts`            | The same spec in two projects looks like two attempts of one test. |
| JUnit with no `file` gets the path `unknown.spec.ts`          | `packages/reporter/src/adapters/junit-xml.ts`                  | A made-up location is stored as if it were real.                   |
| No cap on total input size or test count                      | the reporter adapters                                          | Needs a limit at the call site.                                    |
| `timedOut` in the contract, `timed_out` in other vocabularies | `packages/shared-contracts`, `packages/db`                     | Two spellings of one concept.                                      |
| XML safety of the parser used by the adapter is unconfirmed   | `packages/reporter/package.json`                               | Needs hostile-input fixtures run against the real parser.          |

## Planned

Named in the product brief and not specified here: TestSuite and TestCase as stored entities
separate from results, ToolCapability, Finding, Recommendation, ExecutionEvent, execution
history, and test discovery counts. Each needs its own preconditions and is described in the
document that owns it.
