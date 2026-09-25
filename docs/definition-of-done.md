# Definition of Done (DoD)

This checklist defines the minimum quality bar for every change in Automate.

## 1) Scope & Product

- [ ] The change matches the requirement and acceptance criteria.
- [ ] Any behavior changes are reflected in docs (README, API docs, or feature docs).
- [ ] No unrelated scope creep is included in the PR.

## 2) Code Quality

- [ ] Code follows existing project patterns and naming conventions.
- [ ] No type-safety suppression (`any`, `@ts-ignore`, `@ts-expect-error`, `as any`).
- [ ] Error handling is explicit and user-facing where relevant.

## 3) Verification Gates

- [ ] `pnpm lint` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm build` passes.

## 4) Testing

- [ ] New or changed behavior is covered by tests at the right level (unit/integration/e2e).
- [ ] Existing tests were updated when contracts changed.
- [ ] No failing test was removed/skipped to force green CI.

## 5) Security & Operations

- [ ] No secrets or credentials are committed.
- [ ] New env vars are documented in `.env.example` and docs.
- [ ] Logging does not expose sensitive data.

## 6) Review Readiness

- [ ] PR description explains **why** this change exists and how it was validated.
- [ ] Risky areas and rollback considerations are noted when needed.
- [ ] Branch is ready for review and CI is green.
