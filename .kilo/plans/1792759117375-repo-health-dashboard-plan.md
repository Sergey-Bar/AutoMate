# AutoMate Health — the repository health and quality dashboard

**Status:** plan of record, being implemented on `feat/repo-health`. Lean by directive: no
homegrown analyser, no new scanner, nothing built that the deferred list names.

## Problem

AutoMate scored test health only, for repositories already on the runner host. There was no
letter grade, no stored lint / security / dependency / duplication findings, no per-dimension
trend, no remote repository, and nearly every route was `open`.

## Decisions

1. **Seven dimensions, every one measured by an existing tool.** Security (Semgrep, gitleaks,
   Trivy), Dependencies (OSV-Scanner, Trivy), Code quality (any linter's SARIF, jscpd), Tests
   (the existing QA score), Coverage (existing adapters), Supply chain (OpenSSF Scorecard),
   Runtime (k6, Lighthouse). SARIF 2.1.0 is the common language, so one adapter covers most
   findings.
2. **Grade = hard gates + weighted geometric mean.** Per-dimension 0–100 and a letter
   (A+ ≥ 97, A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, else F). Overall is the weighted geometric mean of
   measured dimensions through the same `weightedGeometric` the QA score uses
   (`packages/projects/src/score/geometric.ts`). An open secret, a critical vulnerability with
   a fix available, or failing default-branch tests caps the overall at D. A dimension no tool
   reported on is *not measured* and excluded; without Security, or with fewer than two
   dimensions, the grade is *incomplete* and prints no letter. Weights, disabled gates and the
   pull-request policy live under `health` in `automate.config.json`.
3. **Untrusted code.** A git-sourced repository runs only scanners that never execute
   repository code, enforced server-side. Local paths keep the existing GenericSpawn. CI upload
   executes nothing on the host.
4. **Access.** Sign-in required; viewer / operator / admin on the existing API-key session;
   repository-scoped upload tokens for CI; mutations audited.
5. **UI.** Strictly inside `site/guide/design-language.md`: one large answer per screen, the
   limiter sentence beside it, detail on demand.

## Waves

1. Contracts and the pure grade — `packages/shared-contracts/src/schemas/health.ts`,
   `packages/projects/src/health/grade.ts`, invariants HEALTH-1 and HEALTH-2.
2. SARIF adapter; jscpd, Scorecard and Lighthouse metric adapters.
3. Persistence (health scans, findings, snapshots; members; tokens) with tenancy rows and
   cross-workspace isolation tests.
4. Ingestion through the reporter upload door, with the fingerprint diff (new / fixed /
   persisting) that preserves triage.
5. Health read API and portfolio API.
6. Repository health page, findings explorer, portfolio landing.
7. Scanner profiles and one-click scan for local repositories.
8. Remote clone (https / ssh only, hooks and submodules off, token from the vault).
9. Roles, repository tokens, audit.
10. Triage and CODEOWNERS ownership; pull-request gate (GitHub commit status and one comment).
11. Scheduled scans; Slack and HMAC-signed webhook alerts; documentation.

## Deferred — recorded, not built

OIDC single sign-on; GitLab enrichment; an OCI sandbox that runs tests on cloned repositories
(the successor to ADR-011); email and the weekly digest; exports; badges; retention; complexity
scanning; bus factor; axe and Syft as separate tools.

## Landed, and what it left open

Every wave above is implemented with tests. The guide is `site/guide/repository-health.md`
and the capability row is `quality.repo-health`. Things still open:

- **Role guards only cover part of the API.** They sit on the project, repository-health and
  access-token routes. The run, dashboard and runner routes keep the access they had
  (ADR-006). Bringing those under `ACCESS_CONTROL=enforced` would also change the web pages
  that read them, so it is its own change.
- **Scanner binaries have no `scripts/gate-tooling.json` row.** That manifest records root
  scripts, and the scanners are product jobs, not root scripts. A runner advertises the ones
  it has installed in `RUNNER_CAPABILITIES`. Nothing installs them into the runner image yet.
- **Alerts cover two of the three planned events.** There is no alert for an acceptance that
  is about to expire. The expiry itself is enforced: the finding counts again once it passes.
