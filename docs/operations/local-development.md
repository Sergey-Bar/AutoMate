# Running the product on one machine

How to bring the whole product up on a workstation and check that it works. Every command here
is a root script or a documented tool; nothing below is a step someone has to remember.

## What runs

| Process | Started by                                | Listens on    | Needs                         |
| ------- | ----------------------------------------- | ------------- | ----------------------------- |
| API     | `pnpm dev:all`                            | `:3000`       | PostgreSQL, the secrets below |
| Web     | `pnpm dev:all`                            | `:5173`       | the API for `/api`            |
| Worker  | `pnpm dev:all`                            | `:3001`       | PostgreSQL                    |
| Runner  | `pnpm dev:all`                            | `:3002`       | the API, a Chromium           |
| Local   | `node local/bin/automate-local.mjs serve` | a random port | nothing; see `docs/local/`    |

The worker and runner health ports bind to loopback by default in `.env.example`. The runner
waits up to two minutes for the API, so the order the four start in does not matter.

## First time

1. `pnpm install`
2. A PostgreSQL 16 on `localhost:55432` with database, user and password `automate` / `automate` /
   your choice. The compose file `infra/compose/compose.dev.yml` describes one; any PostgreSQL 16 works.
3. `cp .env.example .env`, then replace the five `replace-with-…` secrets with random values of at
   least 32 characters (`COOKIE_SECRET`, `VAULT_SECRET`, `AUTOMATE_API_KEY`, `REPORTER_SECRET`,
   `RUNNER_REGISTRATION_SECRET`) and set `DATABASE_URL`. `.env` is git-ignored, and the API, worker
   and runner all read it.
4. `pnpm db:migrate`
5. `pnpm exec playwright install chromium` (the runner executes jobs in a real browser)
6. `pnpm dev:all`

Check it: `pnpm smoke:local` should print `PASS` for the API and the web root. Queue a run from the
dashboard, or `POST /api/v1/runs`, and the runner picks it up.

## When something is wrong

- **The API refuses to start and names a secret.** The startup policy rejects missing or
  placeholder secrets. Fix `.env`; do not set `AUTOMATE_ALLOW_DEV_SECRETS` on a machine anyone else
  can reach.
- **A runner says `RUNNER_ID_TAKEN`.** Its `RUNNER_INSTANCE_ID` is registered and its credential is
  still live. It restarts cleanly inside the credential's 15 minutes and again after it lapses; the
  only way to see this is two live runners sharing one id. Give the second a different id.
- **`pnpm test:e2e` fails with 403s on `/api/v1/reporter/events`.** A real `.env` is being read by
  the API the suite starts, so its `REPORTER_SECRET` differs from the suite's. Move `.env` aside for
  the run. The suite also needs `DATABASE_URL` and refuses to run without it.
- **Stopping.** The API handles SIGTERM and SIGINT: it stops accepting, lets requests finish for
  five seconds, cuts off event streams that are still open, closes the pool and exits 0 (1 if
  something failed to close or eight seconds passed).

## Checking a change

| Question                                    | Command                 |
| ------------------------------------------- | ----------------------- |
| Does it pass everything CI runs?            | `pnpm verify`           |
| Same, on a host without semgrep or gitleaks | `pnpm verify:local`     |
| Does the product work against PostgreSQL?   | `pnpm test:e2e`         |
| Did the API's routes or contracts change?   | `pnpm openapi:generate` |
| What is still open?                         | `pnpm findings:check`   |

`pnpm test:e2e` includes the full-loop spec, which starts the shipped worker and runner as real
processes and waits out a 30 second lease, so it takes about three minutes.
