# AUTOMATE (local) — roadmap

**Status:** Draft
**Owner:** maintainers
**Last reviewed:** 2026-10-19

The order of delivery, what each phase must prove, what is deliberately left out, and the
first implementation milestone. Milestone 1 was specified here as a set of packages. What was
built instead is dependency-free code in [`local/`](../../local/README.md), described in
[implementation-status.md](./implementation-status.md); the package tasks below are not done.
Requirement ids are from the [PRD](./prd.md).

## How phases are used

A phase ends when its exit criteria are met, not on a date. A phase that cannot meet them
is a decision point: change the scope, or stop. Features are not added because a competitor
has them.

## Phase 0: validation

**User value.** Learning whether the problem is real, before more is built.

**Scope.** Interviews; the repository corpus; running the real report adapters against the
existing fixture goldens; deciding the open choices that block Phase 1 (the name, the
SQLite driver, reuse or replacement of the adapters).

**Requirements.** R-036, R-037.

**Dependencies.** Access to people who maintain test setups; an environment where the
workspace dependencies can be installed.

**Deliverables.** Interview notes, a corpus list with licences, the adapter comparison, and
accepted decision records.

**Acceptance criteria.** The go and no-go signals in
[users and workflows](./users-and-workflows.md) are assessed and recorded; every golden
either matches the real adapters or has a recorded decision.

**Risks.** Finding that existing reports already answer the question; adapters that cannot
be reused.

**Validation.** The interview script; the corpus test run against the adapters.

**Exit criteria.** A written go or no-go; the open choices decided or explicitly deferred.

**Deferred.** Everything else.

## Phase 1: discovery and dashboard (MVP-0)

**User value.** Point at a repository and see what testing exists and what its reports say,
honestly.

**Scope.** Read-only scan; detection with evidence; report discovery; ingestion of JUnit,
Playwright JSON and lcov; the evidence store; reconciliation; the engine and its local
interface; onboarding, dashboard and report detail; diagnostics export.

**Requirements.** R-001, R-002, R-003, R-004, R-005, R-006, R-007, R-008, R-009, R-010,
R-011, R-012, R-013, R-014, R-015, R-016, R-017, R-018, R-019, R-020.

**Dependencies.** Phase 0 exit; the evidence-model package; the corpus.

**Deliverables.** The packages in the module table below, the interface, the corpus with
goldens moved into the product's tests, and a Windows package.

**Acceptance criteria.** The MVP-0 exit criteria in the PRD.

**Risks.** Real reports the model misreads; hostile input to the real parser; grouping
parameters that do not fit real CI output.

**Validation.** The corpus and property tests; the Phase 0 repository corpus; an
end-to-end run with the network disabled; users from Phase 0.

**Exit criteria.** The PRD's MVP-0 exit criteria all hold, and at least one user from the
interviews has used it on their own repository.

**Deferred.** Running tests, the toolbox, trends, flakiness, AI, other formats, shells.

## Phase 2: runner

**User value.** Run what was discovered, with consent, and have the results appear.

**Scope.** Command preview and approval, spawn without a shell, environment allowlist,
timeouts and cancellation that end the whole tree, live output with limits and redaction,
collection on failure, history, and the plain notice that execution is not isolated.

**Requirements.** R-021, R-022, R-023, R-024, R-025, R-026.

**Dependencies.** Phase 1; the job-object mechanism chosen and tested; POSIX termination
tested if those platforms are supported.

**Deliverables.** The runner module, its tests on each supported platform, the Runner and
History screens.

**Acceptance criteria.** The process-tree tests pass including when the supervisor is
killed; a non-zero exit with a valid report yields a partial run.

**Risks.** Antivirus or policy blocking the helper; users trusting the run more than they
should.

**Validation.** The termination test grid on each platform; a review of the approval text.

**Exit criteria.** No descendant survives in any scenario in the grid on any supported
platform.

**Deferred.** Isolation of any kind.

## Phase 3: toolbox

**User value.** Learn which tools would help this repository, and add one safely.

**Scope.** A data-only catalog, evidence-backed recommendations, previewed installation.

**Requirements.** R-027, R-028, R-029.

**Dependencies.** Phase 2's consent path.

**Deliverables.** The catalog schema and loader, recommendation rules, the Toolbox screen.

**Acceptance criteria.** An entry with executable content is rejected; a recommendation
without evidence does not render; no change is applied without a confirmed preview.

**Risks.** Licence claims that are wrong; recommendations that read as pressure.

**Validation.** Schema tests; a review of the first entries against their licence files.

**Exit criteria.** The listed acceptance criteria and a licence check recorded per entry.

**Deferred.** Automatic installation, remote catalogs.

## Phase 4: advanced intelligence

**User value.** Notice change over time and cross-tool problems.

**Scope.** Deterministic cross-tool findings, flakiness from history, deeper coverage
analysis, and an optional, off-by-default AI layer.

**Requirements.** R-030, R-031, R-032.

**Dependencies.** Run history; comparable-run rules.

**Deliverables.** The findings engine and its screens; the optional AI layer if justified.

**Acceptance criteria.** Each finding has a rule, evidence, confidence, false-positive
handling and a dismissal; no flaky label from a single run.

**Risks.** False findings eroding trust; AI adding cost with no evidence of value.

**Validation.** Fixtures of comparable and incomparable runs; user review of findings.

**Exit criteria.** Findings that users act on; a recorded decision on AI.

**Deferred.** Anything team-oriented.

## Phase 5: expansion

**User value.** More ecosystems and formats, and CI artifacts.

**Scope.** Additional parsers each with a corpus first, import of CI artifact archives, and
team features only if justified.

**Requirements.** R-033, R-034, R-035.

**Dependencies.** Demand from users.

**Deliverables.** Parsers, importers and any shared features.

**Acceptance criteria.** Each added format has fixtures and goldens before it is enabled.

**Risks.** Breadth outrunning correctness.

**Validation.** The corpus gate.

**Exit criteria.** A written decision for each item.

**Deferred.** Cloud services unless a compelling user benefit is shown.

## Definition of done

**A phase** is done when its exit criteria hold, its documents are current, the
documentation gate is green, the threat model has no unmitigated item without an accepted
risk and an owner, and what was not verified is recorded.

**A module** is done when:

| Module           | Done when                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `evidence-model` | Vocabulary, mapping and completeness test pass; no dependency; documented in the data contracts   |
| `detect`         | Every finding has evidence; detector tests pass on the repository corpus; traversal limits tested |
| `parsers`        | Corpus goldens match; hostile fixtures pass against the real parser; limits at the call site      |
| `reconcile`      | The reconciliation tests pass; parameters recorded as proposals until validated                   |
| `store`          | Round trip, crash, tamper, full-disk and migration tests pass; the driver decision is accepted    |
| `analysis`       | Every KPI matches hand computation on its named fixtures                                          |
| `engine`         | Interface tests including token, Host and Origin checks pass; the offline test passes             |
| `web`            | Every screen in every state has an automated accessibility check and a story or test              |
| `runner`         | The termination grid passes on each supported platform; consent binds to the preview              |

## Backlog, in order

1. Phase 0 items.
2. The evidence model and its mapping test.
3. Real-adapter conformance and hostile input.
4. The store.
5. Reconciliation.
6. The scanner.
7. The engine and its interface.
8. The three first-release screens.
9. KPI computation.
10. Packaging and diagnostics.
11. Then Phases 2 to 5 in order, each only after the previous exit.

## Milestone 1: specified as packages; built as dependency-free code

The tasks below are the original plan and are unchanged. M1-1 and M1-4 (real adapters, driver
measurement) were not done. M1-7 to M1-9 exist as `local/src` and `local/test` code rather than
packages, and M1-10 is partly done (diagnostics and redaction; no package, no upgrade test).

Ordered so the risks the spikes left open are retired first. Each task ends with a green
test. The spike code was moved into `local/` and is no longer a separate directory; the condition in
[feasibility](./feasibility.md) for deleting it is replaced by the one in that document.

| Task  | Work                                                                                                        | Depends on       | Done when                                                             |
| ----- | ----------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------- |
| M1-1  | Install workspace dependencies; run the real adapters against every corpus golden; record differences       | none             | R-037 satisfied: each golden matches or each difference is a decision |
| M1-2  | Run the hostile XML fixtures against the real parser; add input-size and test-count limits at the call site | M1-1             | Hostile fixtures pass; limits tested                                  |
| M1-3  | Create the `evidence-model` package from the spike model, with the mapping completeness test                | M1-1             | Mapping test fails when the server contract gains a status            |
| M1-4  | Measure `better-sqlite3` against the built-in module on Windows; accept ADR-009                             | none             | Driver chosen on recorded evidence                                    |
| M1-5  | Create the `store` package from the spike, with the store tests moved in                                    | M1-3, M1-4       | Store tests pass in the product                                       |
| M1-6  | Create `reconcile` from the spike, with its tests                                                           | M1-3             | Reconciliation tests pass in the product                              |
| M1-7  | Build the read-only scanner with traversal limits, report discovery and the tree-hash test                  | M1-3             | R-001 to R-004 tests pass                                             |
| M1-8  | Build the engine and its typed interface with token, Host and Origin checks and the offline test            | M1-5, M1-6, M1-7 | R-015 and R-016 tests pass                                            |
| M1-9  | Build onboarding, dashboard and report detail with accessibility checks in every state                      | M1-8             | R-010, R-011, R-013, R-014, R-020 verified                            |
| M1-10 | Diagnostics export, redaction at the edge and a Windows package with an upgrade test                        | M1-9             | R-017, R-018 verified; a fresh install and an upgrade keep data       |
