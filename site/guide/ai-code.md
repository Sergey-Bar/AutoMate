---
title: AI-written code
description: How AutoMate attributes pull requests to AI agents, what it measures about the change they write, and the pull-request rules a repository can put on it.
outline: deep
---

# AI-written code

Which pull requests an AI agent wrote, whether that change fares worse than human change —
reverted more often, failing in production more often, needing a follow-up fix sooner — and
the rules a repository can put on an agent's pull request before it merges. Everything here
is built on the [delivery sync](delivery-performance.md): it reads GitHub only, and a project
with the sync off has no attribution to show.

**Nobody is named.** The unit is a kind of authorship and a tool, never a developer. No
response carries an author login, an email address or a name, and a test asserts it against
the fixtures' identities. A per-person AI-usage table is a surveillance instrument, and the
governance question does not need one.

## Attribution

Each pull request is classified when the sync reads it, from two places:

- **the pull request** — its author login, head branch, labels and body (where agents put
  their footers);
- **each of its commits** — author and committer logins, author email and name, the trailers
  of the message (`Co-authored-by`, `Assisted-by`, `Generated-by`, `Made-with`) and markers in
  it.

Both are matched against one versioned table of agent signatures,
`AGENT_SIGNATURES` in `packages/reporting/src/ai-attribution.ts`, where every row cites where
the signature was observed. There are four answers:

| Attribution      | Means                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------- |
| `agent-authored` | An agent wrote and pushed the change: an agent bot login, an agent branch prefix       |
| `ai-assisted`    | A human authored it with an AI tool in the loop: a co-author trailer, an IDE footer    |
| `human`          | A human author identity, and no AI signal anywhere                                     |
| `unknown`        | No author identity to read. **Never counted as human**, and kept apart in every number |

### How commit signals roll up

1. The pull request and each commit are classified on their own. The policy's labels apply to
   the pull request only.
2. **Agent-authored wins.** If the pull request or any commit reads agent-authored, the pull
   request is agent-authored. Otherwise, if any reads AI-assisted, it is AI-assisted — so one
   commit with an agent co-author trailer makes the pull request at least AI-assisted.
3. With no AI signal anywhere it is human when the pull request or a commit has a human author,
   and `unknown` when none does.
4. The agent named is the pull request's own when it carries the winning mode, else the one
   most of its commits of that mode name.

### Confidence

Confidence says how sure the reading is that AI was involved. Each kind of signal carries a
weight — a bot login is set by the platform and hard to fake by accident; a label is applied
by a person and is the weakest — and the weights combine as a noisy-OR over the **distinct
kinds** found across the pull request and its commits. Thirty commits with the same trailer
are one piece of evidence; a new kind can only raise the confidence. A bot that is not an AI
agent (Dependabot, Renovate) is reported as a signal and weighs nothing. `human` is reported
at the lowest weight on purpose: the absence of a signal is weak evidence.

**The limit, stated plainly:** attribution is signature-based. Every agent here can be
configured to drop its trailer, and an agent that pushes under a person's account with no
trailer is read as human. A repository that wants certainty labels agent pull requests and
lists the labels in the policy.

### When the signature table changes

Every row stores the table version it was classified against (`attribution_version`, with a
digest of the policy's labels when there are any). The sync re-classifies stale rows from what
it already stored at the start of each run, before it reads GitHub, a bounded batch per run;
the report says how many merged pull requests in the window are still stale. The governance
gate, which acts on one pull request, re-classifies a stale one on read instead of waiting.

## Outcomes

Per merged pull request into the default branch — what landed — derived on read:

| Outcome                   | Definition                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reverted                  | A later merged pull request is GitHub's revert of it (head branch `revert-<number>-…`, or title `Revert "<title>"`), or a landed commit says `This reverts commit <merge sha>` |
| Caused a failure          | DORA's verdict on the first production deployment that carried its merge commit — the same rule as the change-failure rate. Not counted when it never reached production       |
| Follow-up fix             | Days until a later merged pull request that is a fix touched one of the same files                                                                                             |
| Review depth              | Review comments per hundred changed lines (additions plus deletions)                                                                                                           |
| Approved without comments | Approved, with no review that only commented                                                                                                                                   |
| Diff coverage             | The diff coverage measured for its head commit, as a percentage                                                                                                                |
| New high findings         | The high and critical findings the pull-request gate found new on it, from its last gate report                                                                                |

A pull request is a **fix** when its title names `fix`, `fixes`, `fixed`, `bugfix` or `hotfix`
as a word (a conventional `fix:` included), when it has a `fix`, `bug`, `bugfix` or `hotfix`
label (optionally `type:` or `kind/` in front), or when its head branch starts `fix/`,
`bugfix/` or `hotfix/`. A revert of the change is a revert, not its fix. The changed paths are
kept from migration `0039_ai_code_governance.sql` on — the first `300` per pull request — so a
pull request synced before it has no follow-up fix to find.

### The statistics rule

AI change is compared with human change rate by rate. A difference is declared only when
**Newcombe's interval for the difference excludes zero and both sides have at least `20`
changes**; below that the comparison is `insufficient`, whatever the numbers look like. A
follow-up fix within a window is only counted for a change at least that old, so the newest
change cannot look the safest by not having had the time to need one.

### Reading it

| Route                                                                        | Role   | Returns                                                                                          |
| ---------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| `GET /api/v1/projects/:id/ai-code?days=90`                                   | viewer | The `ai-code` scorecard, the comparison by attribution and tool, weekly share, the table version |
| `GET /api/v1/projects/:id/ai-code/pull-requests?attribution=&offset=&limit=` | viewer | Each pull request's number, title, attribution, agent, confidence and signals                    |
| `GET /api/v1/portfolio/ai-code?days=90`                                      | viewer | Per project: the share of AI change and the scorecard's status and score                         |

The scorecard is 100 while AI change is no worse than human change and falls by the credible
excess rate otherwise. Its score is the `ai-governance` dimension's metric in the
[health grade](repository-health.md), counted only when the policy gives that dimension a
weight.

## The governance gate

Off unless the repository's health policy enables it. In `automate.config.json`:

```json
{
  "health": {
    "aiGovernance": {
      "enabled": true,
      "agentLabels": ["agent"],
      "requireHumanApproval": true,
      "requireTestsTouched": true,
      "minDiffCoverage": 80,
      "maxNewHighOrCritical": 0,
      "applyTo": ["agent-authored"],
      "treatUnknownAs": "human"
    }
  }
}
```

| Field                  | Default              | What it does                                                                              |
| ---------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| `enabled`              | `false`              | Nothing below applies until it is `true`                                                  |
| `agentLabels`          | none                 | Labels that mark a pull request agent-authored                                            |
| `assistedLabels`       | none                 | Labels that mark it AI-assisted                                                           |
| `requireHumanApproval` | `true`               | One approval by someone who is neither the author nor a bot (`[bot]` or an agent's login) |
| `requireTestsTouched`  | `false`              | The change touches a test file                                                            |
| `minDiffCoverage`      | none                 | 0–100. Coverage that was not measured fails the rule: not measured is not covered         |
| `maxNewHighOrCritical` | none                 | New high plus critical findings the change may add                                        |
| `applyTo`              | `["agent-authored"]` | Which attributions the rules govern; add `ai-assisted` to govern assisted change too      |
| `treatUnknownAs`       | `human`              | `agent-authored` is the strict choice: an unattributed pull request is then governed      |

The CI job's `POST …/health/gate/report` names the pull request (`pullRequest`), and the gate
then records the high and critical findings the branch adds over the default branch, reads the
pull request's attribution, human approvals and tests-touched from the sync, takes the gated
commit's diff coverage, and evaluates the rules. A failing rule fails the gate with its
reason, every failing rule at once. **A human pull request is never subject to the rules.**

The GitHub comment carries an **AI governance** section: the attribution with its confidence
and signals, the verdict and every reason, and — when attribution was unknown — the note that a
default decided it. A pull request the sync never read is `unknown`, and the comment says why:
the sync is off for the project, or has not read the pull request yet. It is never passed as
human without saying so.

## Where it lives

| Part                                   | Code                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------- |
| Signatures and the classifier          | `packages/reporting/src/ai-attribution.ts`                                 |
| The roll-up over commits               | `apps/api/src/services/ai-code-attribution.ts`                             |
| Outcome definitions                    | `apps/api/src/services/ai-code-outcomes.ts`                                |
| The comparison and the scorecard       | `packages/reporting/src/ai-outcomes.ts`, `packages/reporting/src/stats.ts` |
| The rules                              | `packages/reporting/src/ai-governance-gate.ts`                             |
| Reads, the gate check, the gate record | `apps/api/src/services/ai-code-service.ts`                                 |
| Tables                                 | `packages/db/drizzle/0039_ai_code_governance.sql`                          |
