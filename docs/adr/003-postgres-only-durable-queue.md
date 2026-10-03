# ADR-003: One database, PostgreSQL, for state and the durable queue

**Status:** accepted
**Date:** 2026-05-05
**Supersedes:** —

## Context

The product needs durable state, a durable work queue, and an audit trail that a
customer can trust. Splitting those across SQLite, Redis and PostgreSQL would mean
three deployment surfaces on a product that installs as one compose file.

The predecessor repository ran two SQLite databases behind two services. Migrating
off them is the largest irreversible work in the programme, which is why the
migration has a rehearsal gate (ledger **RF-5**) rather than a best-effort script.

## Decision

**PostgreSQL 16 is the only store.** Durable state, the execution queue
(`execution_jobs` with leases and fencing tokens), the outbox, and the audit trail
all live in it.

- **Leases are rows, not locks.** `execution_jobs` carries `lease_owner`,
  `lease_expires_at` and a fencing token, so a worker that loses its lease is
  detectable rather than merely slow.
- **Migration applies are serialized** by a session-level advisory lock, because two
  instances racing the same journal is the failure Drizzle's own lock file does not
  prevent.
- **The in-memory store is a development convenience and says so.** An absent
  `DATABASE_URL` selects it, the selection is announced by component name at every
  call site, and `assertInMemoryAllowed` refuses it in production outright. A silent
  fallback is the defect; the fallback itself is fine.

## Consequences

- **No Redis, no Kafka, no Kubernetes.** Recorded as out of scope in the roadmap's
  §16, and this record is the reason.
- **A migration is additive-first.** A `DROP TABLE` must be guarded by a row-count
  refusal, or written down in `docs/quality/schema-migration-backlog.md` with its
  expand step. `pnpm status:10` reports §17's ninth point from exactly that check.
- **W7 landed before its rehearsal ran.** Five tenancy migrations are on disk —
  `0015`, `0017`, `0018`, `0019`, `0020` — and the `pnpm migrate:rehearse` run that
  decision **D1** put behind them has still never been performed on a real
  installation. A harness is not a run. This record does not claim the wave is out of
  scope; ledger **RF-5** carries it as an `open` Blocker and
  `docs/quality/wave-gates.json` makes the check that fires on it.
- The E2E suite throws without `DATABASE_URL` rather than falling back, because a
  suite that passes in memory reports success without PostgreSQL ever being
  involved.

## Evidence

- `packages/db/src/migrate.ts` — `pg_advisory_lock`, `MIGRATION_ADVISORY_LOCK_KEY`,
  and `isDirectInvocation` (the `process.argv[1] === import.meta.url` comparison is
  false on Windows and through a symlinked bin).
- `packages/db/src/schema/execution.ts` — the lease, fencing token and expiry.
- `apps/api/src/startup-policy.ts` — `assertInMemoryAllowed`, which refuses in
  production and announces every permitted fallback with its component name.
- `playwright.config.ts` — the `DATABASE_URL` guard, and `E2E_ALLOW_IN_MEMORY` as the
  deliberate opt-out.
- `pnpm migrate:validate`, `pnpm db:check`, and the PGlite integration suites under
  `tests/integration/`.
