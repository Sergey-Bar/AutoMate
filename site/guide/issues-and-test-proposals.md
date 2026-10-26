---
title: Issues and test proposals
description: How AutoMate files a Jira or GitHub issue from a health finding or a failure cluster, and how it asks the configured model to propose a new test for a surviving mutant or uncovered lines — without ever changing your repository.
outline: deep
---

# Issues and test proposals

Two ways to hand work to a person from what AutoMate already measured:

- **An issue** — from one [health finding](repository-health.md), or from one failure cluster on
  the insights page, in Jira or in the project's own GitHub repository.
- **A test proposal** — a new test file the configured model writes for a surviving mutant or a
  commit's uncovered changed lines. It is a patch you read; AutoMate never applies it.

## Issue tracker setup

A project's Jira tracker is one admin request. The token is sealed in the vault on arrival
(`VAULT_SECRET` must be set) and no response ever returns it:

```bash
curl -X PUT "$AUTOMATE/api/v1/projects/$PROJECT/issue-tracker" \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"baseUrl":"https://acme.atlassian.net","projectKey":"ACME","issueType":"Bug","token":"…"}'
```

- `baseUrl` must be `https` with no credentials in it: every request to it carries the token.
- `projectKey` is Jira's key (`ACME`); `issueType` defaults to `Bug`.
- Omit `token` on a later change of key or type and the sealed one is kept. A `baseUrl` on
  another origin (scheme, host or port) needs the token again — `400` otherwise — so the stored
  token is never sent to a host it was not given for.
- `GET` (viewer) answers `hasCredential`; `DELETE` (admin) removes the tracker and its token.
  Issues already created stay linked.

**GitHub needs no setup.** A project whose repository is on github.com files issues there with
the project's own git token, labelled `automate`.

## Creating an issue

An operator names the target — AutoMate never picks one:

```bash
# From a finding
curl -X POST "$AUTOMATE/api/v1/projects/$PROJECT/health/findings/$FINDING/issue" \
  -H "authorization: Bearer $OPERATOR_TOKEN" -H 'content-type: application/json' \
  -d '{"target":"jira"}'

# From a failure cluster, as the insights page shows it
curl -X POST "$AUTOMATE/api/v1/dashboard/failure-clusters/issue" \
  -H "authorization: Bearer $OPERATOR_TOKEN" -H 'content-type: application/json' \
  -d '{"projectId":"…","target":"github","signature":"…","sampleMessage":"…","tests":["…"],"count":12,"runs":4}'
```

The issue carries the finding (rule, severity, location, branch) or the cluster (signature,
sample message, the first `20` failing tests, counts) and a link back to the project's dashboard.

**Asking twice is safe.** The first request answers `201` with the issue key and URL; every later
one answers `200` with the same issue and calls the tracker no more. A request made while another
is still creating the issue answers `409`. A refusal the tracker said it did nothing for (a rate
limit) is repeated; a `5xx` is not, because the issue may exist already — the request fails, and
asking again is your decision. A request that died mid-create leaves a claim that blocks the
source for ten minutes; after that exactly one request takes it over (a compare-and-swap on the
stale claim, so two that race cannot both open an issue). A tracker call that throws rather than
answering releases the claim at once.

No tracker, no token or no connector answers `NOT_CONFIGURED` before anything is sent. Every
configuration change and every issue is an audit event.

## Test proposals

```bash
curl -X POST "$AUTOMATE/api/v1/projects/$PROJECT/health/test-proposals" \
  -H "authorization: Bearer $OPERATOR_TOKEN" -H 'content-type: application/json' \
  -d '{"kind":"surviving-mutant","findingId":"…","sourceSnippet":"export function clamp…"}'
```

Two kinds of evidence:

- `surviving-mutant` — a `stryker/surviving-mutant` finding from a
  [mutation report](repository-health.md).
- `uncovered-lines` — `commit` and `path` of a commit whose diff coverage recorded uncovered
  changed lines.

The prompt is built from that evidence. Your server may have no checkout, so send the source as
`sourceSnippet` (at most 20 000 characters); without it the model is told to name what it
assumed. `testFramework` overrides the one the file extension implies.

The answer is stored as a unified diff that **creates one new file** beside the source —
`src/math.ts` gets `src/math.proposed.test.ts` — so it cannot overwrite an existing test, with the
rationale, model and token counts. `GET` on the same path lists the newest 50.

- **Nothing is applied.** No commit, push or pull request, and the proposed test is never run:
  whether it compiles and kills the mutant is for whoever applies it (`git apply`).
- No model provider configured (`KILO_GATEWAY_URL` and `KILO_API_KEY`, or `OLLAMA_BASE_URL`)
  answers `NOT_CONFIGURED`. An answer with no fenced code block is `MODEL_OUTPUT_UNUSABLE`.
- Each proposal spends model budget, so it is an operator action, and it is recorded as a GenAI
  span under the agent `automate-test-proposals` on the [agent runtime](agents.md) page.

## Rotating the vault key

Tracker and git tokens live in the vault. To rotate its secret, start the API once with the new
`VAULT_SECRET` and the old one as `VAULT_SECRET_PREVIOUS`: every entry is re-sealed in one
transaction, and a later start with both still set changes nothing. Remove
`VAULT_SECRET_PREVIOUS` afterwards. An entry that opens under neither secret stops the start with
nothing changed.

Known limitation: the rotation re-seals the entries of the installation's own workspace
(`WORKSPACE_ID`) only, so on a database several installations share under one `VAULT_SECRET`,
start each with both secrets before removing `VAULT_SECRET_PREVIOUS` — and during a rolling
restart, an instance still on the old secret cannot open an entry another has already re-sealed.
