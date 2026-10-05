---
name: no-second-authority
description: 'Use when you are about to restate a value, rule, vocabulary, path, command, or number that already has a source of truth — a constant, a severity list, a script name, a directory path, a coverage floor, a package script, or a generated artefact. Also use when a check exists but compares against nothing, or when a record claims something exists and you have not verified it.'
---

# The second authority is the defect

This repository has recorded the same defect three times under different names, and it is the single most common way a correct-looking tree goes wrong:

- **P-6** — three startup-policy authorities. `packages/config` gave `COOKIE_SECRET` a 32-character minimum and `AUTOMATE_API_KEY` a 16-character one, so the weakest credential set the bar for all of them; and `apps/api/src/startup-policy.ts` carried **its own** 16-character check with its own message. Two authorities, disagreeing. The fix was to derive the threshold from the schema and delete the literal, so a second authority became *impossible* rather than merely discouraged — and the file now has no `32` and no `16` left in it.
- **P-5** — `runs.gate_status` was `['passed','failed','skipped']` in the schema while `GateStatusSchema` in `shared-contracts` was `['passed','failed','warning','unknown','not_evaluated']`. The lists disagreed **in both directions**: the database rejected three values the contract defines and accepted one no client can send. `0009_enum_constraints.sql` pinned the same three as a CHECK, so the mismatch was enforced by the database rather than merely typed. The row also recorded *why* a second list existed: `execution.ts` imports from `dashboard.ts`, so importing the constant back created a cycle. The fix was structural — a leaf module, `schema/vocabularies.ts`, that imports nothing.
- **P-71** — `registrationAuthorized` returned `process.env['NODE_ENV'] !== 'production'`, which fails **open** on staging, on dev, and on an unset environment, which is the state every brand-new deployment is in before anybody has configured it.

The pattern: a value copied into a second place, where it can drift, and where nothing notices.

## The rule

**A value that has a source of truth must be read from it, or made unrepresentable elsewhere.**

Three legitimate ways to keep one authority, in descending order of strength:

1. **Make the duplicate unrepresentable.** A required parameter is stronger than a runtime guard — a guard you can forget to call is weaker than a signature you cannot call wrong. That is how P-6 closed: `verifyCredential(pepper, presented, storedHash)` makes "a hash configured without a pepper" impossible, where the deleted middleware had merely refused it.
2. **Derive it.** The second place imports the constant rather than restating it.
3. **Assert they agree.** Only when 1 and 2 are unavailable — and then with a test that fails in the drifted state, not a comment.

**A comment is never an assertion.** Neither is a README.

## The authorities in this repository

| Fact | Lives in | Never restate it in |
|---|---|---|
| Secret length floor, placeholder vocabulary | `packages/config` — `SECRET_MIN_LENGTH`, `isSecretPlaceholder` | `apps/api/src/startup-policy.ts` |
| Controlled vocabularies (`GATE_STATUSES`, …) | `packages/db/src/schema/vocabularies.ts` — a leaf module importing nothing | any schema file |
| Which tables are workspace-scoped | `docs/quality/tenancy-scope.json`, enforced by `pnpm tenancy:check` | an agent prompt, a checklist, a review comment |
| API contracts | Zod schemas in `packages/shared-contracts` | the client, a hand-written mirror, an OpenAPI document |
| Coverage floors | `coverage-baseline.json` | any `.md` file, any agent file, any skill |
| Gate tiers and required tools | `scripts/gate-tooling.json` | prose, a workflow, a comment |
| Review severities, categories, rules | `.github/review-rules/rules.json` | an agent prompt, a checklist, a PR template |
| Confirmed defects | `docs/quality/findings-ledger.json` | a conversation, a status message, a plan document |

`AGENTS.md` deliberately restates no coverage floor and no tier list — it points at the file. Follow that.

## Before you write a number, a path, or a command into a document

**Verify it.** A wrong restatement is worse than an absent one, because it is load-bearing and it is trusted.

This is not hypothetical, and the fourth entry below was committed by the author of this skill. Verified against the tree on 2026-10-02, four claims in the repository were false:

1. The OpenAPI ledger row's `resolution` states that *"`@asteasolutions/zod-to-openapi` is already a dependency of `packages/shared-contracts` — `packages/shared-contracts/package.json` lists it, and `packages/shared-contracts/src/openapi.ts` generates from the same Zod schemas."* **Neither is true.** `packages/shared-contracts/package.json` lists `zod` as its only runtime dependency and `ajv`, `eslint`, `typescript`, `typescript-eslint`, `vitest` as dev dependencies. `src/openapi.ts` does not exist — the directory holds `index.ts` and `schemas/`.
2. `packages/shared-contracts/README.md` says the `*.schema.json` files in `src/schemas/` are "preserved for backward compatibility with AJV consumers". **There are no `.schema.json` files** — `src/schemas/` holds only `.ts` files. `ajv` is a devDependency validating nothing.
3. The same README instructs the reader to "update the corresponding `*.schema.json` to match", which cannot be followed.
4. `docs/quality/tenancy-scope.json` was written with a tally of `19 / 37 / 18` workspace-scoped-with-boundary / without / global. Recomputed from the schema and the register, the actual figures are **15 / 28 / 13** — every field wrong, because the numbers had been typed from memory instead of measured. The register's six tally values are now recomputed by `scripts/lib/tenancy-scope.test.mjs` and a mismatch fails, and the correction is recorded in the file's own `note`.

`pnpm findings:check` and `pnpm docs:check` both pass over all four. They check rows, evidence paths, and links; none of them recomputes a number a document asserts about itself. **That is itself an instance of the class: a claim about the state of the tree that nothing checks.**

## The general shape of the fix

A number written into a document needs either a recomputation or nothing. The three legitimate answers, in descending order of strength:

1. **Recompute it in a test** and fail on mismatch. `scripts/lib/tenancy-scope.test.mjs` reads the schema and the register and derives the six counts; `tenancy-scope.json` records that the numbers are derived rather than asserted.
2. **Derive it at read time** — a script that prints it, so a reader cannot be given a stale copy.
3. **Point at the file** and write no number. `AGENTS.md` deliberately restates no coverage floor and no gate tier.

## The other recurring instance: a threshold, an SLO, and a capability status

Three things in this repository are thresholds that nothing enforces, and they fail in the same way — a number stands in for a measurement.

- **`performance/thresholds.json`** carries `recorded: false` with three observed values `null`, and its own `reason` field admits every `release` threshold is an unvalidated estimate. A real p95 of 900 ms passes a `p(95)<500` check on a machine nobody ran it on.
- **`performance/rendering-budget.json`** has every ceiling `null`, so `pnpm test:render` measures four routes and compares nothing.
- **The capability register's five statuses** — `real`, `mock`, `missing`, `deferred`, `obsolete` — are typed by a human and recomputed by nothing. `scripts/capability-register.mjs` states outright that it "cannot judge" them; it verifies that cited paths exist and that the baseline is a real commit. 14 of 42 rows read `mock` and 2 read `missing`, and deleting the test behind a `real` row would not change its status. See the `capability-evidence` skill.

The remedy is the same in all three cases: **derive the value, or record it as unverified.** Never write the number the measurement would have produced.

## What a threshold is not

A skill can tell an agent how to configure Stryker, or which RED metrics matter, or how to define a golden signal. None of those things produce a mutation score, export a metric, or prove a capability exists. **When a plan names a number, the deliverable is the tool that measures it** — and the skill, if any, is a rounding error next to the tool.

## The related failure: a check that compares against nothing

Two gates in this repository are well-built and protect nothing, both for the same reason — the evidence was never recorded:

- `performance/thresholds.json` — `recorded: false`, three observed values `null`, and its own `reason` field admits every threshold in `release` is an unvalidated estimate. The cross-check against the k6 scenario is genuinely sound; what it cannot tell you is whether the numbers mean anything. **A real p95 of 900 ms passes a `p(95)<500` check on a machine nobody ran it on.** RF-9.
- `performance/rendering-budget.json` — every ceiling `null`, `recorded: false`. PERF-1.

A gate whose inputs were never measured is the same defect as no gate wearing a threshold's clothes. If you are asked to make one of these real, the answer is to **record the measurement on the reference hardware** (a self-hosted single-node install, per D10) and tighten the threshold to it — not to write plausible numbers so the gate goes green.

## Checklist

Before committing a change that adds a literal:

- [ ] Does this value already have a source of truth? Read it from there, or delete the duplicate.
- [ ] Have I verified the path, the script name, and the number by running or reading them — not from memory, and not from another document that may also be wrong?
- [ ] If the duplicate cannot be removed, is the agreement **asserted by a test that fails in the drifted state**?
- [ ] If I changed a source of truth, did I search for every place that restates it?
- [ ] If I wrote a claim about the tree into a document, is that claim checked by something? If not, either add the check or label the document as prose.