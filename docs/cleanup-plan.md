# Cleanup & Decommission Plan: Legacy Applications

## Purpose
This document provides a safe, phased roadmap for decommissioning the legacy standalone products (Automate and Automate) and the deprecated shell application. This plan must only be executed once the Unified Platform has reached verified feature parity and passed all decommission gates.

## Prerequisites
Before any phase of this plan is initiated, the following decommission gates (from `docs/parity-matrix.md`) must be confirmed as **PASSED**:

1. **Gate 1**: All unified API tests pass (208+ tests).
2. **Gate 2**: All unified web tests pass (37+ tests).
3. **Gate 3**: Vertical slice E2E evidence exists (task-17).
4. **Gate 4**: Docker stack boots with healthchecks (task-24).
5. **Gate 5**: No legacy route is referenced by unified app.
6. **Gate 6**: Reporter backwards compatibility proven (task-13).

---

## Phase 1 — Remove Shell App (Lowest Risk)
The shell application (`apps/web/`) is an iframe-based orchestrator that is no longer needed in the unified architecture.

### Actions
- Remove the `apps/web/` directory.
- Remove shell-related configuration from `turbo.json`.
- Remove shell references from the root `package.json` workspaces.

### Validation
- Run `pnpm install` to update lockfile.
- Run `pnpm verify` (build + typecheck + lint + test) to ensure no broken dependencies.

### Rollback
- `git revert <commit-id>` to restore the directory and configurations.

---

## Phase 2 — Remove Legacy Automate (Medium Risk)
Once the unified `apps/api` and `apps/web` serve all Automate features (Chat, Connectors, Vault), the legacy monorepo can be removed.

### Actions
- Remove the `Automate/` directory entirely.
- Update root `package.json` to remove the `Automate/` workspace pattern.

### Validation
- Run `pnpm verify` across the unified platform.
- Run `docker compose -f docker-compose.unified.yml up` with healthchecks.
- Verify Chat and Connector functionality in the Unified Web UI.

### Rollback
- Restore `Automate/` directory from git history.

---

## Phase 3 — Remove Legacy Dashboard (Medium Risk)
The legacy dashboard apps are replaced by the unified modules.

### Actions
- Remove `Automate/apps/server/`.
- Remove `Automate/apps/client/`.
- Remove `Automate/docs-site/`.
- **Note**: DO NOT remove `Automate/packages/` in this phase.

### Validation
- Run `pnpm verify`.
- Verify Runs/Tests/Analytics functionality in the Unified Web UI.
- Ensure the Playwright reporter can still connect to the Unified API.

### Rollback
- Restore removed directories from git history.

---

## Phase 4 — Consolidate Packages (Low Risk)
Final cleanup of the legacy directory structure.

### Actions
- Move `Automate/packages/reporter/` to root `packages/reporter/`.
- Move `Automate/packages/cli/` to root `packages/cli/`.
- Update all internal workspace references to these packages.
- Update npm publish configurations for the reporter and CLI.
- Remove the now-empty `Automate/` directory.

### Validation
- Run `pnpm verify`.
- Verify `pnpm --filter @automate/reporter build` and `pnpm --filter @automate/cli build` (if renamed) or their respective build commands.
- Run a sample Playwright test using the moved reporter.

### Rollback
- `git revert <commit-id>`.

---

## Validation Checklist (After Each Phase)
- [ ] `pnpm install` completes without workspace errors.
- [ ] `pnpm verify` passes (Build + Test + Lint + Typecheck).
- [ ] Docker Unified stack boots and passes healthchecks.
- [ ] E2E Vertical Slice test passes against the Unified stack.

---

## Do NOT Remove
The following components must remain as part of the Unified Platform or for external compatibility:
- `packages/shared-contracts/`: Unified schema definitions.
- `packages/ui/`: Unified component library.
- `packages/db/`: Unified database migrations.
- `packages/auth/`: Unified authentication logic.
- `packages/realtime/`: Unified event bus.
- `packages/reporter/`: (Moved) Playwright reporter npm package.
- `packages/cli/`: (Moved) Dashboard CLI tool.

---

## Timeline Recommendation
It is recommended to execute these phases over separate Pull Requests (ideally one per sprint) to allow for stabilization and production monitoring of the Unified Platform between removals.
