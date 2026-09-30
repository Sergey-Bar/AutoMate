# Secret Rotation Guide

How to rotate each installation secret in this product, and what stops when you do.

## The seven secrets, and where they are declared

Every installation secret is read by `@automate/config` and validated at startup.
This table is derived from that module, not from a product that existed before the
unification — the previous version of this document named
`AUTOMATE_DASHBOARD_API_KEY` and `VAULT_PASSWORD`, neither of which is read
anywhere, and pointed at a `.automate/auth.json` and a "Settings > Access Control"
screen that do not exist.

| Secret                       | Protects                                             | Length floor | Rotate when                                          |
| ---------------------------- | ---------------------------------------------------- | ------------ | ---------------------------------------------------- |
| `COOKIE_SECRET`              | The session cookie's signing key                     | 32           | On suspicion, or on operator offboarding             |
| `SESSION_SECRET`             | Session token hashing                                | 32           | With `COOKIE_SECRET`                                 |
| `VAULT_SECRET`               | PBKDF2 key material for sealed connector credentials | 32           | Quarterly, and immediately on any suspected exposure |
| `AUTOMATE_API_KEY`           | Bearer access to the API                             | 32           | Quarterly                                            |
| `REPORTER_SECRET`            | Producer ingestion on the reporter routes            | 32           | Quarterly, and when a producer is decommissioned     |
| `RUNNER_REGISTRATION_SECRET` | Runner enrollment                                    | 32           | When a runner is decommissioned                      |
| `KILO_API_KEY`               | The Kilo model gateway                               | 32           | Per the provider's own schedule                      |

**One floor, enforced once.** `SECRET_MIN_LENGTH` in `packages/config/src/config.ts`
is 32 for all seven. It used to be two thresholds — 32 for three of them and 16 for
the rest — which meant the weakest credential in the system set the bar for
everything else. `apps/api/src/startup-policy.ts` imports the constant rather than
restating the number, so the two cannot drift.

**Placeholders are refused in production.** `isSecretPlaceholder` matches a small
set of documented development values exactly, plus two cookie-secret fragments.
Startup refuses a configuration still carrying one when `NODE_ENV=production`, so
the check is a refusal rather than a warning. That is why a rotation that ends with
the old placeholder silently still in place does not start.

## Rotation, by secret

### `COOKIE_SECRET` and `SESSION_SECRET`

1. Generate two random 32-character-or-longer values.
2. Set both environment variables and restart the API.

**Impact:** every session is invalidated. Users sign in again. There is no
graceful overlap, because a cookie signed by two keys is a cookie whose validity
depends on which key the verifier tried first.

**Verify:** `GET /api/v1/health` answers 200, and a fresh sign-in produces a cookie
that a second sign-in with the old value cannot.

### `VAULT_SECRET`

1. Generate a new value of 32 characters or more.
2. Set `VAULT_SECRET` and restart.

**Impact — read this one twice.** The vault's ciphertext is bound to its row
identity by GCM additional authenticated data, and the key is derived from
`VAULT_SECRET` by PBKDF2. **Rotating the secret without re-sealing makes every
sealed row unopenable.** The rehearsal tooling exists for exactly this class of
change (`pnpm migrate:rehearse`, `never-in-ci` because it needs a live second
database) and the honest sequence is: snapshot the database, re-seal every sealed
row with the new key, then rotate.

**Verify:** every sealed row opens through the product's own `openSecret`. A count of
zero rows verified is a failure, not a pass — an empty table and a query that
matched the wrong shape look identical from the outside.

### `AUTOMATE_API_KEY`

1. Set the new value and restart the API.
2. Update every client: CI jobs, runner configuration, scripts.

**Impact:** callers using the old key get `401` immediately. Unlike a session
cookie, this is a single credential with no per-client state, so the transition is
as long as you want it to be.

**Verify:** `curl -H "authorization: Bearer $AUTOMATE_API_KEY" /api/v1/features`
answers 200, and the old value answers 401.

### `REPORTER_SECRET`

1. Set the new value on the API and restart it.
2. Update the reporter configuration in every Playwright or JUnit job.
3. Run one test job and confirm the result appears on the run's evidence surface.

**Impact:** producers configured with the old secret are rejected at ingestion.
There is no queue to drain — ingestion is an HTTP POST per batch, so a producer that
is mid-run simply fails its next batch.

**Note on the transport:** reporters do not hold a WebSocket open. They POST batches
to the reporter routes; the realtime transport is SSE, server-to-client only, and is
described in [ADR-002](../adr/002-sse-over-a-durable-outbox.md). The previous
version of this document told an operator to grep server logs for a
`[reporter] ws-reporter connected` line that no code emits.

### `RUNNER_REGISTRATION_SECRET`

1. Set the new value and restart the API.
2. Re-enroll every runner with the new value.

**Impact:** a runner that has not re-enrolled cannot lease jobs. Existing leases are
rows in `execution_jobs` with a `lease_owner` and a fencing token, so a runner that
comes back with a new identity is distinguishable from one that is merely slow.

**Verify:** `GET /api/v1/runners` lists the runners, and a job that was claimed
before the rotation completes under its original owner.

### `KILO_API_KEY`

1. Set the new value and restart the API.

**Impact:** the gateway falls back to its unconfigured answer. `aiGatewayOrUnconfigured`
returns an explicit `501` naming the provider rather than a stub completion, so a
chat request fails visibly instead of appearing to succeed.

## After any rotation

- `pnpm security:secrets` over the working tree, and
  `pnpm security:secrets:history` over the history, if the value was ever committed
  by mistake.
- `GET /api/v1/ready` answering 200, which now reports the store's own degraded
  dependencies and not only whether a socket answers.

## Docker deployments

1. Update the secret in your `.env` file or secret store.
2. Recreate the containers:
   ```bash
   docker compose -f docker-compose.unified.yml up -d --force-recreate
   ```
3. `GET /api/v1/ready` on the published API port, and check the API logs for
   `startup-policy` refusals.

Never bake a secret into an image. `docker-compose.unified.yml` reads
`POSTGRES_PASSWORD` from the environment with a `:?` guard, so a compose run with no
value fails rather than starting a database with an empty password.
