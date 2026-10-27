# Run it for an organisation

This page is for the person who runs Automate for several teams: the `team` and `enterprise`
[profiles](/guide/profiles). Automate is one server on one host, by design
([ADR-006](https://github.com/Sergey-Bar/AutoMate/blob/main/docs/adr/006-single-node-single-tenant-self-hosted.md)).
There is no cluster and no failover. What this page gives you is a single node that is
backed up, watched and auditable, and that you can rebuild from a backup.

## The host

- **One machine with Docker.** The release stack runs the API, the web console, the worker, a
  runner, PostgreSQL 16 and an S3-compatible object store on it. Size it from what you
  observe: the [performance thresholds](https://github.com/Sergey-Bar/AutoMate/blob/main/tests/performance)
  were recorded on a single-node reference install, not on a sizing study.
- **Reached through Cloudflare Tunnel or your own reverse proxy**, never by a published port
  on the open internet. See [remote access](/guide/remote-cloudflare).
- **Managed PostgreSQL or object storage** is not wired by the start scripts. The bundled
  `compose.yml` points the API at its own `postgres` and `objectstore` services. To use a
  managed service, run the API image yourself with `DATABASE_URL` and the `OBJECT_STORE_*`
  settings. The startup policy refuses a production composition that is missing either.

## Sign-in and people

1. Configure OIDC with your identity provider (`OIDC_*` in `.env`; see
   [profiles](/guide/profiles#team)), or put Cloudflare Access in front with SAML.
2. Start with `--profile enterprise`. Single sign-on is then the only way a browser signs in,
   and the install will not start without an identity provider configured.
3. Connect SCIM so that people are created, have their roles changed and are removed from
   your identity provider. If Cloudflare Access is in front, give `/scim/v2` a _Bypass_
   policy: the SCIM token is the credential there.
4. Create a workspace per team on _Map → Deployment_. Each team's CI gets an `uploader` token
   issued inside its own workspace.

**Break-glass.** If the identity provider is down, set `AUTOMATE_BREAK_GLASS=1` in `.env` and
run `./start.sh` again. The installation key then signs a browser in, and every use is
logged and written to the audit trail. Remove the setting and restart once single sign-on
is back. Keep the installation key somewhere that does not depend on the identity provider.

## Backups on a schedule

`backup` writes the database, the stored artifacts and `.env` to `backups/automate-<time>`,
with a digest of each. `--keep N` then removes all but the newest `N` backups. It only
removes folders that `backup` itself named; anything else in `backups/` is left alone.

On Linux or macOS, as the user that owns the install folder (`crontab -e`):

```sh
# Every night at 02:30, keeping two weeks.
30 2 * * * cd /opt/automate && ./start.sh backup --keep 14 >> backups/backup.log 2>&1
```

On Windows, as the user who runs Docker Desktop (the task runs while that user is signed in):

```powershell
schtasks /Create /TN "Automate backup" /SC DAILY /ST 02:30 `
  /TR "cmd /c cd /d C:\automate && start.cmd backup --keep 14 >> backups\backup.log 2>&1"
```

A backup holds `.env`, which means it holds the secrets. Copy each backup off the host, for
example with `rclone` or `aws s3 sync` in the same scheduled job, to storage that only the
operators can read.

**Rehearse a restore.** A backup you have never restored is a hope. Once a quarter, unpack
the release on a spare machine, copy a backup folder into it, and run
`./start.sh restore backups/automate-<time>`. The restore checks every digest, the vault key,
the release and the schema before it changes anything, and it says which one failed.

## Watching it

- **Liveness and readiness.** `GET /api/v1/health` and `GET /api/v1/ready` through the front
  door. Readiness runs a real database query.
- **Request traces over OTLP.** Set `OTEL_EXPORTER_OTLP_ENDPOINT` to your collector's
  OTLP/HTTP address, for example `https://otel.example.com`. The API then sends one server
  span per request to `<endpoint>/v1/traces`, every five seconds and once more on shutdown.
  A span is named by its route pattern (`GET /api/v1/runs/:runId`) and carries the method,
  the status, the request id and its timing. It never carries the path with its ids, the
  query, a header, a body or a person. A `traceparent` header from your proxy joins its trace.
  `OTEL_EXPORTER_OTLP_HEADERS=authorization=Basic%20...` authenticates to a hosted collector,
  and `OTEL_SERVICE_NAME` renames the service. A wrong setting is logged at start-up and
  leaves export off; it never stops the API.
- **Metrics.** The API serves Prometheus text at `/metrics`, inside the compose network
  (`http://api:3000/metrics`). The front door does not publish it, so the scraper runs on the
  same network.
- **Errors.** `SENTRY_DSN` reports server errors, with cookies, headers, bodies and local
  variables switched off in code.

## The audit trail

Every decision is a row chained to the one before it, and the database refuses edits and
deletes. Once a month, an admin exports the trail from _Map → Audit_ (or
`GET /api/v1/audit/export`) and files the **head hash** the export ends with somewhere
Automate cannot write to. That hash is what later proves the trail was not rewritten up to
that point. `pnpm audit:verify` checks every workspace's chain against the database and exits
non-zero on a break.

## Upgrades

1. `./start.sh backup`.
2. `./start.sh update` (or `--version X` to pick one). Migrations run on start, in order.
3. Check _Map → Deployment_ and the readiness probe.

A restore refuses a backup from a newer release than the install, so roll back by updating to
the older version first, then restoring.

## What this does not give you

- High availability: one host, so a host outage is an outage. Recovery is a restore on
  another host.
- Tested sign-in against your provider: OIDC, SAML through Cloudflare Access and SCIM were
  proven against in-process stand-ins written to the specifications, not against a real
  Entra, Okta or Cloudflare account. Try sign-in, provisioning and deprovisioning on a
  staging install before you rely on them.
- Metrics or traces about your test data: telemetry describes the service, not the runs in it.
