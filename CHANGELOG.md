# Changelog

> Historical release claims are not current product truth. Current capability status is `docs/migration/capability-register.md`.

## Unreleased — v3.0 groundwork

### Changed

**`RF-5` returns to `open`/`Blocker`, because the wave it was gating has landed.** The
row was `debt`/`Major` on a scope decision that was never written down as one: the tenancy
wave, W7, was recorded out of scope, so a deferral of the migration rehearsal had nothing
to sequence. Seven W7 rows were confirmed and fixed and five tenancy migrations shipped —
`0015_schedule_workspace_scope.sql`, `0017_outbox_workspace_scope.sql`,
`0018_chat_workspace_scope.sql`, `0019_sp_private_key_sealed.sql`,
`0020_connector_credentials_tenant.sql`. **The scope changed by shipping, and nothing
noticed**, because `removalCondition` condition (b) was a sentence and
`.github/review-rules/merge-gate.json` sets `blockingStatuses: ["open"]`, which makes
`debt` invisible to the merge gate by design. So the row's own claim that _the gate
notices rather than the roadmap_ was false as configured. Condition (b) fired on
2026-10-02 and the row is back in the `Blocker` band.

**The sentence is now a gate.** `docs/quality/wave-gates.json` records which rows gate
which wave together with the migrations that put that wave on disk. `checkWaveBlocks` in
`scripts/lib/merge-gate.mjs` fails a _deferred_ wave gate outright, RF-5 itself is caught
as an open Blocker by `checkLedger` and as §17's eleventh point by `pnpm status:10`, and
`pnpm findings:check` fails when the manifest stops describing the repository. The block
lives with the merge-time rules rather than in `verify`, because a defect only a
`pnpm migrate:rehearse` run can clear must not be a required check.

**What this does not do:** it does not run the rehearsal. `pnpm migrate:rehearse` still
has never been performed against a real installation, and until it is, `pnpm findings:check`
and `pnpm status:10` both report the block. That is the state the row is in, stated rather
than deferred a second time.

### Added

**A ledger row for the OCI release gate repair, which had none.** `pnpm oci:verify` could
never pass — it required a `built` manifest status and a `sha256` digest that nothing in
this repository ever wrote, compared that digest against `RepoDigests` on images that are
never pushed, and read the declared isolation out of the JSON that declared it. Commit
`726dfa9` rewrote it to compare a build record written by `oci:build` in the run that
built, against the image the runtime actually holds. **A gate that can never pass teaches
reviewers to read red as noise, so the repair is exactly the class of defect that needs a
row** — RF-6's own words: _a gate with no row is a gate that can be skipped silently._

## 2.2.0 — 2026-10-02

A version bump, three ledger rows closed on a measurement rather than an assertion, four
action bumps, a release gate that had never run and could not have passed, and two defects
it found on its first execution.

Nothing was consolidated to get here. `main` was already at `v2.1.0` with a clean tree,
and the five unmerged branches are stale duplicates rather than unlanded work — see the
gap notes below.

### Fixed

**Three semgrep rows, closed on a scan rather than on a commit message.** `SEM-2`, `SEM-3`
and `SEM-4` were recorded `open` while their fixes were verifiably in the tree. The ledger's
own standard is a run, so the number was taken from CI before the ledger was edited:
`Static analysis passed: semgrep and gitleaks reported nothing.` — semgrep 1.178.0 against
`.semgrep.yml` on `1129d26`, in the `Security and license audit` job of
[run 36962862652](https://github.com/Sergey-Bar/AutoMate/actions/runs/36962862652).
**Zero findings.**

- `SEM-2` — the row's condition was zero blocking findings. It had 22 (16 from `SEM-3`, 6
  from `SEM-4`). It has none.
- `SEM-3` — the 16 `no-hardcoded-secret-literal` findings were all in test suites writing
  credentials as literals. All 16 now call the builders in
  `apps/api/src/test-support/synthetic-credentials.ts`, which is what AGENTS.md requires.
- `SEM-4` — the 6 `no-unbounded-list-in-query` findings now route through three guards that
  throw rather than truncate: `oneEventBatch` and `oneBatch` in
  `apps/api/src/execution/drizzle-execution-store.ts`, `oneBatchOf` in
  `apps/api/src/repositories/drizzle-run-repository.ts`. `.semgrep.yml` carries the
  narrowed discriminator, and `scripts/lib/semgrep-rules.test.mjs` proves each rule still
  fires on a hazard fixture and reports no safe twin.

`security:static` remains `pr-reporting`. Its graduation condition is now met on the
evidence rather than on a promise, but moving the tier is a separate recorded act with its
own test behind it, and this release does not make it.

**A test that passed or failed depending on how busy the machine was.** The release gate's
first-ever run failed on it, and that is the only reason it is written down. The launch
form's submit button renders a real `disabled` while a submission is in flight, and the
test clicked it a second time as soon as `createRun` had been _called_ — which is before
the rejection is handled and before the form re-enables. The click was dropped by the DOM,
so the assertion held only when the rejection happened to be processed before the next
poll. On a development host it does; under the gate's load it did not, and the `waitFor`
ceiling fired. The test now waits for the error alert, which is what "the first submission
finished" looks like from outside, and asserts the button is enabled before retrying — so a
form that surfaced the error and then left itself loading now fails rather than passing.
A probe held the rejection pending and read the button at the instant the old test clicked,
which reported `disabled: true` and one call on an idle host: the race was deterministic,
only its outcome was not.

### Changed

- **Four GitHub Actions bumps**, landed separately and each observed green before the next:
  `actions/checkout` 4.2.2 → 7.0.1 (#5), `actions/setup-node` 4.4.0 → 7.0.0 (#3),
  `actions/upload-artifact` 4.6.2 → 7.0.1 (#4), `pnpm/action-setup` → `fe02b34` (#2).
  The recorded red on those pull requests predates the 2.1.0 CI repairs and was not a
  verdict on the bumps. `actions/checkout` v6.1.0 carries a breaking change that blocks
  fork-pull-request checkout for `pull_request_target` and `workflow_run`; no workflow in
  this repository triggers on either, verified by reading the four merged files rather
  than by trusting the release note.
- **The changelog reattributed two of its own sections.** Both sections below were labelled
  `Unreleased` while describing work that had already shipped — the product rename inside
  `v2.1.0`, the unified migration inside `v2.0.0`. Each now carries the version it shipped
  in, and the bodies are untouched because they were accurate; only the headings were
  wrong. The `docs/migration/source-manifest.json` git blob hashes are deliberately
  unchanged, because renaming the evidence of the migration would falsify it.

### Fixed

**The OCI release gate could not pass, and a gate that can never pass is worse than no
gate.** `pnpm oci:verify` demanded two things that could not both be true. It required
`"buildStatus": "built"` and a `sha256:` digest in every runner manifest, and **nothing in
this repository ever wrote either** — `pnpm oci:build` ran `docker build` and discarded the
result — so the committed JSON carried a claim no build had made, and the only way to
satisfy the gate was to type the claim in by hand. And it required that digest to match the
image's `RepoDigests`, which only exists for an image pushed to a registry;
`docs/adr/006-single-node-single-tenant-self-hosted.md`'s distribution model builds on the
host that runs, so these images are never pushed and there was nothing to compare. It also
read the declared isolation out of the same JSON that declared it, which proves nothing
about the image that would run.

What replaced it asserts what is checkable, against the image the runtime actually holds:

- **A build record**, written by `pnpm oci:build` in the run that built, at
  `var/oci-build.json` — under `var/`, which is gitignored, because a record of what one
  host built is true of that host and not of the repository. The verifier compares it
  against the image it finds, so an image rebuilt, replaced or pulled between the two steps
  fails.
- **The built image's own configured user is not root**, read from the image rather than
  from a manifest that says so.
- **The manifest and the image are cross-checked**: the declared `user` must equal the uid
  the image runs as, and `network`/`readOnly` must declare complete isolation. Two
  independent sources, one of which is the built artefact.

**A registry digest is still compared whenever a manifest declares one**, so graduating
`runner.oci` from `mock` arms a stronger check rather than requiring the gate to be
rewritten. None does, because publishing these images is the thing that would arm it, and
the gate now says that in its own output instead of reporting an absent digest as a failure
of the images. **`runner.oci` remains `mock`**: the Dockerfiles are still no-op stubs, so
what is deployed is a build recipe and not a working runner. What changed is that the gate
now measures the thing that is real instead of asserting the thing that is not.

**The two OCI scripts had no test at all**, which is the whole reason a gate sat in
`verify:release` for the life of the repository without anyone noticing it could not pass.
The rules moved into `scripts/oci-checks.mjs` as a pure function, which is what makes them
executable without docker, and `scripts/lib/oci-images.test.mjs` covers the failing cases
as well as the passing one. Writing those tests found two bugs in the replacement before it
ever ran: the uid cross-check compared a number against Docker's `"65532:65532"` string and
would have failed every real build — the same never-passes condition it was written to
remove — and the root check passed `Config.User: "root"`, which runs as root.

### Verified: the release gate, for the first time

`.github/workflows/release-gate.yml` had **zero runs** on record, so neither of its two jobs
had ever executed as written. `pnpm verify:release` is `pnpm verify` plus `pnpm oci:verify`,
and `unified-ci.yml` is a decomposition of the same ground rather than the chain itself — a
release gate that has never been watched is not a gate. Dispatching it against this
release's own branch, before the merge, is also what makes the gate cover the tree the tag
points at rather than a tree built afterwards. **Both jobs are green.**

**The first run failed twice, and both were real.**

1. **A flaky test**, described under `Fixed` above. The same commit had passed it in
   `Unit and coverage` earlier the same hour, so the record on file said green and the tree
   said otherwise.
2. **A Dockerfile that could not build.** `runners/k6/Dockerfile` ran `chown` against a
   base image that is already non-root, so `grafana/k6:0.57.0` refused it and the build
   died at step four of four. The `playwright` stub built, because `node:24-alpine` is
   root — which is why one of three worked and the defect read as a base-image quirk rather
   than an assumption. `USER root` now precedes the `chown` in all three, so the privileged
   step is explicit and the final `USER 65532:65532` still makes the image unprivileged.

**`pnpm verify:local` was not a substitute** and was not used: it sets the host-scanner
opt-in, which makes the static scan exit zero **without scanning**. A green that means
nothing is the exact failure this repository's gate design exists to prevent.

### Still open, deliberately

Ten rows are `open` and seven are carried as `debt`, each with an owner and a removal
condition. **No Blocker and no Critical is open** — `C-5` and `DB-1`, the two Blockers, are
both `fixed`.

- `open` — `C-4`, `G-5b`, `RF-6`, `RF-6a`, `RF-6b`, `RF-6c`, `RF-6d`, `RF-9`, `RF-11`, `PERF-1`.
- `debt` — `C-6`, `CAP-1`, `D-4`, `Q-1`, `RF-5`, `UI-1`, `X-3`.

`G-5b` is new in this release and is the one thing found here and not fixed: a pull
request opened on a branch whose commit already had a completed `pull_request` run produced
no run at all, twice, and reopening it did not produce one either, while
`workflow_dispatch` on the same SHA minutes later gave all thirteen jobs. **The cause is
undiagnosed**, so the row records the observation and the uncertainty rather than a guess.
The practical exposure is a branch that cannot be merged rather than one that merges
unverified — the failure looks like a hang, which is the same shape as `G-2b`.

`RF-5`, `RF-9` and `PERF-1` cannot be closed from a development host at all. Their harnesses
are complete and the evidence is missing: `RF-5` needed one real run against a real
installation, and the tenancy wave was gated behind it — **though the gate did not hold
before this release shipped; see Unreleased below.** `RF-9` needs observed k6 numbers,
and `PERF-1` needs a rendering baseline recorded on the reference hardware — a self-hosted
single-node install, which a GitHub runner is not.

### Known gaps

**`runner.oci` is still `mock`, and this release did not graduate it.** The gate is green
about the things that are real — the three images build, the built images run as uid 65532,
and each one matches its manifest — and says plainly in its own output that the registry
digest was not compared because a locally built image has no `RepoDigests`. Publishing these
images is what would arm that comparison, and ADR-006's distribution model does not publish
them: they are built on the host that runs them. So the digest check stays written, tested and
waiting, and graduating the capability means the images become real rather than the gate
becoming weaker.

What it reported before, recorded because the fix is only meaningful against it — six
failures, all three images, every one a field nothing wrote:

```
OCI verification blocked
- playwright: buildStatus is "unbuilt", expected "built"
- playwright: imageDigest is not a built sha256 digest
- k6: buildStatus is "unbuilt", expected "built"
- k6: imageDigest is not a built sha256 digest
- zap: buildStatus is "unbuilt", expected "built"
- zap: imageDigest is not a built sha256 digest
```

What it reports now, having been run against a real container runtime:

```
Not checked, because it is not available:
- playwright: no registry digest compared — built locally and never pushed, so there are no RepoDigests to check. Publishing the image is what would arm that check.
- k6: no registry digest compared — …
- zap: no registry digest compared — …
OCI runner images verified against the container runtime
```

**No package is published to a registry, by decision rather than by omission.** All 24
workspace packages are `private`; `npm publish` hard-errors on a private package. There is
no publish script, no publish workflow, and the old `publish-docker.yml` is on the obsolete
list in `scripts/unify-preflight.mjs`. Distribution is the OCI image plus a self-hosted
compose install, per `docs/adr/006-single-node-single-tenant-self-hosted.md`. Publishing to
NPM is a distribution-model change and not a release step; it needs its own plan.

**The five unmerged branches were deliberately not merged.** `origin/wave0/ci-gates` (38
commits not in `main`), `docs/readme-refresh` (3), `master` (172),
`migration/phase-0` (257), and `rescue/unified-platform-shell` all descend from `97134f9`,
which `main` does not contain — so `git branch --merged main` reports every one of them
unmerged and five branches of lost work appear to exist. Their content is on `main` by
another route, because history was reset at `55528b3` and the work was re-landed:
`apps/api/src/observability/sentry.ts`, `packages/db/drizzle/0010_drop_duplicate_audit.sql`,
`packages/orchestration/src/phase-outcome.ts`, and the `useDashboard` test all appear in
`main` and not in those tips. Merging them would duplicate work; deleting them is a separate
decision that needs the `archive/*` tags verified to contain the tips first. Recorded here
so the next reader does not repeat the survey.

**`docs.yml` builds the documentation site and never deploys it.** It runs
`actions/upload-pages-artifact` with no `deploy-pages` step, and the job's permissions are
`contents: read` — no `pages: write`, no `id-token: write`, and no `environment:`. So the
site is built and uploaded as an artifact on every push to `main` and never goes live.
Logged, not fixed here: it needs the Pages source confirmed in repository settings first,
and that is a decision rather than an edit.

## 2.1.0 — 2026-10-01

Five defects, three of them found by **running** something rather than reading it, and one
found by the test written to prove a fix.

**A worker that could not write a terminal run state.** `PostgresExecutionStore.completeJob`
took `phase`, `outcome` and `status` from a hand-written table while `apps/api` held the
derivation that makes `runs_phase_outcome_check` unreachable. Its fallthrough produced
`{phase: 'requeue', outcome: 'requeue'}` — a non-terminal phase carrying an outcome, which
PostgreSQL refuses. It survived because `main.ts` passes no handler, so the path is dormant
in production. `deriveRunState` now lives in `@automate/orchestration` and both stores
derive from it.

**An API that accepted completions under an expired lease.** The store fenced on `leaseId`
and `fencingToken` but not `leaseExpiresAt`, and reaping is lazy — it runs inside
`claimJob`, not on a timer. Between a lease expiring and the next claim, the row still
advertised a valid lease with its original token.

**A dashboard query that carried one bind parameter per run in the database.** Both
dashboard endpoints called `listRuns()` unbounded and handed every run id to one `IN (...)`.
PostgreSQL's ceiling is 65 535 parameters, so it was a query that eventually stopped being
answerable. Now batched at 1 000, with a guard that throws if the chunking is ever removed.

**Six mechanisms in the semgrep rule set that read as exclusions and were not.** A positive
`pattern` where the comment said `pattern-not`; a `metavariable-regex` anchored on a quote
character semgrep does not bind for a template literal, so `no-shell-true` missed every
`execSync(`git checkout ${branch}`)` — the real injection vector — while firing on the
harmless literal form; three `pattern-not`s that reused the positive pattern's bindings and
could therefore never match; `paths` that left the worker and connectors unscanned; and one
rule that **could not be compiled at all**. Findings went from 543 across six rules to 22
across two, and `scripts/lib/semgrep-rules.test.mjs` now proves each rule still fires.

**The E2E suite could only be run once per database.** `claimJob` refuses a runner already
holding its slot count, and every e2e runner has one slot — so the drain loop consumed the
only slot with a claim it discarded and could never claim again. It now resets the durable
tables once per run, with a guard that refuses anything not obviously disposable.

Also: `status:10` point 3 had been claiming a durable-path spec existed since before this
release. It did not, and it does now — nine stages against real PostgreSQL, with its own
Playwright project. `main` gained branch protection with ten required checks. The coverage
ratchet, which had been failing on `main`, passes.

### 2.1.0 addendum — the product has one name

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

### 2.0.0 addendum — the migration

- Added canonical shared contracts for reporting, realtime envelopes, orchestration, runner protocol, and installation sessions.
- Added reporting, producer-adapter, realtime, orchestration, automation-gateway, runner SDK, connector, artifact, vault, and migration-control boundaries.
- Added a forward PostgreSQL identity/outbox migration and coverage ratchet.
- Replaced the clean-checkout route boundary and centralized root governance commands.
- Removed obsolete readiness, roadmap, and migration documents from the active tree.

The migration remains local/sample-only. Production cutover, publication, credential rotation, source deletion, and destructive data migration are not authorized by the unification branch that performed it.
