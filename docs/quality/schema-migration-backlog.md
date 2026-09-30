# Schema migration backlog

Every statement in `packages/db/drizzle/` that can lose data or rewrite a column,
with the expand step that made it safe and what happens on the way back.

**Why this file exists.** §12 of the roadmap sets expand/contract: a contract step is
_written down, not executed_, so a destructive change is never the next thing anybody
runs. That rule is only checkable if the write-down exists, and for two migrations it
did not. `scripts/lib/status-ten.mjs` reports §17's ninth point by reading this file —
every `DROP TABLE`, `DROP COLUMN` and `ALTER COLUMN … TYPE` in the graph must either
be guarded by a row-count refusal **in the migration itself** or appear below. A
migration can be added without it and nothing else in the toolchain notices.

**Reading the table.** "Guarded" means the migration refuses to proceed when the
table holds rows, rather than relying on the migration author having checked. An
unguarded drop is not a defect by itself — the table may have no writer anywhere in
the codebase — but it is a claim that has to be written down, because the next reader
cannot tell it from an oversight.

## Destructive statements in the graph

| Migration                                   | Statement                                                            | Guarded                                                                 | Why it was safe, and the expand step before it                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0004_orange_hellfire_club.sql`             | `ALTER TABLE artifacts ALTER COLUMN size_bytes SET DATA TYPE bigint` | no rewrite guard — a widening conversion                                | A widening `integer → bigint` cannot lose a value, and PostgreSQL rewrites the table without a rewrite lock. Recorded because it is a rewrite: a _narrowing_ change in this position would need the expand step below, and "this one happened to be widening" is not a property of the column.                                                                                                                                                    |
| `0010_drop_duplicate_audit.sql`             | `DROP TABLE system_audit_events`                                     | **no**                                                                  | The table was a strict duplicate of `audit_events` — same actor, action, resource, request id, details and instant — with four extra columns, and **neither table has a writer in application code**. It also declared its indexes as `audit_events_resource_idx` and `audit_events_retain_idx`, colliding with the real table's index names, so a reader of the schema could not tell which table an index belonged to. See the open item below. |
| `0013_drop_duplicate_runner_identities.sql` | `DROP TABLE runner_identities`                                       | **yes** — `RAISE EXCEPTION` when the table holds rows                   | A second copy of a table the control plane never reads. The guard is the model: the migration states the precondition in the database rather than in a comment, so a host whose table holds rows gets a refusal and a sentence to read rather than a silent loss.                                                                                                                                                                                 |
| `0019_sp_private_key_sealed.sql`            | `ALTER TABLE saml_config ALTER COLUMN sp_private_key TYPE jsonb`     | **yes** — a preceding statement rejects plaintext rows, then seals them | The column held a private key in plaintext, so the migration moves the value into the vault first and only then converts the column. This is the one place in the graph where the expand step and the contract step are in the same file, and the order is the whole safety property: **seal, then convert.**                                                                                                                                     |

## Open item: `0010` has no guard

`0010` drops a table with no row-count refusal, unlike `0013`, which is the same
shape of change and does guard. The justification is in the migration's own header and
is sound as far as it goes — nothing in the application writes either table — but
"as far as it goes" is the part worth naming:

- **The guard cannot be added retroactively.** `0010` has shipped, so an installation
  that applied it will not run it again, and editing the file changes the behaviour of
  an installation that has _not_ applied it. Adding a refusal there would block a
  host whose `system_audit_events` holds rows written outside this codebase — which
  is a behaviour change disguised as a safety fix.
- **The property is enforceable forward instead.** A new destructive migration is
  required to guard, by this file and by §12. `0010` is the last one written before
  that rule, and it is recorded here so the gap is a decision rather than an oversight.
- **The check that would catch a repeat is the point-9 probe.** It reports any
  destructive statement that is neither guarded nor listed, so a fourth unrecorded
  drop fails `pnpm status:10` rather than waiting to be noticed in review.

**Removal condition:** this entry clears when a rehearsal run
(`pnpm migrate:rehearse`, ledger **RF-5**) has applied the graph to a restored copy of
a real installation and re-opened every sealed row, which is the first point at which
anyone can say what the table actually contained on a real host.
