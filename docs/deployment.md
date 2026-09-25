# Local Deployment

The canonical local deployment for the universal QA slice is `docker-compose.unified.yml`. It starts PostgreSQL, runs additive Drizzle migrations, then starts the API, worker, Playwright runner, and web services. Artifact bytes are stored in the `artifact_data` volume; only metadata and checksums are stored in PostgreSQL.

```bash
pnpm install --frozen-lockfile
docker compose -f docker-compose.unified.yml build
docker compose -f docker-compose.unified.yml up -d
docker compose -f docker-compose.unified.yml ps
```

The service dependencies are ordered by health checks: PostgreSQL must be healthy, the migration job must complete, and the API, worker, runner, and web services must become ready before a vertical-slice test is run.

The local endpoints are:

- Web: `http://127.0.0.1:53173`
- API: `http://127.0.0.1:53000`
- PostgreSQL: `127.0.0.1:55432`

Use `.env.example` as the variable checklist. `AUTOMATE_API_KEY`, `REPORTER_SECRET`, and `RUNNER_REGISTRATION_SECRET` are separate credentials. `COOKIE_SECRET`, `VAULT_SECRET`, and `ARTIFACT_ROOT` must be supplied for a persistent local deployment. Production additionally requires `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_BUCKET`, `OBJECT_STORE_REGION`, `OBJECT_STORE_ACCESS_KEY_ID`, and `OBJECT_STORE_SECRET_ACCESS_KEY`; the API refuses to start without that durable S3-compatible artifact store. HTTPS is required unless `OBJECT_STORE_ALLOW_INSECURE=true` is explicitly set for a private development store. During a storage cutover, set `ARTIFACT_READ_FALLBACK_ROOT` to a mounted copy of the legacy artifact directory; remove it after the fallback window closes. Do not commit `.env` files or secret values.

Stop services without deleting evidence:

```bash
docker compose -f docker-compose.unified.yml down
```

Delete only the disposable local database and artifact volumes with `down -v` after confirming that the evidence is no longer needed.

## Readiness and rollback

`/health` is liveness. `/api/v1/ready` is readiness and must fail when PostgreSQL or required runtime dependencies are unavailable. Rollback is non-destructive: stop the worker and runner, route the web app back to the prior dashboard, and leave additive tables and artifact evidence in place.
