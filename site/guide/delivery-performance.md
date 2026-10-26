---
title: Delivery performance
description: DORA's delivery metrics and pull-request flow, from GitHub or from your CI, and how they reach the health grade and the pull-request gate.
outline: deep
---

# Delivery performance

How often a repository ships, how long a change waits to reach production, how often a
deployment goes wrong and how long it takes to recover — DORA's metrics — and where pull
requests wait on the way. Every number is a repository aggregate. **Nobody is ranked or
named**: the reads carry no author, and the stale list names pull requests, not people.

Two ways in, used separately or together:

- **The GitHub sync** reads pull requests, their reviews, commits and files, the default
  branch's commits, GitHub Deployments and, optionally, deploy-workflow runs.
- **The push door** takes a deployment or an incident from any CI job or pager, for a
  repository that is not on GitHub or does not use GitHub Deployments.

GitHub is the only provider the sync reads. GitLab and Bitbucket projects use the push door.

## Turn on the GitHub sync

The project needs a `https://github.com/<owner>/<repo>` repository URL and a GitHub token
saved on the project (the same token a scan clones with; it is sealed in the vault and never
leaves it). A fine-grained token with read access to **Pull requests**, **Contents**,
**Deployments** and **Actions** is enough.

```bash
curl -X PUT "$AUTOMATE_URL/api/v1/projects/$PROJECT_ID/delivery/source" \
  -H "authorization: Bearer $AUTOMATE_OPERATOR_TOKEN" \
  -H 'content-type: application/json' \
  -d '{ "enabled": true, "cadence": "hourly", "productionEnvironments": ["production"] }'
```

`cadence` is `hourly` or `daily`. The worker queues one sync per hour or per UTC day, and the
API runs it — the worker has no vault, so it never holds the token. Enabling a source makes it
due at once. `POST …/delivery/sync` (operator) queues a sync now and answers `202`.

Optional fields:

| Field                            | Default                  | What it does                                                                   |
| -------------------------------- | ------------------------ | ------------------------------------------------------------------------------ |
| `markers.rollbackLabels`         | `["rollback", "revert"]` | A merged pull request with one of these labels makes its deployment a rollback |
| `markers.hotfixLabels`           | `["hotfix"]`             | …a hotfix                                                                      |
| `markers.rollbackBranchPrefixes` | `["revert-"]`            | GitHub's own Revert button opens `revert-<n>-<branch>`                         |
| `markers.hotfixBranchPrefixes`   | `["hotfix/"]`            | Head branches that mark a hotfix                                               |
| `deployWorkflows`                | `[]`                     | Workflow names whose completed runs on the default branch count as deployments |

A sync reads each stream from where the last successful one stopped; the first reads 90 days
back. A stream's cursor moves only when that stream succeeded, and every write is an upsert, so
a repeated or interrupted sync writes nothing twice. When GitHub rate-limits the token the
sync waits until GitHub's reset time — the attempt is not counted as a failure. A project with
no GitHub URL or no token records `not_configured` with the reason; it never fails silently.

**A long backlog is read across syncs, not cut.** GitHub lists newest first, and one sync reads
a bounded number of pages (one page of 30 pull requests read in full, three pages of commits or
workflow runs, one page of 100 deployments). When the bound stops the read, the stream is marked
`incomplete` with the next page, its cursor stays put, and the next sync continues from that
page; the cursor moves to the newest item only once the read has reached it. A deployment GitHub
has not decided yet holds the deployments cursor at its creation, so it is re-read until it is
decided, however long that takes. Commits are read with GitHub's `since`, which filters by
**commit date**: a rebased or merged branch's commits can carry dates older than the push.

**One sync of a source at a time.** A source has at most one queued sync — a second request is
answered with the one already waiting. A claimed sync holds a ten-minute lease, renewed after
every stream; each write it makes carries the lease's id, so a sync that outlived its lease and
was taken over by another process writes nothing more. Cursors are merged per stream, the later
one winning, so no writer moves one backwards. A sync is attempted at most three times.

`GET …/delivery/source` (viewer) shows the source, each stream's cursor (and `incomplete`, while
a backlog is being read), the last status and the last error.

## Push deployments and incidents from CI

The push door takes the same credential as a [health report upload](repository-health.md):
the reporter secret, an uploader token for the project, or an operator or admin token.

```bash
curl -X POST "$AUTOMATE_URL/api/v1/projects/$PROJECT_ID/delivery/deployments" \
  -H "authorization: Bearer $AUTOMATE_UPLOAD_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
        "externalId": "'"$CI_PIPELINE_ID"'",
        "environment": "production",
        "status": "success",
        "createdAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
        "sha": "'"$GIT_COMMIT"'"
      }'
```

`status` is `success` or `failure`. `shas` (every commit the deployment carried),
`rollback`, `hotfix`, `unplanned` and `url` are optional. Sending the same `externalId` again
replaces the deployment (`200`); a new one answers `201`.

Incidents go to `…/delivery/incidents`:

```json
{
  "externalId": "INC-1042",
  "source": "pagerduty",
  "openedAt": "2026-10-23T10:30:00Z",
  "resolvedAt": "2026-10-23T11:05:00Z",
  "severity": "high",
  "deploymentId": "ci-8812",
  "title": "Checkout errors after release"
}
```

Link an incident with `deploymentId` (the deployment's `externalId`, or GitHub's deployment
id) or with `sha`; an incident linked to neither is outside DORA's definition and does not
count. Send it again with `resolvedAt` when it closes.

**The two doors are deduplicated.** A pushed deployment of the same commit to the same
environment within ten minutes of a GitHub one is the same deployment, and the GitHub row is
kept. Both rows are stored; the collapse happens when the metrics are computed, so the order
they arrive in does not matter.

## Read the scorecards

`GET /api/v1/projects/:id/delivery?days=30` (viewer) returns two scorecards — `delivery`
(DORA) and `flow` (pull requests) — the raw results under them, the stale pull requests and the
sync status. `GET /api/v1/portfolio/delivery?days=30` returns every project's DORA tiers and
both scores.

The DORA tiers are the four clusters of the **Accelerate State of DevOps Report 2024**. The
2025 DORA report replaced the clusters with team archetypes and publishes no per-metric bands,
so 2024 is the latest source of bands; rework rate entered the model in 2024 with no tier and
is shown without one. The bands and their published wording are in
`packages/reporting/src/dora.ts`.

**Too little data is not a tier.** A metric resting on fewer than five observations is
`insufficient` and has no value; a scorecard with no measured metric has no score. Five good
deployments are not evidence of an elite team, and a stalled pipeline reads as "not enough
data", never as a band.

A deployment with no explicit `shas` is credited with the merge commits of the pull requests
merged into the default branch since the previous successful production deployment. That is an
approximation by merge time; CI that knows the exact list sends it as `shas`.

## Policy, the grade and the gate

The `health` key of `automate.config.json` takes a `delivery` block:

```json
{
  "health": {
    "weights": { "delivery": 10 },
    "delivery": {
      "productionEnvironments": ["production"],
      "maxChangeFailureRate": 0.15,
      "maxLeadTimeHours": 168,
      "minDeploysPerWeek": 1,
      "maxRecoveryHours": 24,
      "staleAfterDays": 7,
      "gateOnDelivery": true
    }
  }
}
```

- `productionEnvironments` here wins over the source's list, because this file is versioned
  with the code.
- The four limits fail the DORA scorecard when a **measured** metric crosses them.
- The DORA score feeds the grade's `delivery` dimension, which counts only when `weights`
  gives it a weight; without one it is shown and left out.
- With `gateOnDelivery`, a failing DORA scorecard fails the pull-request gate with its
  reasons, and an `insufficient` or `not_configured` scorecard fails it too
  (`Delivery was not measured …`): as with diff coverage, a number nobody measured does not
  show the policy was met.
- The GitHub gate comment carries one DORA line whenever the scorecard is measured.

## The GitHub webhook (optional)

Webhooks make a sync start when something changes instead of on the next cadence. The receiver
is **off** unless both of these are set; otherwise `POST /api/v1/webhooks/github` answers a
coded `404`:

- `AUTOMATE_LAN_MODE=1` ([LAN mode](lan-mode.md)) — a loopback-only install cannot be reached;
- `GITHUB_WEBHOOK_SECRET` — 32 characters or more.

In the repository's **Settings → Webhooks**, add the install's public URL followed by
`/api/v1/webhooks/github`, content type `application/json`, the same secret, and the events
**Pull requests**, **Pull request reviews**, **Deployment statuses**, **Pushes**, **Releases**
and **Workflow runs**. GitHub has to reach the install, which on a local network means a
tunnel or reverse proxy, and LAN mode's client allowlist has to admit it: add the proxy's
address, or GitHub's `hooks` ranges from `https://api.github.com/meta`, to
`ALLOWED_CLIENT_CIDRS`.

What the receiver does, in order: refuses past 120 requests a minute from one address and past
1 MB; checks `X-Hub-Signature-256` over the raw body; refuses a delivery whose id **or whose
body** it has already accepted (both are kept seven days: GitHub signs the body and not the
`X-GitHub-Delivery` header, so a captured body re-sent under a new id is a replay too); and only
then reads the payload's repository name. **That name is the only thing it reads.** It queues a
sync for each enabled source whose project has that repository, and the sync asks GitHub's API
for the data with the project's own token; nothing from the payload is stored. Other events
answer `202` and are ignored. GitHub's "Redeliver" re-sends the same delivery and is refused as
a replay; the next scheduled sync reads the same data. A delivery the receiver failed to handle
(a database error, say) is forgotten, so GitHub's automatic retry of it is accepted.

## Where it lives

| Part                                  | Code                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub reads, pagination, rate limits | `packages/connectors/github/src/index.ts`                                                                                                  |
| Tables                                | `packages/db/drizzle/0037_delivery.sql`, `packages/db/drizzle/0038_github_webhooks.sql`, `packages/db/drizzle/0044_delivery_hardening.sql` |
| Scheduling                            | `apps/worker/src/scheduler.ts` (`pollDeliverySyncs`)                                                                                       |
| The sync                              | `apps/api/src/services/delivery-syncer.ts`                                                                                                 |
| Dedupe, attribution, the scorecards   | `apps/api/src/services/delivery-service.ts`                                                                                                |
| The webhook                           | `apps/api/src/services/github-webhook.ts`                                                                                                  |
| DORA and flow computations            | `packages/reporting/src/dora.ts`, `packages/reporting/src/flow.ts`                                                                         |
