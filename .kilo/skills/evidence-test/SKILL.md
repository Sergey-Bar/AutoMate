---
name: evidence-test
description: 'Use when writing any test — Vitest unit, Playwright e2e, or node:test for scripts — or when fixing a failing test, raising coverage, or reviewing whether a test actually proves anything. Enforces the red-first rule from AGENTS.md and CONTRIBUTING.md: write the test, run it with the defect still present, watch it fail for the expected reason, then fix.'
---

# Writing a test that is evidence

> **Write the test, run it with the defect still present, watch it fail for the reason you expect, then fix it. A test only written against the fixed code is not evidence.**

`CONTRIBUTING.md` records why this is a rule rather than a preference: **three times in this programme's history a suite was fully green while checking the wrong thing**, and none of them was caught by reading the code carefully.

A test that cannot fail is worse than no test, because it is counted.

## The procedure

1. **Reproduce first.** For a failing test, make it fail and read the real failure. Do not adjust the test to the observed behaviour without deciding which one is wrong — that decision is the work.
2. **Write the assertion against the behaviour, not the implementation.** Assert the mapping, the state, the response body, the thrown error. A test that asserts a private helper was called has coupled itself to a refactor.
3. **Run it before the fix.** This is the step that gets skipped, and skipping it is what makes the other two worthless.
4. **Read the failure message and check it is the failure you predicted.** Not "a test failed" — the assertion you care about, failing, for the reason you expected.
5. **Then fix the defect** and re-run.

If step 4 does not produce your predicted failure, stop. One of these is true and all three need work:

- the assertion is asserting nothing (`expect(true).toBe(true)`, a loop that exists only to move a counter);
- the behaviour was never actually broken, so the test proves nothing about the defect it was written for;
- the failure is a different bug, and you have found a second defect.

## Never

- `.skip`, `skipIf`, `.only`, `xdescribe`. `test.disabled` is a **Critical** in `.github/review-rules/rules.json`, and it lists those four spellings.
- Delete or weaken a failing test to make a suite green.
- Lower a coverage floor. `pnpm coverage:ratchet` exists to make lowering one visible.
- Add an assertion whose only purpose is a coverage counter. Assert the real mapping, or quarantine the code in `docs/quality/coverage-exclusions.md` with a removal condition that names a thing which could happen — never "in the future".

## Coverage floors are ratcheted, not declared per package

`vitest.shared.ts` sets `STANDARD_THRESHOLDS` and **deliberately declines to apply them per package**, because four packages sit well below and a gate that blocks every run gets raised until it means nothing.

`coverage-baseline.json` holds the real floor per package, and `pnpm coverage:ratchet` fails only on a regression, so the floor only moves up. **Read the current floors from that file** — they change, and no file in this repository restates them, on purpose.

A newly measured file must be genuinely covered on the same PR.

## Traps specific to this repository

**A mocked database cannot see a race or a revoked row.** `ensureBootstrap` returned revoked keys and lost an insert race; both defects were invisible to unit tests, and the twelve cases that catch them run against PGlite with the real migration graph, in `tests/integration`. If the defect is about concurrency, ordering, or a constraint, a mocked repository cannot prove the fix.

**A green E2E suite can mean there was no database.** `playwright.config.ts` **throws** without `DATABASE_URL` rather than falling back to the in-memory store. `E2E_ALLOW_IN_MEMORY=1` is for a deliberate local run; CI must not set it.

**A Playwright project matching no spec is a green job that executed nothing.** This repository has had to fix that twice. Every project needs a spec, and the durable-path project carries its own non-empty assertion, asserted by a test.

**A schema assertion passes in both states.** Connector credentials were migrated twice and both attempts passed a schema assertion: the constraint is spelled `_unique` not `_key`, `IF EXISTS` swallowed the mismatch, and the global uniqueness survived *alongside* the new composite index. What caught it was a test that inserts the same connector for **two workspaces** — the assertion that distinguishes "the index is composite" from "a composite index exists somewhere".

## What the test should assert for tenancy

`WORKSPACE_ID` is the only tenancy boundary. Any new workspace-scoped read or write needs a cross-workspace isolation test:

- the same key or same unique tuple in **two** workspaces both persist;
- a repeat **within** one workspace is still refused;
- a row carrying no workspace cannot be stored at all;
- each reader sees only its own rows.

**`docs/quality/tenancy-scope.json` says which tables that requirement covers** — 56 tables, 43 of them workspace-scoped, and 28 of those without a hard `workspace_id` column today. So "does this table need the test?" is a question the register answers and the schema does not: the column's presence and the table's scope are different questions. `pnpm tenancy:check` fails on a table with no row, so add the row when you add the table.

Four tables each needed a tenancy migration for exactly this reason, and the migration failures were all of the form "a constraint was created but the old one survived".

## Where tests go

| Code under test | Test file |
|---|---|
| `apps/**`, `packages/**` source | colocated `*.test.ts` / `*.test.tsx` |
| `scripts/**` (dependency-free, not typechecked) | `scripts/lib/*.test.mjs`, run with `node --test` |
| User-facing flows, and anything needing PostgreSQL | `e2e/**/*.spec.ts` under Playwright |
| Migration graph and data model | `tests/integration/**` against PGlite with every migration applied |

Run one file scoped:

```bash
pnpm --filter @automate/api exec vitest run src/routes/execution.test.ts
node --test scripts/lib/findings-ledger.test.mjs
npx playwright test e2e/your-file.spec.ts
```

## Before you say it passes

State the evidence: the command you ran, the failure you saw with the defect present, and the pass with the fix. "Tests pass" without that chain is the thing this skill exists to prevent.