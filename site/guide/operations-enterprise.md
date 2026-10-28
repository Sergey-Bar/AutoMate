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
with a digest of each. It writes into a hidden `backups/.automate-<time>.partial` first and
renames it once the last file is in, so a backup that fails part-way leaves nothing behind:
no half a backup for `--keep` to count, and no stray copy of the database. `--keep N` then
removes all but the newest `N` backups. It only removes folders that `backup` itself named;
anything else in `backups/` is left alone.

The database is dumped as one consistent snapshot, but the artifacts are copied while the
object store runs, so an upload still arriving at that moment may not be whole in the copy.
Schedule backups for a time when no runs are uploading.

On Linux or macOS, as the user that owns the install folder (`crontab -e`):

```sh
# macOS: cron's PATH is /usr/bin:/bin, which has no docker in it.
PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin
# Every night at 02:30, keeping two weeks.
30 2 * * * cd /opt/automate && mkdir -p backups && ./start.sh backup --keep 14 >> backups/backup.log 2>&1
```

`mkdir -p backups` comes first because the shell opens the log before `start.sh` runs: on an
install with no backup yet, the redirect would fail and the backup would never start. If
`which docker` prints a folder that is not on that `PATH`, add it.

On Windows, as the user who runs Docker Desktop (the task runs while that user is signed in):

```powershell
schtasks /Create /TN "Automate backup" /SC DAILY /ST 02:30 `
  /TR "cmd /c cd /d C:\automate && (mkdir backups 2>nul & .\start.cmd backup --keep 14 >> backups\backup.log 2>&1)"
```

`mkdir backups 2>nul` creates the folder the log goes into, and says nothing when it is already
there.

A backup holds `.env`, which means it holds the secrets. Copy each backup off the host, for
example with `rclone` or `aws s3 sync` in the same scheduled job, to storage that only the
operators can read.

**Rehearse a restore.** A backup you have never restored is a hope. Once a quarter, do on a
spare machine what you would do on a new host after losing this one:

1. Unpack the release the backup was taken on, and copy the backup folder into its `backups/`.
2. Copy the backup's `env` file to `.env` **before the first start**. The database keeps the
   `POSTGRES_PASSWORD` it was first started with, and a backup holds no database roles, so
   every secret has to be the backup's from the start.
3. Run `./start.sh`, then `./start.sh restore backups/automate-<time>`.

The restore checks every digest, the vault key, the release and the schema before it changes
anything, and it says which one failed. It then loads the backup into a new database beside the
install's own and swaps it in only once it is whole, so a restore that fails part-way starts the
install again on its own data. An older backup is fine: the newer release's migrations run
forward on start. The database it replaced is kept as `automate_previous` until the next
restore, and the restore prints the command that drops it.

**Restoring onto an install that has already run.** Keep a copy of its `.env`, then set only
`VAULT_SECRET` in it to the value in the backup's `env`: the stored credentials are sealed with
it. Copying the whole file over would also bring the backup's `POSTGRES_PASSWORD`, which this
install's database does not follow, and the install would be locked out of it. The other
differences are harmless: people sign in again if `COOKIE_SECRET` differs, sign-in keeps using
this install's `AUTOMATE_INSTALLATION_KEY`, and access tokens and SCIM tokens keep working. If
the restore stops before it replaces anything, put your own `VAULT_SECRET` back: the install is
running on its own data again.

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
deletes, including a `TRUNCATE` of the table. The chain covers the event itself: who did it,
what, when, to which resource, and the details. It does not cover the request the event came in
on. The IP address, user agent and request id are exported beside each row, as is the time the
row was written (`created_at`), and an edit to any of them made behind the database's guards
would not show as a break.

Once a month, an admin files the **head**, the position and hash of the newest row, somewhere
Automate cannot write to. It is the last line of the NDJSON export on _Map → Audit_ (or
`GET /api/v1/audit/export`), and `head` in `GET /api/v1/audit/verify`; the CSV export has no
head line. To check a filed head later, find the row at that position in a new export: its hash
must still be the one you filed. That is what proves the trail was not rewritten up to that
point, even by someone who can switch the database's guards off.

To check every workspace's chain against the database, run this in the install folder. The
project is `automate` unless you set `AUTOMATE_PROJECT`.

```sh
docker compose -p automate --env-file .env -f compose.yml run --rm --no-deps --entrypoint node migrate dist/audit-verify.js
```

It exits 0 on an intact trail, 1 on a break, naming each broken row, and 2 when it cannot read
the database. From a source checkout, `pnpm audit:verify` runs the same check against
`DATABASE_URL` once `pnpm build` has run.

## Upgrades

1. `./start.sh backup`.
2. `./start.sh update` (or `--version X` to pick one). Migrations run on start, in order.
3. Check _Map → Deployment_ and the readiness probe.

**Rolling back.** Move to the release you came from first, then restore the backup from step 1:

```sh
./start.sh update --version <old>              # the release you came from
./start.sh restore backups/automate-<time>     # the backup from step 1
```

The order matters. A restore starts the install on the release `.env` names, and that release
runs its migrations on the restored database, so restoring first would migrate it forward
again. On the newer schema the older release may fail to start, and `update` says so; carry on
with the restore, which only needs the database running. It loads the backup into a new
database, so the tables the newer release added do not get in its way, and it keeps the
upgraded database as `automate_previous`.

## What this does not give you

- High availability: one host, so a host outage is an outage. Recovery is a restore on
  another host, the same three steps as [rehearsing one](#backups-on-a-schedule).
- Tested sign-in against your provider: OIDC, SAML through Cloudflare Access and SCIM were
  proven against in-process stand-ins written to the specifications, not against a real
  Entra, Okta or Cloudflare account. Try sign-in, provisioning and deprovisioning on a
  staging install before you rely on them.
- Metrics or traces about your test data: telemetry describes the service, not the runs in it.
