# Local Deployment

The canonical local deployment for the universal QA slice is `infra/compose/docker-compose.unified.yml`. It starts PostgreSQL and the SeaweedFS object store, runs additive Drizzle migrations, then starts the API, worker, Playwright runner, web UI, and the edge proxy in front of them. Artifact bytes are stored in the object store; only metadata and checksums are stored in PostgreSQL.

```bash
docker compose -f infra/compose/docker-compose.unified.yml build
docker compose -f infra/compose/docker-compose.unified.yml up -d --wait
docker compose -f infra/compose/docker-compose.unified.yml ps
```

`pnpm compose:boot` does the same from nothing with random secrets, probes the stack, and removes it again; the `Compose boot` CI job runs it on every pull request.

The service dependencies are ordered by health checks: PostgreSQL and the object store must be healthy, the migration job must complete, and the API must be ready before the worker, runner, web UI and edge proxy start.

The stack publishes **one** port, the edge proxy, on loopback:

- `http://localhost:8080` — the web UI at `/` and the API at `/api/`.

`AUTOMATE_PORT` changes the port. `AUTOMATE_BIND=0.0.0.0` makes it reachable from other machines; the install has no login in front of it, so do that only on a network you trust. PostgreSQL, the API and the object store are reachable on the compose network only. `compose.dev.yml` publishes each of them for a developer's tools.

Use `infra/compose/.env.compose.example` as the variable checklist. Every secret in it needs at least 32 characters — the single floor `SECRET_MIN_LENGTH` in `packages/config`, which `apps/api/src/startup-policy.ts` imports rather than restating — and must not be one of the placeholders the startup policy refuses by name. `AUTOMATE_API_KEY`, `REPORTER_SECRET`, and `RUNNER_REGISTRATION_SECRET` are separate credentials. `AUTOMATE_INSTALLATION_KEY` is required for a production boot and is the key you sign in with. `COOKIE_SECRET`, `VAULT_SECRET`, and `ARTIFACT_ROOT` must be supplied for a persistent local deployment. Production additionally requires `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_BUCKET`, `OBJECT_STORE_REGION`, `OBJECT_STORE_ACCESS_KEY_ID`, and `OBJECT_STORE_SECRET_ACCESS_KEY`; the API refuses to start without that durable S3-compatible artifact store. HTTPS is required unless `OBJECT_STORE_ALLOW_INSECURE=true` is explicitly set for a private development store. During a storage cutover, set `ARTIFACT_READ_FALLBACK_ROOT` to a mounted copy of the legacy artifact directory; remove it after the fallback window closes. Do not commit `.env` files or secret values.

Compose reads its `.env` from the compose file's own directory, so for this stack copy
`infra/compose/.env.compose.example` to `infra/compose/.env` (ignored by git), or export the
variables in your shell.

Stop services without deleting evidence:

```bash
docker compose -f infra/compose/docker-compose.unified.yml down
```

Delete only the disposable local database and artifact volumes with `down -v` after confirming that the evidence is no longer needed.

## Readiness and rollback

`/health` is liveness. `/api/v1/ready` is readiness and must fail when PostgreSQL or required runtime dependencies are unavailable. Rollback is non-destructive: stop the worker and runner, route the web app back to the prior dashboard, and leave additive tables and artifact evidence in place.
