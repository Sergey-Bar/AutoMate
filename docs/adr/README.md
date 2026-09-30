# Architecture Decision Records

Every architecture decision this repository has made, in one index, with the file
that carries each one in full.

**Why this directory exists.** The roadmap's E3 found the decision records to be
three prose documents with two of them claiming **ADR-003** and no ADR-001 at all,
which is the shape of a decision nobody made. A number two documents both claim is
not a number; a reader who follows it cannot tell which document they are reading,
and a decision that cannot be cited is a decision that gets made again.

**The numbering rule, and why it is a gate rather than a convention.** Numbers are
assigned here, once, and the index is the only place a number is claimed.
`scripts/lib/docs-drift.mjs` has an assertion for it: a document that references
`ADR-nnn` with no record here is a finding. That assertion is what stops the
collision recurring — not this paragraph, and not a reviewer's memory.

**Status vocabulary**, borrowed from the decision records this replaces:

| Status       | Meaning                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------- |
| `accepted`   | In force. The code and the record agree, and a change to either is a change to the decision. |
| `superseded` | Replaced by another record. The `Supersedes` column names it.                                |
| `proposed`   | Written down, not yet binding. The code may or may not agree; the record says which.         |
| `rejected`   | Considered and declined. Kept so the reasoning is not re-derived.                            |

## Index

| ADR                                                       | Decision                                                                 | Status   | Date       | Supersedes |
| --------------------------------------------------------- | ------------------------------------------------------------------------ | -------- | ---------- | ---------- |
| [ADR-001](./001-hono-modular-monolith.md)                 | Hono on Node, as a modular monolith in one pnpm workspace                | accepted | 2026-05-05 | —          |
| [ADR-002](./002-sse-over-a-durable-outbox.md)             | Realtime is SSE over a durable outbox feed, never WebSocket              | accepted | 2026-05-05 | —          |
| [ADR-003](./003-postgres-only-durable-queue.md)           | One database, PostgreSQL, for state and the durable queue                | accepted | 2026-05-05 | —          |
| [ADR-004](./004-native-reporting-not-allure.md)           | Reporting is native evidence and KPI policy, not Allure/Grafana/InfluxDB | accepted | 2026-09-26 | —          |
| [ADR-005](./005-path-versioning.md)                       | The API is versioned by path prefix, not by header                       | accepted | 2026-09-30 | —          |
| [ADR-006](./006-single-node-single-tenant-self-hosted.md) | Single node, single tenant, self-hosted, English only                    | accepted | 2026-09-26 | —          |

## Decisions with no record, and where they went

Three of the roadmap's named decisions predate this directory and are carried by
the documents that were written when they were taken. They are listed here rather
than silently renumbered, because the prose is the record and a rewritten document
is a document nobody diffs.

| Decision                            | Where it is written                                                                                          | Note                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The vertical slice's contract shape | [`docs/architecture/003-universal-qa-vertical-slice.md`](../architecture/003-universal-qa-vertical-slice.md) | Written as "ADR 003" before this directory existed. Retitled; the content is the record and the filename was not changed, because renaming a cited file breaks a link for no gain. |
| The migration tooling policy        | [`docs/architecture/db-migration.md`](../architecture/db-migration.md)                                       | Also written as "ADR 003", which is where the collision came from. Retitled.                                                                                                       |
| The unification strategy            | [`docs/architecture/unified-platform.md`](../architecture/unified-platform.md)                               | Written as "ADR 002" against the pre-merge layout and already marked superseded in its own text. Retitled.                                                                         |

## Adding a record

1. Take the next number from this index. Never reuse one, including from a
   superseded record.
2. Write `docs/adr/<nnn>-<slug>.md` with `Status`, `Date`, `Context`, `Decision`,
   `Consequences` and `Evidence`.
3. Add the row above. `pnpm docs:check` fails if a document references a number that
   has no row here, and `pnpm status:10` reports §17's tenth point from the same
   detector.
4. To retire one, set its status to `superseded`, add the superseding number to its
   `Supersedes` cell, and change the row — never delete the row. A deleted row is a
   decision that can be made twice.
