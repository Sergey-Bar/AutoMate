# AUTOMATE (local) — blueprint master plan

**Status:** blueprint written; a dependency-free implementation of Phases 1 to 5 exists in `local/` (see `docs/local/implementation-status.md`); the package-based Milestone 1 was not done.

**What this plan is.** The one place that lists the decisions, the MVP-0 definition, the
assumptions and the open questions for AUTOMATE (local), and links to the documents under
`docs/local/`. It does not restate their content; a number or a table copied here would be a
second authority.

**What was produced.** Documents, a consistency gate, feasibility proofs, and then the
implementation in `local/`: engine, interface, runner, toolbox, findings, an AI interface with
no model, Cobertura and ZIP import. What was not verified is listed in
`docs/local/implementation-status.md`.

## Decisions taken (by the user)

- A new local-first product inside this monorepo; the server platform stays separate and
  optional ([ADR-007](../../docs/adr/007-local-product-separate-from-server-platform.md)).
- Staged delivery: local engine and loopback interface first, desktop shell later, Tauri
  versus Electron decided by a prototype
  ([ADR-008](../../docs/adr/008-staged-delivery-engine-and-loopback-ui-first.md)).
- MIT, a team of one to three engineers, offline-capable, no mandatory hosted service, no
  mandatory AI, and every third-party licence verified individually.
- The first release provides process control and says plainly that execution is not
  sandboxed or isolated
  ([ADR-011](../../docs/adr/011-execution-safety-posture-no-isolation-in-the-first-release.md)).
- Feasibility proofs come before the broad documents; the blueprint is not built out until
  Milestone 1 is approved.

## MVP-0

Defined, with its exit criteria, in the [PRD](../../docs/local/prd.md): a read-only scan;
detection of projects, tools and reports with evidence; ingestion of JUnit XML, Playwright
JSON and lcov into one model; a dashboard whose every number has its source, freshness and
a visible indicator for missing data; and compatibility tests showing nothing is lost or
misread. The runner, toolbox, trends and AI are later.

## Documents

| Document                                                                         | Role                                               |
| -------------------------------------------------------------------------------- | -------------------------------------------------- |
| [Index and conventions](../../docs/local/README.md)                              | Claim classes, headers, the gate                   |
| [Feasibility results](../../docs/local/feasibility.md)                           | What the spikes showed and could not               |
| [Competitive landscape](../../docs/local/research/competitive-landscape.md)      | Verified facts, claims, differentiation hypotheses |
| [Source register](../../docs/local/research/sources.md)                          | Every external fact, dated                         |
| [Users and workflows](../../docs/local/users-and-workflows.md)                   | Personas, Phase 0 validation plan                  |
| [PRD](../../docs/local/prd.md)                                                   | Requirements with ids                              |
| [Data contracts](../../docs/local/data-contracts.md)                             | Model, vocabulary, reconciliation, storage         |
| [KPI dictionary](../../docs/local/kpi-dictionary.md)                             | Every metric                                       |
| [Discovery engine](../../docs/local/discovery-engine.md)                         | The read-only scanner                              |
| [Runner and threat model](../../docs/local/runner-and-threat-model.md)           | Runner design, threats                             |
| [Architecture](../../docs/local/architecture.md)                                 | Shape and decisions                                |
| [Toolbox and intelligence](../../docs/local/toolbox-and-intelligence.md)         | Later work and its preconditions                   |
| [UX specification](../../docs/local/ux-spec.md)                                  | Screens in every state                             |
| [Quality and observability](../../docs/local/quality-and-observability.md)       | Acceptance, targets, tests, logs                   |
| [Risks and adversarial review](../../docs/local/risks-and-adversarial-review.md) | Failure scenarios, evaluation, open decisions      |
| [Roadmap](../../docs/local/roadmap.md)                                           | Phases, definitions of done, Milestone 1           |

Decision records: ADR-007 to ADR-012, all `proposed`, indexed in
[`docs/adr/README.md`](../../docs/adr/README.md).

## What the feasibility work found

Details and limits are in the feasibility document; in one line each:

- A model with its own vocabulary can hold the three formats without losing or inventing an
  outcome. The server contract cannot express a zero-test run, an errored test or a test
  that never ran, so the model is separate and mapped one way (RISK-1, adjust).
- Duplicate, sharded and contradictory reports can be handled by small deterministic rules
  that never merge silently (RISK-2, go).
- Original evidence can be preserved byte-for-byte and ingestion made atomic and
  recoverable (RISK-3, go).
- Signalling only the child, as the existing runner does, leaves a shim-launched command
  running. A Windows job object ends everything, at the cost of a helper
  (RISK-4, adjust).
- The prototype reader is hardened against hostile XML; the real adapters' parser was not
  run (RISK-5, adjust).
- The SQLite module built into Node worked for everything tried; the other driver was not
  measured (RISK-6, adjust).

## Assumptions

Labelled in the documents where they are made.

- A1: the documents call the product AUTOMATE (local) and the existing one the server
  platform, to avoid confusion with the repository's branding; final naming is open.
- A2: Node 24 and TypeScript for the engine; no Rust core unless a spike shows a need.
- A3: the SQLite driver is undecided between the module built into Node and
  `better-sqlite3`.
- A4: the local interface is loopback only, with a per-launch token and header checks.
- A5: the local model is separate from the server contract, mapped one way, with a test that
  fails when the contract gains a status.
- A6: workflow claims about users are hypotheses until Phase 0.
- A7: where a vendor page could not be read, the claim is unverified and not filled in.

## Open questions

- The final name of the product.
- The SQLite driver, and the missing comparison.
- How a job object is created on Windows: shipped native helper, addon, or launcher script.
- Whether the real report adapters are reused or replaced.
- Whether the runner's termination and input-limit gaps should be recorded as findings-ledger
  rows. Proposed only: an open ledger row can fail the merge gate, so none was added.
- Grouping parameters and traversal limits, all unvalidated.
- Whether a desktop shell is justified at all.

## What could not be verified

- The workspace dependencies could not be installed where this was written, so the real
  report adapters, the real XML parser, `better-sqlite3`, and the repository's own lint, type
  check, coverage, duplication, complexity and secret-scan gates were not run on the new
  code. `pnpm docs:check` was not run as a whole; the documentation drift detectors and the
  new consistency gate were run directly under Node.
- `taskkill`, `tasklist` and WMI queries are blocked in that environment, so the
  `taskkill /T` approach is unmeasured.
- Only Windows was exercised.
- Several vendor pages (ReportPortal, JetBrains, Develocity, Apple) returned nothing
  readable; no claim rests on them.
- Prettier was run from another project's installation (version 2.8.8) because the
  workspace's own was not installed; the repository pins a newer major.

## Next step

Review. Milestone 1 (ten tasks, specified in the roadmap and ordered to retire the open
risks first) begins only after explicit approval.
