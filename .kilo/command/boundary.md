---
description: 'Add a table to the tenancy register, or diagnose a boundary regression. Runs pnpm tenancy:check and reports what the register says versus what the schema does.'
---

# `$ARGUMENTS`

`WORKSPACE_ID` is the only tenancy boundary in the system. This command exists because the rule was restated in five places and **none of them said which tables it applied to** — so "do not add a table without `workspace_id`" had nothing to be checked against.

**`docs/quality/tenancy-scope.json` is the list. `pnpm tenancy:check` is the enforcement.** Read the register; do not audit the schema by eye.

## 1. Run the gate first, so you know what you are arguing with

```bash
pnpm tenancy:check
```

It prints, and this matters: how many tables exist, how many are classified, how many carry a hard boundary, and the tracked debt. **It reports the debt rather than failing**, because a permanently red gate stops catching the regressions.

## 2. Adding a table

The register row is required before the table ships, and it needs three things:

- **`scope`** — `workspace` if it holds tenant-owned data, `global` otherwise. This is a design decision, and it is the one the gate cannot make for you.
- **`column`** — `not-null`, `nullable`, or `absent`, **as observed**, not as intended. Committing the observed state is what lets the gate catch the boundary weakening later.
- **`reason`** — why this classification and state are acceptable today. A row without one fails as drift.

Then decide the column honestly:

```ts
workspaceId: text('workspace_id').notNull(),
```

A bare `workspaceId: text('workspace_id')` is a bypassable boundary: the index exists, the column is read, and nothing forces a value. `runs` is in exactly that state today.

**A child may not be looser than its parent.** `message_attachments` has no column while `messages` is hard-scoped — that inversion is in the debt list and is worth not repeating.

## 3. Making a global table is a real decision, not a way out

13 tables are `global`: the tenancy root (`installations`), the workspace table itself (`workspaces`), installation-scoped identity (`users`, `roles`, `api_keys`, `sessions`, `service_credentials`, `installation_keys`, `saml_config`), and three controlled vocabularies. Marking a table `global` because it "feels like reference data" is the decision that quietly removes a boundary.

The clearest case is already in the register: **`connector_configs` is `workspace`-scoped and `service_credentials` is `global`** — near-identical names, opposite scoping, and both correct. That pair is why the register exists.

## 4. A regression

If the gate reports `REGRESSION`, a row that committed `not-null` lost it. That is not a bookkeeping problem, it is the tenancy boundary weakening, and it is the exact defect the tenancy wave had to fix five times.

The migration shape that works:

1. add the column **nullable**
2. backfill — and the backfill **cannot be invented**. A row carrying no attributable tenant has no correct value, and defaulting it to the default workspace performs the defect the migration is removing. The migrations raise and count; an operator re-scopes or deletes each row.
3. tighten to `NOT NULL`
4. drop the old constraint — and check it actually went

Step 4 is where two of the five failed. `IF EXISTS` swallowed a misspelled constraint name, so the global uniqueness survived **alongside** the new composite index and the migration read as the fix. A schema assertion passes in both states; what catches it is a test that inserts the same unique tuple for **two** workspaces.

## 5. Report

The rows you added or changed, the gate's output before and after, and — if you relaxed anything — the sentence naming what now has no hard boundary and where that is tracked.