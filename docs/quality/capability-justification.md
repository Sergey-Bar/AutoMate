# Capability justification

`schema/dashboard.ts` defines **30** tables. **8** have a production reader or writer.
The other **22** have neither, and **19** of those have no access at all outside
schema-shape assertions. It defined 33 and 25 and 21 until `0030_drop_superseded_tables`
(ledger MNT-60) dropped the three that were superseded; see _Dropped_ below.

This file is the alternative to building each table. Ledger row **C-6** requires
either a reader, a writer, a route, a UI and a test **or a written justification
here**, and this is the written justification for the 19.

**Why a file rather than a row per table.** A row is a defect awaiting a fix. These
are columns awaiting a decision, and a decision nobody wrote down is the state this
programme spent C-6 discovering. One row saying "19 tables are dormant" would be
closed by the same deletion that removes the tables; one file naming each table and
its reason means the next reader has to delete the line as well as the table.

**The count is 19, not ~35.** The remediation plan sized the wave at "`~35` tables";
the figure cannot be right, because there were only 33. Three of the 22 have test-only
access, so they are not the same claim. The wave should be re-tallied before it is
scheduled, since the count is what makes it look like one wave at all.

## Read and written (8) — not candidates

| Table                   | Access                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `runs`                  | read and written; the spine of the product                                                           |
| `tests`                 | read and written by the reporter pipeline                                                            |
| `canonical_run_results` | read by run detail                                                                                   |
| `quarantine`            | read and written; a named product surface                                                            |
| `runners`               | read and written                                                                                     |
| `schedules`             | one reader, two writers — in `apps/worker/src/postgres-store.ts` as **raw SQL**, not through Drizzle |
| `audit_events`          | **four writers, zero readers**                                                                       |
| `quality_gate_config`   | read and written                                                                                     |

Two corrections that a grep would have got wrong, and both are why this file exists
rather than a tally:

- **`schedules` is not dormant.** A sweep searching `.from(`/`.insert(` misses raw SQL.
- **`audit_events` is not dormant either.** It is write-only. A justification saying
  "no reader" is true; one saying "no writer" is false, and
  `modules/dashboard/audit-sink.ts` already records the _no-writer_ state as a fixed
  defect. It is not a C-6 candidate.

## Dormant, with no access outside schema-shape assertions (19)

Every table below is a **Major debt, not a defect**, and none is a security or
correctness problem: nothing writes them, so nothing can read a wrong value out of
them. They are migration surface, schema documentation, and the residue of a design
whose product half was never built.

| Table                        | Why it exists                  | Why it is still here                                                                                        |
| ---------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `workspaces`                 | tenancy boundary               | every `workspace_id` has a `restrict` key onto it since 0028 (MNT-17); `ensureWorkspace` is its only writer |
| `suites`                     | suite catalogue                | the dashboard reads runs and tests directly and never groups by suite                                       |
| `attachments`                | reporter evidence blobs        | the reporter never uploads; evidence is carried on the run row                                              |
| `trends`                     | time-series rollups            | no rollup job was ever written                                                                              |
| `known_failures`             | flaky-test memory              | no triage UI exists to write to it                                                                          |
| `defect_categories`          | classification                 | `failureTaxonomyRules` would consume it; that reader is not built                                           |
| `fingerprint_categories`     | classification                 | same                                                                                                        |
| `nl_query_history`           | natural-language query history | the NL query feature is not built                                                                           |
| `failure_taxonomy_rules`     | classification rules           | needs `defect_categories` and the classifier                                                                |
| `failure_classifications`    | per-test classifications       | same                                                                                                        |
| `test_failure_correlations`  | cross-test correlation         | the correlation job is not built                                                                            |
| `locator_suggestions`        | repair suggestions             | no reader or writer yet; its missing `updatedAt` was added in `0026` (below)                                |
| `failure_clusters`           | clustering                     | needs the correlations                                                                                      |
| `users`                      | local accounts                 | the install is open; there is no login                                                                      |
| `roles`                      | authorisation                  | tenancy is `WORKSPACE_ID`, not roles                                                                        |
| `agent_sessions`             | agent chat                     | the chat UI is not built                                                                                    |
| `agent_session_runs`         | agent chat                     | same                                                                                                        |
| `agent_session_files`        | agent chat                     | same                                                                                                        |
| `generated_test_suggestions` | agent proposals                | same                                                                                                        |
| `repair_attempts`            | self-healing                   | the repair loop is not built                                                                                |
| `agent_conflicts`            | merge conflicts                | not built                                                                                                   |

### `locator_suggestions` now records when it changed

It was recorded separately because it was the one table with a mutable `status` and
no `updatedAt`, so any row in it was permanently current by construction.
`0026_locator_suggestions_updated_at.sql` adds `updated_at` (`NOT NULL`, defaulting to
the write time), and `schema.test.ts` pins it. The table is still dormant and stays on
the list above for the same reason as the others.

## Three with test-only access

`saml_config`, `generated_test_suggestions` and `workspaces` are read
only by tests. A test-only table is not dormant in the way the other 19 are — the
test is exercising a contract — but it is equally unreachable by a user, so the same
decision applies. They are justified by the same argument and are **not** counted
among the 21.

## Dropped

`0030_drop_superseded_tables.sql` (ledger MNT-60) removed the three tables this file
called superseded, after a search of `apps/`, `packages/`, `tools/`, `tests/` and
`scripts/` found no reader or writer outside schema-shape assertions, the migration
graph and the legacy importer's own mappings:

| Table         | Replaced by             | What else named it                                                                    |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `results`     | `canonical_run_results` | FKs from `attachments.result_id` and `artifacts.result_id`; the `migrate-cli` mapping |
| `blob_shards` | `runs.read_at`          | the `migrate-cli` mapping                                                             |
| `api_keys`    | the installation key    | the `migrate-cli` mapping; two constraints that 0006 and 0009 added and a test pinned |

The migration refuses to drop a table that holds rows unless
`automate.allow_drop_nonempty` is `on`. The two foreign keys are dropped and the
columns kept, so `attachments.result_id` and `artifacts.result_id` are now unkeyed
legacy pointers. `migrate-cli` no longer imports the three tables and reports a
populated one as skipped.

## What this does not claim

This file does not claim the tables are correct, current, or a good design. It claims
they are **inert**, and that the cost of leaving them is migration surface and reader
confusion rather than a wrong number on a screen. The tables are covered by
`schema-shape assertions`, so a change to one that breaks the contract fails a test —
which is the only reason nineteen inert tables are safe to leave.

## Removal condition

Each table is deleted, or gains a production reader, in a migration that records the
decision here. When the last row above is gone this file is empty and is deleted with
it. The condition names what could happen: a reader being written.
