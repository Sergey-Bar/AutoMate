# Capability justification

`schema/dashboard.ts` defines **33** tables. **8** have a production reader or writer.
The other **25** have neither, and **21** of those have no access at all outside
schema-shape assertions.

This file is the alternative to building each table. Ledger row **C-6** requires
either a reader, a writer, a route, a UI and a test **or a written justification
here**, and this is the written justification for the 21.

**Why a file rather than a row per table.** A row is a defect awaiting a fix. These
are columns awaiting a decision, and a decision nobody wrote down is the state this
programme spent C-6 discovering. One row saying "21 tables are dormant" would be
closed by the same deletion that removes the tables; one file naming each table and
its reason means the next reader has to delete the line as well as the table.

**The count is 21, not ~35.** The remediation plan sized the wave at "`~35` tables";
the figure cannot be right, because there are only 33. Four of the 25 have test-only
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

## Dormant, with no access outside schema-shape assertions (21)

Every table below is a **Major debt, not a defect**, and none is a security or
correctness problem: nothing writes them, so nothing can read a wrong value out of
them. They are migration surface, schema documentation, and the residue of a design
whose product half was never built.

| Table                        | Why it exists                  | Why it is still here                                                         |
| ---------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| `workspaces`                 | tenancy boundary               | a placeholder; tenancy is enforced in code and on `runs`, not by this table  |
| `suites`                     | suite catalogue                | the dashboard reads runs and tests directly and never groups by suite        |
| `results`                    | raw per-suite results          | superseded by `canonical_run_results`                                        |
| `attachments`                | reporter evidence blobs        | the reporter never uploads; evidence is carried on the run row               |
| `trends`                     | time-series rollups            | no rollup job was ever written                                               |
| `known_failures`             | flaky-test memory              | no triage UI exists to write to it                                           |
| `defect_categories`          | classification                 | `failureTaxonomyRules` would consume it; that reader is not built            |
| `fingerprint_categories`     | classification                 | same                                                                         |
| `blob_shards`                | sharded blob storage           | superseded by `readAt` on the run row                                        |
| `nl_query_history`           | natural-language query history | the NL query feature is not built                                            |
| `failure_taxonomy_rules`     | classification rules           | needs `defect_categories` and the classifier                                 |
| `failure_classifications`    | per-test classifications       | same                                                                         |
| `test_failure_correlations`  | cross-test correlation         | the correlation job is not built                                             |
| `locator_suggestions`        | repair suggestions             | **no `updatedAt` column at all**, which is why it is listed separately below |
| `failure_clusters`           | clustering                     | needs the correlations                                                       |
| `users`                      | local accounts                 | the install is open; there is no login                                       |
| `roles`                      | authorisation                  | tenancy is `WORKSPACE_ID`, not roles                                         |
| `api_keys`                   | personal keys                  | superseded by the installation secret                                        |
| `agent_sessions`             | agent chat                     | the chat UI is not built                                                     |
| `agent_session_runs`         | agent chat                     | same                                                                         |
| `agent_session_files`        | agent chat                     | same                                                                         |
| `generated_test_suggestions` | agent proposals                | same                                                                         |
| `repair_attempts`            | self-healing                   | the repair loop is not built                                                 |
| `agent_conflicts`            | merge conflicts                | not built                                                                    |

### `locator_suggestions` has no `updatedAt`

Recorded separately because it is the one place this file's own rule would be
self-serving. A table with no `updatedAt` has no defined staleness, so any row in it
is permanently current by construction. It is listed here rather than left
unmentioned, and it is the one table on this list that should be dropped before it is
built rather than after.

## Four with test-only access

`saml_config`, `api_keys`, `generated_test_suggestions` and `workspaces` are read
only by tests. A test-only table is not dormant in the way the other 21 are — the
test is exercising a contract — but it is equally unreachable by a user, so the same
decision applies. They are justified by the same argument and are **not** counted
among the 21.

## What this does not claim

This file does not claim the tables are correct, current, or a good design. It claims
they are **inert**, and that the cost of leaving them is migration surface and reader
confusion rather than a wrong number on a screen. The tables are covered by
`schema-shape assertions`, so a change to one that breaks the contract fails a test —
which is the only reason twenty-one inert tables are safe to leave.

## Removal condition

Each table is deleted, or gains a production reader, in a migration that records the
decision here. When the last row above is gone this file is empty and is deleted with
it. The condition names what could happen: a reader being written.
