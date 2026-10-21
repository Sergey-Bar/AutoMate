## Summary

<!-- What changed and why. Link the ledger row (e.g. MNT-6) or the issue. -->

## How it was tested

<!--
  The rule this repository holds every change to: write the test, run it with the
  defect still present, watch it fail for the reason you expect, then fix it.
  Paste the failing line from the "before" run if you have it.
-->

- [ ] A test fails without this change and passes with it (or: this change has no behaviour to test, because …)
- [ ] `pnpm verify` passes (or `pnpm verify:local` on a host without semgrep and gitleaks)
- [ ] `pnpm test:e2e` passes against a real PostgreSQL, if the change touches a user-facing flow

## The record

- [ ] A defect found or fixed has a row in `docs/quality/findings-ledger.json`, and `pnpm findings:baseline` was run deliberately
- [ ] No gate was weakened: no lowered coverage floor, no `.skip` / `.only`, no new exclusion without a reason in its register
- [ ] Documentation that states a fact this change moved was updated (`pnpm docs:check` is the check)
