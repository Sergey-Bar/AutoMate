# Database Migration Policy and Baseline

> **Retitled 2026-09-30.** This document was written as "ADR-003", and so was
> `003-universal-qa-vertical-slice.md` — two records claiming one number, which is
> the shape of a decision nobody made. The content here is still the policy; the
> number is not claimed any more. Decisions with numbers live in
> [`docs/adr/`](../adr/README.md): this one is
> [ADR-003](../adr/003-postgres-only-durable-queue.md) (one database, PostgreSQL,
> for state and the durable queue), and the related unification strategy was
> ADR-002, now superseded.

---

## Summary

This ADR defines the migration tooling policy for the Automate monorepo: all current SQLite databases (Dashboard, Automate) and the future PostgreSQL database (`@automate/db`, T9). It inventories every table in the current SQLite schemas, establishes the migration baseline strategy for Postgres, and documents the data import approach that preserves existing SQLite data.

---

## 1. Migration Policy

### 1.1 There is no schema-push script, and that is the rule

`drizzle-kit push` is **not** wired up as a script in this repository, and it must
not become one. The previous version of this section described a `db:push` script
that "MAY remain in `package.json` for developer convenience" — it was not there,
and the sentence was asking a reader to trust a state of the tree that did not
exist.

A schema push compares the Drizzle schema to a live database and applies the
difference with no versioned SQL and no history. That is fine for a scratch
database and wrong for every other case, because:

- no migration is recorded in git, so a deployed database cannot be reconstructed
  from the repository;
- there is nothing to roll back to;
- a column drop or a type change lands silently on whatever the table held;
- the database diverges from every other installation, and the divergence is
  invisible until it matters.

So the rule is stated as an absence rather than a prohibition: **there is no
push script.** A schema change goes through §1.2, and a contributor who finds
themselves wanting a push is describing a case the migration graph should cover.

### 1.2 Permitted production migration workflow

The **only** flow for schema changes:

```
1. Edit the Drizzle schema in packages/db/src/schema/
2. pnpm db:generate     → creates a versioned .sql migration in packages/db/drizzle/
3. Commit the .sql file in the same change as the schema edit
4. pnpm db:migrate      → applies un-applied migrations in journal order
```

`pnpm migrate:plan` reports what is pending without touching a database, and
`pnpm migrate:validate` checks the graph against the journal. `pnpm db:check` asserts
the journal and the schema have not parted company.

### 1.3 Migration on startup

The compose file runs migrations before the API starts, and takes an advisory lock
first: two instances applying the same journal concurrently is the failure the lock
prevents. See [ADR-003](../adr/003-postgres-only-durable-queue.md).

### 1.4 Enforcement

- **No push script exists**, and `gate-tooling.test.mjs` audits CI wiring, so adding
  one is a visible diff rather than a convenience.
- Every new Drizzle schema change requires its SQL migration committed in the same
  change. A schema edit with no migration fails `pnpm db:check`.
- A destructive statement is either guarded by a `RAISE EXCEPTION` row count or
  written down in `docs/quality/schema-migration-backlog.md` with its expand step.
  `pnpm status:10` reports §17's ninth point from exactly that check.

---

## 2. Schema Inventory

### 2.1 Automate — SQLite (`@automate/api`)

Source: `Automate/apps/server/src/db/schema.ts`
Migrations: `Automate/apps/server/drizzle/` (8 files)

| Table                        | Key Columns                                                                                                                                                                                         | Notes                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `runs`                       | `id` (PK UUID), `started_at`, `finished_at`, `status`, `total`, `passed`, `failed`, `flaky`, `skipped`, `duration_ms`, `branch`, `commit_sha`, `source`, `gate_status`, `workspace_id`, `pr_number` | Core run record; indexed by startedAt, status, workspaceId, branch, prNumber, commitSha |
| `suites`                     | `id` (PK), `run_id` (FK→runs, cascade), `parent_id`, `title`, `file`, `project`                                                                                                                     | Test suite hierarchy                                                                    |
| `tests`                      | `id` + `run_id` (composite PK), `suite_id` (FK→suites), `title`, `file`, `stable_id`, `status`, `duration_ms`, `retry_count`                                                                        | Individual test instances per run                                                       |
| `results`                    | `id` (PK), `test_id`, `run_id` (FK→runs, cascade), `retry`, `status`, `error_message`, `error_stack`, `fingerprint`, `steps`, `attachments`                                                         | Per-retry execution result; indexed by runId, testId, fingerprint                       |
| `attachments`                | `id` (PK), `result_id` (FK→results, cascade), `name`, `content_type`, `path`, `size_bytes`, `thumbnail_path`, `is_screenshot_diff`                                                                  | Binary artifacts on disk                                                                |
| `trends`                     | `date` + `project` + `branch` (composite PK), `total`, `passed`, `failed`, `flaky`, `avg_duration_ms`, `p95_duration_ms`                                                                            | Daily aggregates for analytics charts                                                   |
| `quarantine`                 | `id` (PK), `test_title`, `test_file`, `reason`, `quarantined_at`, `status` (pending/approved/rejected), `flakiness_category`, `resolved_at`                                                         | Quarantined flaky tests                                                                 |
| `known_failures`             | `id` (PK), `test_title`, `test_file`, `comment`, `created_at`                                                                                                                                       | Known-failure registry                                                                  |
| `schedules`                  | `id` (PK), `cron_expr`, `run_options`, `enabled`, `last_run_at`                                                                                                                                     | Cron-based scheduled runs                                                               |
| `workspaces`                 | `id` (PK), `name`, `config_path`, `test_results_dir`, `created_at`                                                                                                                                  | Multi-project workspace records                                                         |
| `quality_gate_config`        | `id` (PK default `'global'`), `workspace_id`, `pass_rate_threshold`, `max_duration_ms`, `max_flaky_count`, `max_quarantine_percent`, `updated_at`                                                   | Global + per-workspace quality gate thresholds                                          |
| `defect_categories`          | `id` (PK), `name` (unique), `color`, `created_at`                                                                                                                                                   | Named defect categories                                                                 |
| `fingerprint_categories`     | `fingerprint` (PK), `category_id` (FK→defect_categories, cascade), `assigned_at`                                                                                                                    | Maps error fingerprint to category                                                      |
| `blob_shards`                | `id` (PK), `run_id` (FK→runs, cascade), `shard_index`, `total_shards`, `file_path`, `uploaded_at`, `merged`                                                                                         | Partial blob shard upload tracking                                                      |
| `nl_query_history`           | `id` (PK autoincrement), `user_query`, `generated_sql`, `result_count`, `user_id`, `created_at`                                                                                                     | NL→SQL query history                                                                    |
| `failure_taxonomy_rules`     | `id` (PK), `priority`, `category`, `pattern`, `pattern_target`, `description`, `is_built_in`, `enabled`                                                                                             | Rule-based failure classifier config                                                    |
| `failure_classifications`    | `id` (PK), `fingerprint`, `run_id` (FK→runs, cascade), `category`, `confidence`, `matched_rule_id`, `rationale`, `is_manual_override`                                                               | Per-run failure classifications                                                         |
| `test_failure_correlations`  | `id` (PK), `test_stable_id`, `source_file_path`, `failure_count`, `total_occurrences`, `window_start_date`                                                                                          | Source-file ↔ test failure correlation window                                           |
| `locator_suggestions`        | `id` (PK), `test_id`, `run_id` (FK→runs, cascade), `original_selector`, `suggested_selector`, `confidence`, `rationale`, `status`                                                                   | Self-healing locator suggestions                                                        |
| `failure_clusters`           | `id` (PK), `fingerprint`, `cluster_label`, `occurrence_count`, `representative_error`, `category`, `status`                                                                                         | Cross-run error cluster groups                                                          |
| `users`                      | `id` (PK UUID), `email` (unique), `display_name`, `role` (admin/editor/viewer), `saml_subject`, `tenant_id`                                                                                         | User accounts                                                                           |
| `roles`                      | `id` (PK), `name` (unique), `description`, `permissions` (JSON), `tenant_id`                                                                                                                        | RBAC roles                                                                              |
| `api_keys`                   | `id` (PK), `name`, `key_hash` (unique SHA-256), `user_id` (FK→users, set-null), `role`, `scopes`, `expires_at`, `revoked_at`                                                                        | API access tokens (hashed)                                                              |
| `agent_sessions`             | `id` (PK), `provider`, `repository`, `pr_number`, `pr_branch`, `agent_name`, `matched_rule`, `status`                                                                                               | AI agent code-review sessions                                                           |
| `agent_session_runs`         | `session_id` + `run_id` (composite PK)                                                                                                                                                              | Links agent sessions to test runs                                                       |
| `agent_session_files`        | `id` (PK), `session_id` (FK→agent_sessions, cascade), `file_path`, `change_type`                                                                                                                    | Files modified in agent session                                                         |
| `generated_test_suggestions` | `id` (PK), `session_id`, `run_id`, `source_type`, `status`, `original_content`, `edited_content`, `model_provider`                                                                                  | AI-generated test code drafts                                                           |
| `repair_attempts`            | `id` (PK), `session_id` (FK→agent_sessions, cascade), `attempt_number`, `status`, `payload`, `comment_url`                                                                                          | Auto-repair attempt records                                                             |
| `agent_conflicts`            | `id` (PK), `repository`, `session_ids`, `overlapping_files`, `severity`, `status`                                                                                                                   | Concurrent agent conflict detection                                                     |
| `saml_config`                | `id` (PK), `entry_point`, `issuer`, `idp_cert`, `callback_url`, `default_role`                                                                                                                      | SAML SSO configuration                                                                  |
| `audit_events`               | `id` (PK UUID), `timestamp`, `actor_id`, `actor_type`, `action`, `resource_type`, `resource_id`, `ip`, `details`, `tenant_id`                                                                       | Immutable audit trail                                                                   |

**Total Dashboard tables: 31**

---

### 2.2 Automate — SQLite (`@automate/server`)

Source: `Automate/apps/server/src/db/schema.ts`
Migrations: `Automate/apps/server/drizzle/` (1 file)

| Table                 | Key Columns                                                                                                                                                     | Notes                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `conversations`       | `id` (PK), `title`, `flow_template_id`, `created_at`, `updated_at`                                                                                              | Chat conversation records       |
| `messages`            | `id` (PK), `conversation_id` (FK→conversations, cascade), `role` (user/assistant/system/tool), `content`, `tool_call_id`, `tool_name`, `metadata`, `created_at` | Individual chat messages        |
| `message_attachments` | `id` (PK), `message_id` (FK→messages, cascade), `name`, `content_type`, `path`, `size_bytes`                                                                    | File attachments on messages    |
| `connector_configs`   | `id` (PK), `connector_name` (unique), `enabled`, `credential_ref`, `settings`, `updated_at`                                                                     | Per-connector settings          |
| `flow_templates`      | `id` (PK), `name`, `description`, `system_prompt`, `steps`, `category`, `is_built_in`                                                                           | Workflow templates              |
| `execution_log`       | `id` (PK), `conversation_id` (FK→conversations), `tool_name`, `input`, `output`, `status`, `duration_ms`, `error_message`, `created_at`                         | Tool execution audit trail      |
| `model_config`        | `id` (PK default `'default'`), `provider`, `model`, `endpoint`, `temperature`, `max_tokens`, `system_prompt`, `updated_at`                                      | Active LLM configuration        |
| `trace_links`         | `id` (PK), `source_type`, `source_id`, `target_type`, `target_id`, `link_type`, `metadata`, `created_at`, `created_by`                                          | Cross-entity traceability links |

**Total Automate tables: 8**

---

### 2.3 Automate Vault — SQLite (separate DB file)

Source: `Automate/apps/server/src/vault/schema.ts`
Migration: raw `CREATE TABLE IF NOT EXISTS` executed via `better-sqlite3` exec (no Drizzle kit)

| Table           | Key Columns                                                                                                            | Notes                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `vault_entries` | `id` (PK), `connector_name` (unique), `ciphertext`, `iv`, `auth_tag`, `salt`, `iterations`, `created_at`, `updated_at` | AES-256-GCM encrypted connector credentials |

**Total Vault tables: 1**

> The vault DB is not managed by Drizzle Kit. Schema evolution must be done manually via `sqlite.exec()` in `vault/schema.ts`. When the vault migrates to Postgres (T9), it will be brought under Drizzle Kit's migration management.

---

## 3. PostgreSQL Migration Baseline (T9)

> **This section is forward-looking.** The actual `@automate/db` package is created in Task 9. This section defines the approach so T9 has a clear contract.

### 3.1 New package: `packages/db`

Task 9 will create `packages/db/` (package name `@automate/db`) containing:

```
packages/db/
  src/
    schema/
      dashboard.ts    # All 31 Dashboard tables, ported to pgTable
      automate.ts     # All 8 Automate tables, ported to pgTable
      vault.ts        # vault_entries, ported to pgTable
    index.ts          # re-exports
    client.ts         # Postgres connection (drizzle-orm/node-postgres)
    migrate.ts        # runDrizzleMigrations() using migrator
  drizzle/            # Generated SQL migration files (git-tracked)
  drizzle.config.ts
  package.json
```

### 3.2 Baseline generation

When `@automate/db` is created in T9:

1. All three SQLite schemas (Dashboard, Automate, Vault) will be transcribed to Drizzle `pgTable` definitions.
2. Run `pnpm db:generate` once to produce the **initial baseline migration** (`drizzle/0000_*.sql`). This is the single SQL file that creates every table from scratch on a fresh Postgres instance.
3. Commit `drizzle/0000_*.sql` to git — this is the auditable starting point.
4. All subsequent schema changes follow the standard flow: edit schema → `db:generate` → commit .sql → `db:migrate`.

### 3.3 Key type adaptations (SQLite → Postgres)

| SQLite type                                          | Postgres equivalent                                     |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `text('id').primaryKey()`                            | `uuid('id').primaryKey().defaultRandom()`               |
| `text('...')` for dates                              | `timestamp('...', { withTimezone: true })`              |
| `integer('...', { mode: 'boolean' })`                | `boolean('...')`                                        |
| `real('...')`                                        | `numeric('...', { precision: 10, scale: 4 })` or `real` |
| `text('...')` for JSON blobs                         | `jsonb('...')`                                          |
| `integer('...').primaryKey({ autoIncrement: true })` | `serial('...')` or `bigserial`                          |

---

## 4. Data Import Strategy

**Principle: SQLite data is never destroyed.** The import is a one-way copy; the original SQLite files remain intact as a backup.

### 4.1 Pre-import checklist

- [ ] All legacy services are stopped (no active writes to SQLite)
- [ ] SQLite files are backed up to a separate location (e.g., `backups/YYYYMMDD/`)
- [ ] Postgres schema is at baseline (migration `0000` applied, empty tables)
- [ ] Database credentials are set in `@automate/db`'s `.env`

### 4.2 Import approach

The import will be implemented as a one-off Node.js script in `packages/db/scripts/import-sqlite.ts` (created in T9 or a dedicated data-migration task):

```
1. Open each SQLite DB with better-sqlite3 (read-only)
2. Stream rows from each table in dependency order (no FK violations):
   - Parent tables first (e.g., runs before tests before results)
3. INSERT rows into Postgres using Drizzle's insert()
4. Verify row counts match
5. Report any skipped rows (due to constraint violations or type coercion)
```

**Never use `drizzle-kit push` for the import** — schema is applied via `pnpm db:migrate`, data is inserted via the script.

### 4.3 Zero-SQLite-destruction guarantee

- The legacy products' own data directories continue to point at the original SQLite files. This repository does not read them: the predecessor services' configuration is not part of this tree, and naming a variable here that no longer exists would be a claim nobody could check.
- Legacy services remain bootable against SQLite even after the Postgres import completes.
- SQLite is only decommissioned after the unified platform is in production and parity is verified (Task 12+).

---

## 5. Tooling Reference

| Command            | When to use                                                              |
| ------------------ | ------------------------------------------------------------------------ |
| `pnpm db:generate` | After editing `schema.ts` — generates a new versioned `.sql` file        |
| `pnpm db:migrate`  | Before/at startup in CI, staging, production — applies pending SQL files |
| `pnpm db:check`    | In CI — asserts the migration graph and the journal agree                |

`drizzle-kit push` is **not** a script in this repository and must not become one. It
compares the Drizzle schema to a live database and applies the difference with no
history and no rollback, so a pull request that used it would leave a schema nobody
could reconstruct. `drizzle-kit studio` is likewise not wired up; a local database
can be inspected with any PostgreSQL client.

### 5.1 CI enforcement

CI pipelines must:

1. Run `pnpm db:migrate` (not a schema push) before starting integration tests.
2. Run `pnpm db:check`, which fails if the journal and the schema have parted company.
3. Never run `pnpm migrate:apply`: CI has no persistent database, so applying a
   migration there proves nothing about the migration and only produces a schema
   nobody keeps. That is why the script is `never-in-ci` in
   `scripts/gate-tooling.json`.

---

## 6. Decision Record

| Question                                     | Decision                                                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Why ban `db:push` in production?             | It has no history, no rollback, and can silently drop data. `db:generate` + `db:migrate` gives a git-auditable, reversible change set.   |
| Why keep SQLite for legacy products?         | Zero-infrastructure, proven in production, no migration risk. Legacy products stay on SQLite until full parity is verified (T12+).       |
| Why a dedicated `@automate/db` package?      | Isolation: shared DB logic and schema live in one place, consumed by both the new unified server (T9) and any future services.           |
| Why Postgres for the unified platform?       | Multi-writer concurrency, richer query planner, JSONB operators, and production-grade HA — all needed at scale.                          |
| Why transcribe schemas (not dump + restore)? | SQLite and Postgres have different type systems. A clean Drizzle schema transcription produces idiomatic Postgres DDL with proper types. |
