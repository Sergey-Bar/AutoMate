# Release-cycle runbook for Automate

## Why this is not a generic guide

The request was a project-agnostic release guide (sync → verify → SemVer → npm publish). Three
things in this repository contradict the generic shape. The plan resolves each one and then
writes the procedure down where the next person will find it.

| Generic step | What this repo actually does | Evidence |
| --- | --- | --- |
| publish to npm | **Nothing is published to npm.** All 25 manifests — root `automate@2.1.0` and every `@automate/*` — are `"private": true`, and there is no `publishConfig`, no `files`, no changesets. `npm publish` is refused; the distribution channels are an annotated git tag, a GitHub release, and the compose stack. | `package.json:3-4`, `packages/shared-contracts/package.json:4`, `packages/runner-sdk/package.json:4` |
| merge every branch into main | `main` has **no merge base** with `master`, `migration/phase-0`, `rescue/unified-platform-shell`, or `docs/readme-refresh`. `main`'s history was force-reset; those branches are the legacy product line (150-200 commits each) that `main` deliberately deleted, including the removed `Automate-Dashboard` tree. `git diff main...<branch>` fails with `fatal: no merge base`. | `git log main..migration/phase-0`, `git diff --stat main...docs/readme-refresh` → `no merge base`; `chore: reset main history to unified tree` on `docs/readme-refresh` |
| merge the open PRs | All four open PRs are Dependabot action bumps dated 2026-09-27 — predating both shipped releases — and they are **red**: 7 checks fail (Unit and coverage, Product E2E, Security and license audit, Contract tests, API vertical slice, Local integration gates, Migration report). PR #2 bumps `pnpm/action-setup`, which is pinned to the exact `PNPM_VERSION` the whole workspace requires. | `gh pr list`, `gh pr checks 3`, `gh pr checks 2` |

## Decisions taken

- **D1 — Publish channel is tag + GitHub release; npm is explicitly out of scope.** The runbook
  states *why* (`private: true` everywhere) and names the one dangerous command that must never
  appear in it: `pnpm publish --no-private` publishes a package that was marked private, which
  would expose the entire monorepo. `pnpm publish` / `pnpm version` may be named in prose —
  `PNPM_BUILTINS` in `scripts/lib/docs-drift.mjs:110-142` whitelists both, so the commands
  detector will not flag the explanation.
- **D2 — Synchronization means triage, not merge-all.** `main` moves only by PR. Each open PR is
  rebased, fixed, re-run, then merged or closed as stale. Red checks are never merged. The
  unrelated-history branches are archived behind a tag (the repo already has
  `archive/legacy-local-2026-09-25` and `archive/unified-local-2026-09-25` as precedent) and
  never merged; content is ported by PR only when a specific change is still wanted.
- **D3 — Deliverable is `docs/operations/release-runbook.md` plus one pointer line in
  `AGENTS.md`.** No new script, no new `pnpm` script, no new gate row. `pnpm docs:check` already
  holds a `docs/` document to the tree: every relative link must resolve, every `pnpm …` command
  must be a root script, every port and env var must exist in code, every named transport must
  exist, and no capability may be claimed unless its register row is `real`
  (`scripts/lib/docs-drift.mjs:174-212`).

## Task list for the implementing agent

All paths relative to the repository root. Phase order is strict; each phase has a stop condition
and phases 1 and 2 may send the release back to phase 0.

### Phase 0 — Freeze and inventory (no mutation)

1. Confirm a clean tree: `git status` empty; a dirty tree means the release includes unreviewed work.
2. Record the baseline: `git describe --tags --always`, `git log --oneline v2.1.0..HEAD`, `gh pr list`, `gh release list`.
3. Read the pending `## Unreleased` section of `CHANGELOG.md:47` — it is the release's content
   inventory, and it is currently non-empty (the repository-wide product rename).
4. Read the open ledger rows in `docs/quality/findings-ledger.json` for anything marked
   Blocker/Critical, and `pnpm findings:check`. A release does not close rows; it refuses to
   ship with an open Blocker.
5. Record which evidence is **unmeasured** so the release notes do not claim it: RF-5
   (migration rehearsal), RF-9 (k6 thresholds), PERF-1 (rendering budget) per `AGENTS.md`.

### Phase 1 — Synchronize

6. `git checkout main && git pull --ff-only origin main`. If that is not a fast-forward, stop:
   `main` was rewritten and the release does not start from an ambiguous base.
7. For **each** open PR, in its own loop: `gh pr view <n> --json mergeable,mergeStateStatus`,
   `gh pr checks <n>`. Then:
   - rebase the branch onto current `main` (`git fetch origin` then rebase in a worktree);
   - fix the red checks at their cause; for the action bumps this means re-pinning every workflow
     to the new SHA and re-running `pnpm test` locally, because `scripts/lib/gate-tooling.test.mjs`
     fails when a workflow runs a tool-dependent script without installing the tool, and fails
     when a workflow's install list and the script's `requires` disagree;
   - merge only when `gh pr checks <n>` shows **no `fail`**. A `skipping` check is acceptable only
     if the same check skipped on `main`'s last green run — otherwise the gate measured nothing.
   - If the branch cannot be made green in this cycle, close it as stale and say so in the notes.
     Do **not** merge a red PR to "get it into the release".
8. For the four unrelated-history branches, **do not merge**. For each:
   - `git branch --list`, then `git log --oneline main..<branch>` and `git diff --stat main...<branch>`
     (the latter fails with `no merge base` — that failure *is* the finding, and it is why the
     branch cannot be merged);
   - `git tag -a archive/<name>-<YYYY-MM-DD> <branch> -m "archived before <next version>: <reason>"`
     and push the tag, so the branch can be deleted locally without losing it;
   - if a specific change is genuinely wanted, port it by hand as a fresh PR off `main` and let
     the full gate judge it. Never `--allow-unrelated-histories`.
9. Confirm `main` is green: `gh pr list` empty, `gh run list` shows the post-merge `unified-ci.yml`
   run green. `main` carries branch protection with ten required checks; the observed job set is
   Quality gates, Unit and coverage, Coverage ratchet, Contract tests, Runner protocol,
   Universal QA vertical slice, API vertical slice, Product E2E, Local integration gates,
   Migration report, Security and license audit, Commit message.

### Phase 2 — Verify (the gate)

10. `pnpm install --frozen-lockfile` — a lockfile that had to be updated is an unreviewed change.
11. `pnpm verify` (18 chained steps, `package.json:51`: preflight, review rules, format, lint,
    typecheck, unit, contract, integration, runner, coverage ratchet, build, db check, docs,
    dead exports, security verify). This is the tier-`pr-blocking` gate; it must be green.
    On a host with no `semgrep`/`gitleaks`, `pnpm verify:local` is the sanctioned substitute and
    records the scanners as `not_configured` — say so in the release notes rather than implying
    a scan ran.
12. `pnpm oci:build` **then** `pnpm verify:release`. Order matters: `verify:release` is
    `pnpm verify && pnpm oci:verify`, and `oci:verify` inspects images that must already exist.
    `scripts/oci-build.mjs:14,25` builds only the three runner images (`playwright`, `k6`, `zap`)
    as `automate/<name>:local`; nothing is pushed to a registry, so there is no image to roll back
    to and no digest to record from a push.
13. Independently, dispatch `.github/workflows/release-gate.yml` (it is `workflow_dispatch` only,
    `release-gate.yml:3-4`) and require both jobs — `verify` and `oci` — green. This is the run that
    proves the gate on a clean runner with the scanners installed.
14. Do not skip step 13 because step 11 passed locally: `pnpm verify` runs
    `pnpm security:secrets:history`, which walks every commit, so a local shallow clone is not the
    same measurement.

### Phase 3 — Smoke (manual, against the real stack)

15. `pnpm compose:config` to prove the compose file resolves before anything starts.
16. Bring the stack up exactly as `docs/deployment.md` describes
    (`docker compose -f docker-compose.unified.yml build`, then `up -d`, then `ps`) and wait for the
    health-gated ordering: PostgreSQL, the `migrate` job, then api/worker/runner/web.
17. Probe readiness through the API's own contract: `/health` (liveness) and `/api/v1/ready`
    (readiness, which must fail when PostgreSQL is unavailable). The two are different assertions
    and only the second one proves anything.
18. **Port trap — read this before running the smoke script.** `pnpm smoke:local` defaults to
    `localhost:3000` and `localhost:5173` (`scripts/local-smoke.mjs:8-9`), which are the *dev
    server* ports, not the compose stack's `127.0.0.1:53000` and `127.0.0.1:53173`
    (`docker-compose.unified.yml:93,100,206`, PostgreSQL on `55432`). Run the default against a
    compose stack and it fails for a reason that has nothing to do with the release. Use
    `pnpm smoke:local:json` for the dev servers, and the direct invocation for the stack:
    `node scripts/local-smoke.mjs --api-url=http://127.0.0.1:53000 --web-url=http://127.0.0.1:53173 --json`.
19. `DATABASE_URL=postgres://… pnpm test:e2e:vertical` against the same stack. `DATABASE_URL` is
    required: `playwright.config.ts` throws without it, because the API otherwise falls back to the
    in-memory store and the suite reports success without PostgreSQL ever being involved. Never set
    `E2E_ALLOW_IN_MEMORY=1` for a release.
20. Walk the four primary web routes by hand and confirm the product answers, not just that the
    server returns 200. Record what was observed, in the release notes, in the past tense.

### Phase 4 — Version (SemVer)

21. Classify the merged range `v2.1.0..main` by its conventional-commit types
    (`chore(release): 2.1.0 — …` is the established title shape, see `git log`):
    - any `feat:` → **minor**;
    - any commit or PR marked breaking, or a removal/rename a consumer depends on → **major**;
    - only `fix:`/`chore:`/`docs:`/`refactor:`/`test:`/`ci:` → **patch**.
22. Worked example for the content currently pending: the `## Unreleased` section is a
    repository-wide product rename plus a new test (`scripts/lib/product-name.test.mjs`) and no
    behaviour change, so it classifies as **patch (2.1.1)**. A rename is not a major event here
    precisely because there are no external consumers — every manifest is private. If phase 1
    merged a `feat:`, it becomes **minor (2.2.0)** instead. State the chosen bump and the commits
    that forced it.
23. The version lives in exactly one place: `package.json:3` (`rg '2\.1\.0'` matches no other
    tracked file outside `CHANGELOG.md`, `docs/`, and the lockfile). Bump it there, by hand — not
    with `pnpm version`, which would rewrite the workspace manifests whose versions are
    independently meaningful at `1.0.0`.
24. Rewrite `## Unreleased` in `CHANGELOG.md` as `## <version> — <YYYY-MM-DD>`, keeping the
    existing voice: one paragraph per defect, what it was, why it survived, what now holds it in
    place.
25. Leave an empty `## Unreleased` heading above the new section for the next cycle. Do not carry
    consumed text into it.
26. Ship steps 23-25 as **one PR into `main`** titled `chore(release): <version> — <what shipped>`,
    matching `8e9f637`. A release is a reviewable commit, not a local commit plus a tag.

### Phase 5 — Tag and release

27. Merge the release PR and require its checks green. The tag goes on the **merge commit** of that
    PR — nothing else is a valid release point.
28. `git tag -a v<version> -m "v<version> — <title>"` (annotated: `git cat-file -t v2.1.0` returns
    `tag`, not `commit`) and `git push origin v<version>`. Push the tag **before** creating the
    release, so the release's target always exists.
29. `gh release create v<version> --title "<version> — <title>" --notes-file <file>`, where the
    notes are the CHANGELOG section plus: the gate commands that ran and their results, the
    evidence that is still unmeasured (RF-5, RF-9, PERF-1), and any PR closed as stale in phase 1.
    Match the shape of the two existing releases (`gh release list`: `2.1.0 — five defects, three
    found by running things`, `2.0.0 — the install is open`).
30. The human performs every step in phases 4-6. `.github/agents/release-manager.agent.md:13`
   forbids an agent from pushing, tagging, or publishing: the agent prepares, the human publishes.
31. **npm publication is not a step, and never becomes one by accident.** Record the reason
    (`private: true` in every manifest) in the runbook so the omission reads as a decision. If npm
    distribution is ever wanted, it is a change — per-package `private: false`, `files`,
    `publishConfig`, build-order, and an OIDC trusted-publishing workflow — not a flag on this
    runbook. `pnpm publish --no-private` is the command that would do it by accident; it must not
    appear as an instruction anywhere.

### Phase 6 — Deploy

32. Deploy from the tag, not from a branch: `git checkout v<version>` on the target host, then the
    `docs/deployment.md` sequence.
33. If the release carries migrations, run `pnpm migrate:plan` and `pnpm migrate:validate` first,
    then `pnpm migrate:apply` on the target. `migrate:apply` is tier `never-in-ci` by design — CI
    has no persistent database, so applying there proves nothing about the migration. Take a dump
    first; `pnpm migrate:rehearse` is the harness for that and is still unmeasured (RF-5), so say
    in the notes that the rehearsal has no recorded run.
34. Bring the stack up through the health-gated ordering and re-run the phase 3 probes against the
    deployed stack.

### Phase 7 — Rollback

35. Rollback is non-destructive (`docs/deployment.md:30-32`): redeploy the previous tag
    (`v2.1.0`), stop the worker and runner, route the web app back to the prior dashboard, and leave
    additive tables and artifact evidence in place. Do **not** run `down -v` on a target whose
    evidence is still needed.
36. Migrations are additive, so a code rollback does not require a schema rollback. If a release
    did ship a destructive migration, that is a finding against the migration policy, and the
    rollback path has to be written before the release, not during the incident.
37. There is no image to roll back to: `pnpm oci:build` tags `automate/<name>:local` and pushes
    nothing. The tag is the only rollback point, which is why step 28 pushes it before the release
    exists.

### Phase 8 — Post-release

38. `pnpm status:10` and `pnpm site:generate` if any of the ten points or a generated page changed;
    commit the regenerated page. `docs:check` fails on a stale generated page.
39. Update `docs/quality/findings-ledger.json` only for rows this release actually fixed, with
    `status: fixed`, `confirmed: true`, and an evidence path that exists — a `fixed` row whose
    evidence path is gone fails `pnpm findings:check`. Never move a row backwards.
40. Close the loop: any PR closed as stale in phase 1 is either re-opened for the next cycle or
    linked from the next release's notes, so "stale" does not become "abandoned".

## Writing constraints for the runbook document

- Only `pnpm` commands that exist in the root `package.json` may appear as instructions
  (`verify`, `verify:local`, `verify:release`, `oci:build`, `oci:verify`, `compose:config`,
  `smoke:local`, `smoke:local:json`, `test:e2e:vertical`, `migrate:plan`, `migrate:validate`,
  `migrate:apply`, `migrate:rehearse`, `findings:check`, `status:10`, `site:generate`, `docs:check`,
  `docs:capability-register`, plus `pnpm install`). Everything else is either a `git`/`gh`/`docker`/
  `node` command or it does not go in the document.
- Reuse only ports and env var names that already appear in `docs/deployment.md` and
  `scripts/local-smoke.mjs` — the `ports` and `env-vars` detectors derive truth from
  `packages/config`, the E2E `webPort`, and every `process.env` read.
- Do not name a transport. The product's realtime boundary is SSE, and the `transports` detector
  exists because a runbook once described a WebSocket the product does not have.
- Every relative link must resolve; prefer linking `AGENTS.md`, `docs/deployment.md`,
  `CHANGELOG.md`, and `docs/quality/findings-ledger.json` over restating their contents.
- The one-line pointer added to `AGENTS.md` goes in the "Build / Lint / Test Commands" area next to
  `pnpm verify:release`.

## Validation for the implementing agent

1. `pnpm docs:check` — the new document must survive all seven detectors.
2. `pnpm format:check` — the new Markdown is in the Prettier glob.
3. `pnpm verify` — full gate, from a clean `pnpm install --frozen-lockfile`.
4. `pnpm oci:build` then `pnpm verify:release` — the release-tier gates.
5. Manual: walk phases 0-3 of the runbook against the real repository and confirm every command
   exists and every stop condition fires. A runbook that has never been followed is a document, not
   a procedure.

## Risks and failure modes

- **Phase 1 reopens the release.** Merging a PR invalidates the phase 2 gate that preceded it. The
  runbook's ordering exists so this is caught by a gate rather than by production.
- **A `skipping` required check reads as a pass.** Covered in step 7; the remedy is to re-run it
  or to establish that `main` skipped it too.
- **Smoke against the wrong ports.** Covered in step 18; the default is a dev-server probe.
- **Releasing from a rewritten `main`.** Covered in step 6; `--ff-only` turns a rewritten base into
  a stop rather than a merge.
- **The `oci:verify` ordering trap.** Covered in step 12; it fails on a missing image, not on a
  defect.
- **Release notes claiming unmeasured evidence.** Covered in steps 5 and 29; RF-5, RF-9 and PERF-1
  have harnesses and no recorded runs, and W7 is blocked behind RF-5.

## Out of scope

- Any source, script, workflow, or `gate-tooling.json` change. The drift gate already checks the
  commands a document names, so a `pnpm release:check` script would add a gate row, a tier
  decision, and its own test to enforce something already enforced.
- Opening `@automate/*` for npm publication (D1). That is a separate change with its own design.
- Automating the release. `release-gate.yml` is `workflow_dispatch` and the human publishes; an
  automated publish is a new trust decision, not part of this runbook.
- Re-testing or re-baselining `pnpm test:render`, `pnpm render:baseline`, or `pnpm test:performance`
  — those need the reference hardware (a self-hosted single-node install), which a release run does
  not have.
