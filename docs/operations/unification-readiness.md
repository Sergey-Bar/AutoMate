# Unification Readiness

The consolidation into the single **Unified Platform** is complete. The legacy
standalone product trees have been removed, and the repository is now one pnpm
workspace: `apps/{api,web}` + `packages/*` + `services/*` + `tools/*` + `e2e/*`.

`pnpm unify:preflight` now serves as a **unified-only guard**. It asserts that no
legacy references have reappeared and exits non-zero if any do. Run it locally or
in CI after changes that touch workspace, tooling, CI, deployment, or docs config.

## Run the guard

```bash
pnpm unify:preflight
```

Exit code `0` means the repository is clean unified-only. A non-zero exit lists
the offending file and the legacy reference that must be removed.

## What it guards (18 checks)

1. The legacy dashboard and AI-product directory trees are absent from the tree.
2. The deprecated iframe shell application is absent.
3. The legacy per-product CI workflows have been removed.
4. `pnpm-workspace.yaml` contains no legacy workspace globs.
5. `package.json` contains no legacy proxy scripts (`*:all` or per-product wrappers).
6. Root config (`.prettierignore`, the husky hook, commitlint, `.vscode/launch.json`)
   references only unified packages.
7. `docker-compose*.yml`, `docker/**`, and the `nginx` configs build and route only
   the unified stack (`apps/api`, `apps/web`).
8. The GitHub Actions workflows reference no legacy paths or packages.
9. The operational docs (`README`, `AGENTS`, deployment, migration) describe only the
   unified platform. Planning, architecture, and history docs may still reference
   legacy names as migration records.

Any scoped-package reference must resolve to a current workspace package
(`@automate/api`, `unified-web`, `ui`, `db`, `auth`, `realtime`, `shared-contracts`,
`migrate-cli`, `integration-tests`) or the externally-published `@automate/reporter`.

## Rollback anchor

The pre-cutover state is tagged `pre-unification-cutover`. To revert the entire
landing in one step:

```bash
git reset --hard pre-unification-cutover
```

## Related documents

- `docs/parity-matrix.md` — feature migration record
- `docs/deployment.md` — unified deployment guide
- `docs/migration-guide.md` — v1 → v2 migration steps
- `scripts/unify-preflight.mjs` — the guard implementation
- `pnpm-workspace.yaml`, `package.json`
