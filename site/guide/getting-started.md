---
outline: deep
---

# Getting started

Automate runs checks as **jobs**: a run is a job with a lease, an attempt count, and
an evidence bundle. This page gets you to a running dashboard. Everything it claims
about the product's limits is recorded on [Capabilities](/pages/capabilities), which
is generated from the repository's own register rather than written by hand.

## The ten-minute path

A budget, and a promise about what it buys. From a clean checkout with Node 24 and
pnpm 10 installed, following the "without a database" path below:

| When      | What happens                    | How you know                                                                  |
| --------- | ------------------------------- | ----------------------------------------------------------------------------- |
| 0:00      | `pnpm install`                  | It finishes without an error.                                                 |
| 1:00–2:00 | Start the API in terminal 1     | `GET http://127.0.0.1:3000/api/v1/health` answers `{"status":"healthy",...}`. |
| 2:00–3:00 | Start the web app in terminal 2 | `http://localhost:5173` loads.                                                |
| 3:00–4:00 | Sign in with the key above      | The dashboard shows the runs view.                                            |
| 4:00–5:00 | Create a run from the dashboard | The run appears, with a state and a lease.                                    |

If a step does not do what its column says, stop there — every later step depends on
it, and the table is ordered so the failure is the first unexplained thing you see.
The "with the full stack" path below takes longer and is what you want when you need
PostgreSQL, because the in-memory store keeps state in the process and loses it on
restart.

## Without a database

The API runs in development with an in-memory store, so nothing else has to be
installed first. It keeps run and dashboard state in the process, which means
restarting the API clears it — that is the trade, not a bug.

**Terminal 1 — API (PowerShell)**

```powershell
$env:NODE_ENV='development'
$env:AUTOMATE_API_KEY='local-installation-key-32-characters'
$env:COOKIE_SECRET='local-cookie-secret-32-characters-long'
$env:REPORTER_SECRET='local-reporter-secret-32-characters'
pnpm --filter @automate/api dev
```

**Terminal 1 — API (macOS/Linux)**

```bash
NODE_ENV=development \
AUTOMATE_API_KEY=local-installation-key-32-characters \
COOKIE_SECRET=local-cookie-secret-32-characters-long \
REPORTER_SECRET=local-reporter-secret-32-characters \
pnpm --filter @automate/api dev
```

The API listens on `127.0.0.1:3000` by default. Set `PORT` in **both** terminals if
you want a different one — the web dev proxy reads the same variable, so a port set
in only one of them is the case that produces a dashboard whose API calls go
nowhere with no error.

**Terminal 2 — Web**

```bash
pnpm --filter @automate/unified-web dev
```

Then open `http://localhost:5173` and sign in with
`local-installation-key-32-characters`. Verify the API at
`http://127.0.0.1:3000/api/v1/health`.

## With the full stack

The Compose file brings up the edge application, the web app, the API, PostgreSQL,
and MinIO on loopback ports:

```bash
REHEARSAL_MODE=local docker compose -f infra/compose/compose.dev.yml build
REHEARSAL_MODE=local docker compose -f infra/compose/compose.dev.yml up -d
```

| Surface          | Address                  |
| ---------------- | ------------------------ |
| Edge application | `http://127.0.0.1:58080` |
| Web direct       | `http://127.0.0.1:53173` |
| API direct       | `http://127.0.0.1:53000` |
| PostgreSQL       | `127.0.0.1:55432`        |
| MinIO API        | `http://127.0.0.1:59000` |
| MinIO console    | `http://127.0.0.1:59001` |

The compose file uses `pull_policy: never`, so the external images must already be
present locally.

## Before you open a pull request

`pnpm verify` runs the whole gate chain: preflight, formatting, lint, typecheck,
every test suite, the coverage ratchet, the build, the migration check, the
documentation drift check, and the security gates.

On a host without `semgrep` and `gitleaks`, use `pnpm verify:local`. It runs the
**same chain** with those two scanners recorded as `not_configured`. It is never run
in CI, where the scanners are installed and enforced — the opt-in exists so a
contributor without the binaries can still run the other twelve steps, not so the
security scan can be skipped.

See `CONTRIBUTING.md` for the rules, including the one that matters most: write the
test, run it with the defect still present, watch it fail for the reason you
expect, and only then fix it.

## What this does not do

The honest list is on [Capabilities](/pages/capabilities). The three that will save
you the most time:

- **Execution is a boundary, not a proven capability.** The runner SDK, state
  machine, leases, and OCI definitions exist; production execution is not proven.
- **Multi-instance is not proven.** Sessions are revocable and persisted; the
  evidence for running more than one instance is not recorded.
- **There is no approved production topology.** The Compose assets are loopback
  development assets.
