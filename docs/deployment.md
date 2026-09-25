# Local Deployment

The authorized deployment target is local/sample-only. Production cutover, registry publication, credential rotation, and destructive data migration are intentionally unavailable.

## Local stack

`infra/compose/compose.dev.yml` defines loopback-only PostgreSQL, MinIO, migration, API, web, and edge services. Images must be built locally; the compose file uses `pull_policy: never` for external services.

```bash
pnpm install --frozen-lockfile
REHEARSAL_MODE=local docker compose -f infra/compose/compose.dev.yml build
REHEARSAL_MODE=local docker compose -f infra/compose/compose.dev.yml up -d
```

The local endpoints are:

- Edge: `http://127.0.0.1:58080`
- Web direct: `http://127.0.0.1:53173`
- API direct: `http://127.0.0.1:53000`
- PostgreSQL: `127.0.0.1:55432`
- MinIO API: `http://127.0.0.1:59000`
- MinIO console: `http://127.0.0.1:59001`

## Configuration

Use `packages/config` and a local environment file. Required persistent values are `DATABASE_URL`, `COOKIE_SECRET`, and `VAULT_SECRET`; `AUTOMATE_API_KEY` is a first-bootstrap input only. Never commit `.env` files or secret values.

## Stop and clean

```bash
docker compose -f infra/compose/compose.dev.yml down
docker compose -f infra/compose/compose.dev.yml down -v
```

The second command removes only the local compose volume. It does not remove pinned source snapshots or migration archives.

## Release boundary

There is no production Compose file in this branch. A future production topology requires a separately approved release plan, immutable image digests, external secret management, migration/rollback rehearsal, and an authorized remote.
