# ADR-009: SQLite for metadata, a content-addressed directory for raw evidence

**Status:** proposed
**Date:** 2026-10-19
**Supersedes:** —

## Context

AUTOMATE (local) must work offline with nothing to install beyond itself: no database
server, no container runtime, no account. It stores two kinds of data. Raw report bytes
are the source of truth and must come back byte-identical. Derived data (runs, results,
coverage) is rebuildable from the raw bytes.

The server platform uses PostgreSQL ([ADR-003](./003-postgres-only-durable-queue.md)),
which fails the offline and zero-install requirements and is out of scope for the local
product ([ADR-007](./007-local-product-separate-from-server-platform.md)).

## Decision

Proposed:

1. **SQLite** holds metadata and derived tables, with write-ahead logging.
2. **A content-addressed directory** holds raw artifacts, named by the SHA-256 of their
   bytes. A row never contains the raw bytes.
3. **Ingestion is one transaction.** A run is visible only when all of its results are
   stored; a crash mid-ingest leaves nothing half-written.
4. **The schema version is stored in the database** and checked on open. Migrations are
   forward-only and copy the database file before changing it.
5. **Derived tables can be dropped and rebuilt** from raw artifacts when the parser version
   changes.

**The driver is not decided.** Two candidates: `better-sqlite3`, already vetted in this
repository (`tools/migrate-cli`) and already approved to build in `pnpm-workspace.yaml`;
and the SQLite module built into Node. The choice depends on install behaviour on Windows
without a compiler, durability behaviour, and the maturity of the built-in module. The
evidence is collected by the storage spike and recorded below when it exists.

## Consequences

- Backup is copying a directory.
- A tampered or truncated blob is detectable, because its name is its digest.
- Deleting a raw artifact must delete the runs derived from it, or leave them marked as
  derived from missing evidence. The product chooses the former and says so first.
- A native dependency, if `better-sqlite3` is chosen, adds a build or prebuilt-binary
  step to packaging on every platform.

## Evidence

- `pnpm-workspace.yaml` — `better-sqlite3` in the approved-builds map.
- `tools/migrate-cli/package.json` — the existing use of the driver.
- `docs/local/data-contracts.md` — the entities and the identity rules this store carries.
- [`docs/local/feasibility.md`](../local/feasibility.md) — RISK-3 and RISK-6: what the
  storage spike showed with the SQLite module built into Node (WAL, full synchronous mode,
  strict tables, atomic ingest, crash safety, tamper detection, rebuild from blobs, forward
  migration with a pre-migration copy), and what it did not (the `better-sqlite3` driver was
  not installed, so no comparison exists). This record stays `proposed` until a driver is
  chosen on evidence for both.

## Implementation note (2026-10-19)

The store in `local/` uses the SQLite module built into Node, with three forward migrations
and a pre-migration copy. The comparison with `better-sqlite3` (M1-4) was not made, so the
driver decision is still open. See [implementation-status.md](../local/implementation-status.md).
