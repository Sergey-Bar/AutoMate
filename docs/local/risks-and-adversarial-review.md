# AUTOMATE (local) — risks and adversarial review

**Status:** Draft
**Owner:** maintainers
**Last reviewed:** 2026-10-19

The design read as a sceptical reviewer would read it: what breaks, what the product does
when it does, and which test would show it. Where a test already exists it is linked; where
it does not, the row says the test is planned. Severity is what it costs the user if the
product gets it wrong; likelihood is how often a real repository will hit it. Both are
judgements.

## Failure scenarios

| ID   | Scenario                                                   | Severity | Likelihood | Expected behaviour                                                                                               | Recovery                                                                   | Verification                                                                                    |
| ---- | ---------------------------------------------------------- | -------- | ---------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| F-01 | A repository with thousands of files                       | Medium   | High       | The scan stays cancellable, skips dependency and build directories, and marks itself partial at a limit          | Rescan with a higher limit or narrower scope                               | Planned: a large generated tree with a time-to-cancel check                                     |
| F-02 | A monorepo with several unrelated projects                 | Medium   | High       | Each project is detected separately with its own evidence; results are not summed across projects without saying | The user selects a project or a scope                                      | Planned: monorepo fixture with expected findings                                                |
| F-03 | Test reports are stale                                     | Medium   | High       | Age is shown beside every number; no verdict until a threshold is known                                          | Rerun the tests outside the product, or run them (Phase 2)                 | Planned: freshness tests on fixtures with old and new times                                     |
| F-04 | Several tools report the same execution                    | High     | High       | Grouped with confidence, counted once, never merged                                                              | The user can ungroup or accept a group                                     | [Reconcile test](../../local/test/reconcile.test.mjs)                                           |
| F-05 | Reports contradict each other                              | High     | Medium     | A disagreement is listed with both outcomes and no winner                                                        | The user investigates; the finding stays until the reports change          | [Reconcile test](../../local/test/reconcile.test.mjs)                                           |
| F-06 | A malformed or malicious XML report                        | High     | Medium     | No entity expansion, no file or network access, limits enforced, a rejection or partial result                   | Fix or replace the report; the rest of the scan is unaffected              | [Corpus test](../../local/test/corpus.test.mjs); the real parser is not yet tested              |
| F-07 | A test command hangs forever                               | High     | Medium     | The deadline ends the whole tree; the run is TimedOut and partial results are collected                          | Rerun with a longer deadline or fix the test                               | [Runner test](../../local/test/runner.test.mjs): deadline, cancel and output limit end the tree |
| F-08 | A child process survives cancellation                      | High     | Medium     | On Windows nothing survives the job object; the supervisor verifies the tree is gone                             | Offer cleanup of any leftover recorded process                             | [Process-tree test](../../local/test/proctree.test.mjs); POSIX untested                         |
| F-09 | A repository script attempts destructive operations        | High     | Low        | Not prevented: execution is not isolated. The approval step says so and shows the exact command                  | Restore from version control or backup; use a container for untrusted code | None possible for prevention; the notice is tested as present (R-026)                           |
| F-10 | Test output contains credentials                           | High     | Medium     | Registered values and recognised patterns are removed from stored and displayed output                           | Rotate the credential; the interface says pattern redaction is best effort | [Runner test](../../local/test/runner.test.mjs) with runtime-built synthetic secrets            |
| F-11 | A dependency the tests need is missing                     | Low      | High       | The run is Blocked with the missing item named; nothing is installed implicitly                                  | The user installs it, outside the product or through a previewed change    | Planned: a blocked-run fixture                                                                  |
| F-12 | The process exits non-zero but wrote valid partial results | Medium   | High       | The run is Partial with results ingested; exit status is recorded, not the verdict                               | None needed; the user sees both                                            | Planned: a failing command that writes a report                                                 |
| F-13 | Coverage formats are incompatible                          | Medium   | Medium     | Each is read by its own parser; unsupported formats are listed unrecognised; totals are never mixed              | Convert the report or wait for a parser                                    | [Corpus test](../../local/test/corpus.test.mjs) for the supported format                        |
| F-14 | A tool is detected but cannot be executed                  | Low      | High       | Shown as detected, not ready, with the reason; detection is never a promise it runs                              | Fix the configuration                                                      | Planned: detector fixtures with a missing runtime                                               |
| F-15 | The repository changes during a scan                       | Medium   | Medium     | A file that changes while read is read again once, then recorded as changed-during-read and skipped              | Rescan                                                                     | Planned: a test that rewrites files mid-scan                                                    |
| F-16 | The application closes during an execution                 | High     | Medium     | On Windows the job object ends the tree; at next start the interrupted run is recorded as crashed                | Rerun                                                                      | [Process-tree test](../../local/test/proctree.test.mjs) (supervisor killed)                     |
| F-17 | The database is unavailable or storage is exhausted        | High     | Low        | A stable error code; nothing half-written; nothing already stored lost                                           | Free space or fix permissions and retry                                    | [Store test](../../local/test/store.test.mjs)                                                   |
| F-18 | An update breaks an existing integration                   | Medium   | Medium     | Parsers are versioned; derived data is rebuilt from raw artifacts; the previous data stays readable              | Roll back; rebuild                                                         | [Store test](../../local/test/store.test.mjs) for rebuild and migration copy                    |
| F-19 | An AI-generated recommendation is wrong                    | Medium   | Medium     | It is labelled a hypothesis, cites evidence, and cannot act                                                      | The user dismisses it; nothing was executed                                | Planned: hostile-report tests for the model path                                                |

## Prioritised risks

Ordered by severity times likelihood, with the mitigation that matters most.

1. **F-04 and F-05, reports describing one execution** (high, high): the core promise of
   trustworthy cross-tool reporting. Mitigated by group-not-merge and no silent winner;
   the grouping parameters are unvalidated.
2. **F-06, hostile reports** (high, medium): the product parses files from repositories it
   does not trust. Mitigated in the prototype; the real parser is untested.
3. **F-07, F-08 and F-16, runaway and orphaned processes** (high, medium): mitigated on
   Windows by a job object; the launcher mechanism is an open choice, POSIX is untested.
4. **F-10, credentials in output** (high, medium): pattern redaction is best effort.
5. **F-09, destructive scripts** (high, low): not preventable without isolation; accepted and
   stated.

## Final evaluation

Not a score. For each dimension: what the design is, what supports it, what is missing, and
the one change worth the most.

| Dimension                        | Assessment                                         | Evidence                        | Remaining gap                          | Highest-value improvement                    | Acceptance criterion                                                |
| -------------------------------- | -------------------------------------------------- | ------------------------------- | -------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| Product clarity                  | Clear on the core promise; the name is provisional | The PRD and the positioning     | Final naming                           | Decide the name                              | A written decision                                                  |
| User value                       | Plausible, unproven                                | Hypotheses H-1 to H-4           | No user has been asked                 | Run the Phase 0 interviews                   | A recorded go or no-go                                              |
| Ease of onboarding               | A single first screen is specified                 | The onboarding and empty states | Untested with a newcomer               | Time a newcomer on the corpus                | A newcomer finds the test command and a report without help         |
| Accuracy of metrics              | Strong rules, small fixture set                    | KPI dictionary; corpus tests    | One real producer per format at most   | Grow the corpus with real third-party output | Every KPI matches hand computation on real reports                  |
| Breadth of framework integration | Narrow by design                                   | Three formats                   | Many ecosystems absent                 | Add formats only with a corpus first         | Each format has fixtures and goldens before release                 |
| Depth of cross-tool analysis     | Reconciliation only                                | Reconcile spike                 | No history, no findings                | Defer until the core is proven               | Preconditions in the planning document met                          |
| Runner safety                    | Honest, with termination proven on one platform    | Process-tree tests              | POSIX untested; no isolation by design | Choose the job-object mechanism and test it  | Termination tests pass on each supported platform                   |
| Privacy                          | Local by default, nothing leaves                   | Design; redaction rule          | Redaction patterns incomplete          | Redaction test corpus                        | No personal data in any display, export or diagnostic in the corpus |
| Security                         | Loopback token and header checks designed          | Threat model                    | Not built or tested                    | Build the interface checks first             | Integration tests for token, Host and Origin                        |
| Performance                      | Unmeasured                                         | One synthetic observation       | No targets validated                   | Measure on named hardware                    | Targets recorded with workload and hardware                         |
| Accessibility                    | Required in every state                            | UX specification                | Nothing built                          | Automated checks from the first screen       | No serious violations on any screen and state                       |
| Maintainability                  | One language, small modules                        | Architecture                    | Code is in `local/`, not packages      | Graduate it into packages                    | The packages exist and the repository gates pass on them            |
| Extensibility                    | Detector and parser contracts                      | Discovery engine                | No second implementation yet           | Add a format using only the contract         | A new format needs no change to the core loop                       |
| Operational simplicity           | One process, one directory                         | Architecture                    | Packaging unexplored                   | A Windows install and upgrade test           | A fresh install and an upgrade keep data                            |
| Differentiation                  | A hypothesis, not a finding                        | Landscape                       | Competitors not run or tested          | Test with users                              | At least one of H-1 to H-3 supported by user evidence               |
| Feasibility for a small team     | Plausible                                          | Spikes ran on Node alone        | Real adapters and parser unverified    | Run the real adapters on the corpus          | R-037 satisfied                                                     |

## The three decisions most likely to decide success

1. **Whether the problem is real.** Everything depends on automation engineers wanting an
   honest, local read of reports they already have. No one has been asked.
2. **Whether the model survives real-world reports.** The corpus is mostly handwritten and
   one tool's real output. The model's value is that it does not lie; one class of report it
   misreads costs the trust it exists to build.
3. **Whether "process control, no isolation" is acceptable to users who run untrusted
   repositories.** It is honest, and it may not be enough for some of them.

## Unresolved decisions

- The product's final name.
- The SQLite driver, and the evidence for the one not measured.
- How a job object is created on Windows: shipped native helper, addon, or launcher script.
- Whether the real report adapters are reused or replaced.
- Whether to record the runner's termination and input-limit gaps as ledger findings
  (proposed only; an open ledger row can turn the merge gate red).
- The grouping parameters (time window, overlap) and the limits, all unvalidated.
- Which coverage format comes second.
- Desktop shell or none.
- POSIX termination behaviour.
