---
title: Repository health
description: Grade any repository from the scanners it already runs, see what limits the grade, and gate pull requests on it.
outline: deep
---

# Repository health

One letter per repository, the sentence that explains it, and the findings behind it. Every
number comes from a scanner somebody else wrote and maintains. AutoMate reads their reports
and analyses no source code itself.

## The grade

Seven dimensions, each scored 0–100 and lettered:

| Dimension    | Measured by                                                                 |
| ------------ | --------------------------------------------------------------------------- |
| Security     | Semgrep, gitleaks, Trivy (misconfiguration), CodeQL, Bandit, any SAST SARIF |
| Dependencies | OSV-Scanner, Trivy (vulnerabilities and licences)                           |
| Code quality | Any linter's SARIF (ESLint, Ruff, golangci-lint), jscpd duplication         |
| Tests        | The QA score from the runs AutoMate already records                         |
| Coverage     | lcov, Cobertura, JaCoCo, Go coverprofile, an istanbul summary               |
| Supply chain | OpenSSF Scorecard                                                           |
| Runtime      | k6 thresholds, Lighthouse categories                                        |

A findings dimension starts at 100 and loses points for each open finding: one critical takes
it to F, one high to C, and one medium leaves it at A. Each new finding costs less than the one
before it. A metric dimension uses the tool's own number on a 0–100 scale.

The overall grade is the **weighted geometric mean** of the dimensions that were measured, so
a zero cannot be averaged away. Three **hard gates** cap the grade at D whatever the mean says:

- an open secret
- a critical vulnerability with a fix available
- failing tests on the default branch

The grade always names its limiter, for example _Capped at D — 1 open secret in the
repository_. A dimension that no tool reported on is **not measured**: it is shown as such
and left out of the grade, never scored as 0 or 100. A repository whose Security dimension is
unmeasured, or that has fewer than two measured dimensions, is **incomplete** and gets no
letter.

Weights, disabled gates and the pull-request policy live under `health` in
`automate.config.json`:

```json
{
  "version": 1,
  "health": {
    "weights": { "runtime": 0 },
    "gate": { "minLetter": "B", "maxNewCritical": 0, "maxNewHigh": 3 }
  }
}
```

## Three ways to get reports in

**From CI** (any host, nothing runs on the AutoMate server). Run your scanners, then send what
they wrote with the action in this repository:

```yaml
- run: semgrep scan --config p/default --sarif --output semgrep.sarif .
- run: gitleaks dir . --report-format sarif --report-path gitleaks.sarif --exit-code 0
- uses: Sergey-Bar/AutoMate/.github/actions/automate-health@main
  with:
    url: https://automate.example.com
    project-id: ${{ vars.AUTOMATE_PROJECT_ID }}
    token: ${{ secrets.AUTOMATE_UPLOAD_TOKEN }}
    reports: |
      sarif:semgrep.sarif
      sarif:gitleaks.sarif
```

The token is an `uploader` access token pinned to the project. It can send reports to that
project and nothing else. The action also sends `CODEOWNERS`, so findings get owners, and it
asks for the pull-request gate.

**A local checkout.** Register the repository by its path on the runner host and press **Scan
now**. Each scanner runs as its own job, on a runner that lists it in `RUNNER_CAPABILITIES`
(for example `gitleaks,semgrep,osv-scanner,trivy,jscpd`). A scanner that applies to the
repository but that no runner has installed is reported as _not installed_, never as clean.

**A git URL.** Register `https://`, `ssh://` or `git@host:owner/repo`, with an optional token
for a private repository. The token is sealed in the vault, never stored on the project, and
handed only to the runner holding the job. The runner clones a shallow copy with hooks,
submodules, LFS and the host's git config disabled, then deletes it after the scan. A cloned
repository is **untrusted**, so it only gets scanners that read files and never run its code.
Tests, coverage and Runtime for a cloned repository come from CI.

Scheduled scans (**daily** or **weekly**) use the same jobs, enqueued by the worker.

## Pull requests

`POST /api/v1/projects/:id/health/gate/report` evaluates the branch's grade and the findings
the branch has that the default branch does not. A finding already on the default branch is
not the pull request's to fix. With no policy configured, the gate fails only on a new
critical finding. For a github.com repository with a token, the result is posted as an
`automate/health` commit status and one comment that is updated on every push.

## Findings and triage

Findings carry from one report to the next by the tool's own fingerprint. A finding is
**new** the first time it appears, **persisting** while it keeps appearing, and **fixed**
when the next report of the same kind no longer has it. A person can:

- **accept the risk**, which requires a reason and an expiry;
- **suppress**, which takes an optional expiry;
- mark a finding as a **false positive**;
- assign an owner.

None of these count against the grade, and the next report does not undo them. When an
expiry passes, the finding counts again. Owners come from `CODEOWNERS` unless a person
assigned one.

## Access

`ACCESS_CONTROL=open` (the default) keeps the single-operator install ADR-006 describes.
`ACCESS_CONTROL=enforced` requires a credential on every repository-health and project route.
There are four roles:

| Role       | Can                                                                       |
| ---------- | ------------------------------------------------------------------------- |
| `viewer`   | read every grade, finding and trend                                       |
| `operator` | also register repositories, start scans, triage, set schedules and alerts |
| `admin`    | also issue and revoke access tokens (**Map → Access**)                    |
| `uploader` | send reports and CODEOWNERS to one project, from CI                       |

Signing in with the installation key makes you the admin. Every decision is written to the
audit log. The run, dashboard and runner routes keep their existing access.

## Alerts

When the default branch's grade falls or a new critical finding appears, AutoMate posts to a
Slack channel (needs `SLACK_BOT_TOKEN`), to a webhook, or both. Webhooks must be `https`, may
not point at a loopback or private address, and are signed. Each one carries an
`x-automate-signature: t=<unix>,v1=<hex>` header, where `v1` is an HMAC-SHA256 of
`<unix>.<body>` under `HEALTH_WEBHOOK_SECRET`. No webhook is sent until that secret is set.
