# AUTOMATE (local) — product requirements

**Status:** Draft
**Owner:** maintainers
**Last reviewed:** 2026-10-19

What the product is for, what the first release must prove, what is deliberately left out,
and the numbered requirements every later document refers to.

## Vision

AUTOMATE (local) is a local-first application that finds the testing ecosystem of a
repository on the user's machine, reads the test results and coverage already there into
one honest model, and shows what is known, what is missing and what disagrees, with every
number traceable to a file. Later it runs tests with the user's consent and recommends tools
from evidence in the repository.

It must answer five questions:

1. What testing tools, frameworks, reports and configurations exist here?
2. What do the results actually say about quality and risk?
3. What can be run safely, and how?
4. What is missing from the testing strategy?
5. What should be done next, and why?

The first release answers the first two, and the fifth only to the extent that "this report
is stale, partial or contradicted" is an answer. The third is Phase 2, the fourth Phase 3
onward.

## Principles

These are requirements, not preferences. They come from the brief and are unchanged unless
evidence says otherwise.

- Local-first and private by default; works with no network after installation.
- Evidence before conclusions: a number without a source is a defect.
- Unknown, passed, failed, errored, skipped and not run are different things.
- No silent installation, execution or modification of the repository.
- Existing tools are integrated, not replaced. No mandatory AI, account or remote service.
- Simple enough for one developer to maintain.

Positioning and the research behind it are in the
[competitive landscape](./research/competitive-landscape.md); who it is for is in
[users and workflows](./users-and-workflows.md).

## MVP-0: the smallest thing that proves the core

MVP-0 proves only that the core is sound. Everything marked later in the table is out of
MVP-0.

1. A read-only scan of a local repository, provably writing nothing.
2. Detection of projects, test tools and existing report artifacts, with evidence.
3. Ingestion of a few formats into one model: JUnit XML, Playwright JSON and one coverage
   format (lcov first, because it is the one with a real producer in the corpus; Cobertura
   next).
4. A dashboard with trustworthy numbers: each with its source, freshness and an explicit
   indicator for missing data, never a zero standing in for "not reported".
5. Compatibility tests showing data is neither lost nor misread.

### MVP-0 exit criteria

Each is a statement a test can fail. None is a performance number; any such number is an
initial engineering target with a named workload and hardware and is not claimed as measured
until it is.

- No fixture in the corpus has an unknown, missing or incomplete outcome reported as a pass.
- Raw artifact bytes read back with an equal SHA-256 for every golden fixture.
- For every run, product plus indeterminate plus non-product outcomes equal the total.
- A scan of a hashed repository tree leaves the tree unchanged.
- A report with zero tests is representable and shown as such.
- The real report adapters, if reused, produce the corpus goldens; if not reused, the
  replacement does.
- With the network disabled, the application starts, scans, ingests and shows the dashboard,
  and makes no outbound connection.

## Information architecture

| Area                    | MVP-0                                                      | Later                                                    |
| ----------------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| Dashboard               | Counts with denominators, coverage, freshness, provenance  | Trends, flakiness, new failures (Phase 4)                |
| Repository intelligence | Projects, tools, commands, report locations, with evidence | Gap analysis and configuration inconsistencies (Phase 4) |
| Runner                  | None                                                       | Preview, consent, run, live output, history (Phase 2)    |
| Toolbox                 | None                                                       | Catalog, recommendations, install preview (Phase 3)      |
| Settings and history    | Repositories, retention, export, privacy, theme            | Execution safety policies, integrations                  |

## Entities in the first slice

Repository, Project, ToolInstallation, ReportArtifact, TestRun, TestResult and
CoverageSnapshot. Their fields, identifiers and the status vocabulary are in
[data contracts](./data-contracts.md).

## Requirements

Phase is the roadmap phase that delivers the requirement; MVP-0 says whether it is in the
smallest release. Persona ids are from [users and workflows](./users-and-workflows.md).

| ID    | Requirement                                                                                    | Phase | MVP-0 | Persona  | Acceptance criterion                                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------- | ----- | ----- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| R-001 | The scanner is read-only                                                                       | 1     | yes   | P-3      | A hash of the repository tree before and after a scan is equal, including on a repository with read-only files.                   |
| R-002 | A repository is selected and validated before scanning                                         | 1     | yes   | P-1      | A path that is not a directory, is unreadable, or is a filesystem root is refused with a reason.                                  |
| R-003 | Detect projects, ecosystems, package managers, frameworks and candidate commands with evidence | 1     | yes   | P-3, P-5 | Every detection carries at least one `path:line` evidence entry; a detector that returns none fails a test.                       |
| R-004 | Find existing report artifacts in known and custom locations                                   | 1     | yes   | P-3      | Reports in the corpus are found; build output and dependency directories are not walked; symlink loops terminate.                 |
| R-005 | Ingest JUnit XML into the model                                                                | 1     | yes   | P-3      | Every JUnit fixture matches its golden, including truncated, retried, duplicated and zero-test reports.                           |
| R-006 | Ingest Playwright JSON into the model                                                          | 1     | yes   | P-2      | Every Playwright fixture matches its golden, including projects, retries and run-level errors.                                    |
| R-007 | Ingest one coverage format (lcov first)                                                        | 1     | yes   | P-4      | Coverage fixtures match goldens; a metric a file does not report is null, never zero.                                             |
| R-008 | Preserve the original bytes of every ingested report                                           | 1     | yes   | P-3      | Stored bytes have an equal SHA-256 to the source; a tampered or missing blob is reported.                                         |
| R-009 | Unknown never becomes a pass, and counts reconcile                                             | 1     | yes   | P-4      | Property tests over the corpus: no pass over incomplete input; product plus indeterminate plus non-product equals total.          |
| R-010 | The dashboard shows each number with source, denominator and freshness                         | 1     | yes   | P-4      | For every KPI in the dictionary the UI exposes source, denominator, freshness and completeness; a missing value shows as missing. |
| R-011 | Drill down from a number to the tests, report and file behind it                               | 1     | yes   | P-2      | From each dashboard figure, the list of results and the raw file are reachable in a bounded number of steps.                      |
| R-012 | Identical, duplicate, sharded and contradictory reports are handled without silent merging     | 1     | yes   | P-3      | The reconciliation tests pass: duplicates counted once, contradictions listed with no chosen winner, shards summed.               |
| R-013 | Rejected and partial reports are visible with a reason                                         | 1     | yes   | P-3      | A report that cannot be read, or hit a limit, appears in the list with its rejection or partial reason.                           |
| R-014 | A helpful state when no reports exist                                                          | 1     | yes   | P-1      | A repository with no reports shows what was discovered and one safe next action, with no zero-filled metric.                      |
| R-015 | Works offline                                                                                  | 1     | yes   | P-3      | With the network disabled, the full MVP-0 flow succeeds and no outbound connection is attempted.                                  |
| R-016 | The local interface is reachable only by its own user                                          | 1     | yes   | P-3      | The API binds loopback only, requires a per-launch token, and refuses a request with a foreign Host or Origin.                    |
| R-017 | Personal data in reports is redacted before display or export                                  | 1     | yes   | P-3      | Absolute paths and host names in fixtures never appear in the UI, an export or diagnostics.                                       |
| R-018 | Diagnostics can be inspected before they are shared                                            | 1     | yes   | P-3      | The export is written to a file the user opens first; nothing is sent.                                                            |
| R-019 | Retention and history settings                                                                 | 1     | no    | P-3      | Deleting a raw artifact lists the derived runs it removes and asks first.                                                         |
| R-020 | Keyboard operation and accessible contrast on MVP-0 screens                                    | 1     | yes   | P-1      | Every MVP-0 action is reachable by keyboard; an automated accessibility check reports no serious violations.                      |
| R-021 | Show the exact command, directory and environment names before any run                         | 2     | no    | P-2      | A run cannot start without a preview the user confirmed; the preview matches what is spawned.                                     |
| R-022 | Run with a timeout and cancellation that end the whole process tree                            | 2     | no    | P-3      | The process-tree tests pass: after timeout or cancel, no descendant remains, including after the supervisor is killed.            |
| R-023 | Live output with a size limit and redaction                                                    | 2     | no    | P-2      | Output beyond the limit is dropped with a notice; a registered secret never appears in stored or displayed output.                |
| R-024 | Collect results even when the process exits unsuccessfully                                     | 2     | no    | P-2      | A non-zero exit with a valid partial report yields a run labelled partial, not a lost run.                                        |
| R-025 | Execution history                                                                              | 2     | no    | P-2      | Each run records command, scope, times, exit status and artifacts, and survives a restart.                                        |
| R-026 | State plainly that execution is not isolated                                                   | 2     | no    | P-3      | The approval step states that the command can read files, change the repository and use the network.                              |
| R-027 | A catalog of tools as data only                                                                | 3     | no    | P-6      | The catalog loads with schema validation and contains no executable content; unknown fields are rejected.                         |
| R-028 | Recommendations cite evidence from the repository                                              | 3     | no    | P-6      | A recommendation with no evidence entry does not render; absence of a tool is never offered as proof of a problem.                |
| R-029 | Installation is previewed and confirmed                                                        | 3     | no    | P-5      | The preview lists every file the change would modify; nothing is changed without confirmation.                                    |
| R-030 | Deterministic cross-tool findings                                                              | 4     | no    | P-3      | Each finding has a rule, evidence, confidence and a way to dismiss it; a correlation is never worded as a cause.                  |
| R-031 | Flakiness only from sufficient history                                                         | 4     | no    | P-2      | No flaky label is produced from a single run; the minimum history is stated beside the label.                                     |
| R-032 | Optional AI explanations grounded in cited evidence                                            | 4     | no    | P-4      | With AI off, nothing changes; AI output is labelled a hypothesis and cannot run, install or edit anything.                        |
| R-033 | More ecosystems and report formats                                                             | 5     | no    | P-6      | Each added format has a fixture corpus and goldens before it is enabled.                                                          |
| R-034 | Import of CI-produced artifacts                                                                | 5     | no    | P-3      | A downloaded artifact archive is ingested without executing anything in it.                                                       |
| R-035 | Team or shared features, only if justified                                                     | 5     | no    | P-4      | A written decision with evidence of demand exists before any is built.                                                            |
| R-036 | Run the Phase 0 validation                                                                     | 0     | no    | P-3      | Interviews held and a go or no-go recorded against the signals in the validation plan.                                            |
| R-037 | Run the real report adapters against the corpus goldens                                        | 0     | no    | P-3      | Either every golden matches the adapters, or each difference is a recorded decision.                                              |

## Non-goals

- A replacement for any framework's own runner, reporter or IDE integration.
- A hosted service, an account system, or any telemetry required for function.
- Mandatory AI. Anything AI produces is optional, labelled, and cannot act.
- Isolation or sandboxing of executed commands in the first release (see
  [ADR-011](../adr/011-execution-safety-posture-no-isolation-in-the-first-release.md)).
- Judging software quality from a pass rate, or equating test count or coverage with
  correctness.
- Team, cloud or multi-repository analytics before the single-repository core is proven.
- Mobile device farms, load generation and security scanning as products. Their reports may
  be ingested later; running them is not a goal.
- Compatibility with the server platform's data. The two products share no storage.

## Constraints

- A team of one to three engineers; MIT licence; every third-party licence verified
  individually.
- Windows is the tier-1 platform for the first release because it is the platform the
  feasibility work could exercise; macOS and Linux are supported by design and not yet
  tested (an `assumption`).
- Node 24 and TypeScript, SQLite for storage ([ADR-009](../adr/009-sqlite-and-content-addressed-evidence-store.md)),
  a loopback interface first and a desktop shell later
  ([ADR-008](../adr/008-staged-delivery-engine-and-loopback-ui-first.md)).
