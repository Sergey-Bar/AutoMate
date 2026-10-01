# Changelog

> Historical release claims are not current product truth. Current capability status is `docs/migration/capability-register.md`.

## Unreleased

**The product has one name.** The project's earlier name has been removed from the
repository entirely — eight files across five kinds of record, and the distinctions
between them are why this is not one find-and-replace.

- The README no longer describes the repository as "a planned QA automation control
  plane" under another product's name. It describes what `2.0.0` shipped.
- The superseded draft PRD is **deleted**. It was exempted from the docs drift gate on
  the grounds that it was marked superseded in its own text; its own header said
  `Status: Draft`. A document that asserts a status its header denies is worth more
  than an unexempted one, so it went rather than got relabelled.
- `docs/migration/source-manifest.json`'s residue **paths** are relabelled; its git
  blob **hashes** are untouched. The hashes are the evidence that nothing was lost in
  the migration, and they survive a rename — renaming the hashes would have falsified
  the record.
- `RF-11` cited the deleted PRD, so it now cites one document and states the count it
  cites, so the count can be re-derived.
- `scripts/lib/product-name.test.mjs` makes the absence machine-checked, and also
  asserts that the drift gate does not exempt a document that no longer exists, that
  the README describes the shipped product, and that the manifest kept its hashes. A
  check that only grepped would pass on a repository that had deleted a forensic record
  to look clean.

## 2.0.0 — 2026-10-01

**Breaking: the install is open.** There is no login screen and no required API key.
A self-hosted, single-tenant product had an `AuthGuard` that redirected every
unauthenticated visit to a sign-in form, and an API key the API refused to serve
without — with nothing behind either. ADR-006 puts multi-tenant isolation out of
scope for v1.0.0 and `WORKSPACE_ID` is the only tenancy boundary the system has.

**The boundary is now the network.** Anything that can reach the API can read every
run, download every artifact and cancel runs. Bind the API to loopback, which is
already the default (`HOST=127.0.0.1`), and put a reverse proxy in front of it if it
must be reachable from anywhere else.

- Removed `AuthGuard`, `useAuth`, and the `/login` route. There is no second way back
  in and nothing to re-enable by accident.
- Removed the Logout button and the command palette's Sign Out action. A button that
  appeared to end a session on an install with no sessions would be worse than no
  button.
- `createAuthMiddleware` is no longer mounted. A credential that **is** presented is
  still accepted, so an existing script or CI job holding a stale key keeps working; a
  caller with none is served.
- `AUTOMATE_API_KEY` no longer fails a production start. `COOKIE_SECRET` still is
  required — sessions are still minted, and signing one with a published literal is a
  real defect even when nothing requires a session.
- **Still enforced, deliberately:** the reporter secret, the runner token, lease
  ownership, the tenancy filter on every workspace-scoped read, and the vault's AAD
  binding.

### The durable path, walked against a real database

Running the E2E lane against a real PostgreSQL rather than reading the code found
**seven** defects, six of them blockers. All seven are fixed and the lane went from
**2 of 19 passing to 19 of 19**.

- `pnpm db:migrate` failed on every invocation: `runMigrations` documented its
  parameter as defaulting to `DATABASE_URL` and did not implement the default, and the
  CLI entrypoint passes no argument.
- A clean database could not be bootstrapped — the migration journal was read before it
  was created, so `42P01`.
- The two files holding the E2E installation key disagreed, so **every** authenticated
  call in the suite answered 401.
- The required E2E job never applied the migration graph at all, and
  `pnpm install` does not build, so six jobs failed for want of a `dist`.
- The run listing served the **oldest** runs first, so a new run was on no page at all.
- A run written by the reporter had **no workspace**, so it was persisted and invisible
  to the dashboard.
- The reporter wrote `status` and never `phase`, so a finished run read as `queued` for
  ever.

### A failed test's reason is now recorded

Migration `0022` adds `error_code` and `error_message` to `tests`. All three write
paths — the reporter event, the reporter upload, and job completion — write them,
bounded to 8 KiB with the truncation recorded rather than silent. The reporter has
been sending `error: { code, message }` since the protocol began and the product
dropped it in all three, so a failed run recorded _that_ a test failed and not _why_.

### Gates that had never been observed green

Six `Unified CI` jobs were red through five consecutive commits, and none of them had
ever passed: four failures stacked on the scanner-install step alone, so `semgrep`,
the licence, duplication and complexity gates queued behind it had never run and
reported **1137 blocking findings** on their first execution. One rule was structurally
broken and is fixed; **543 remain across six rules, untriaged** (ledger `SEM-2`).

### Evidence

`pnpm status:10` reports the roadmap's twelve "definition of done" points as `pass`,
`fail` or `not_configured`. Eleven of the twelve are closed or honestly deferred; the
one outstanding is the named `durable-path.spec.ts` artefact, tracked as `E2E-3`.

Gates at this release: `lint`, `typecheck`, `format:check`, `complexity`,
`security:secrets`, `docs:check` and `findings:check` clean. `test:integration`
267/267, `@automate/api` 1159/1159, `@automate/unified-web` 242/242, `test:e2e` 19/19
against a real PostgreSQL.

## Unreleased — unified migration

- Added canonical shared contracts for reporting, realtime envelopes, orchestration, runner protocol, and installation sessions.
- Added reporting, producer-adapter, realtime, orchestration, automation-gateway, runner SDK, connector, artifact, vault, and migration-control boundaries.
- Added a forward PostgreSQL identity/outbox migration and coverage ratchet.
- Replaced the clean-checkout route boundary and centralized root governance commands.
- Removed obsolete readiness, roadmap, and migration documents from the active tree.

The migration remains local/sample-only. Production cutover, publication, credential rotation, source deletion, and destructive data migration are not authorized by this branch.
