---
outline: deep
---

# Operations

## Configuration

Everything comes from the environment, and the startup policy lives in one place:
`packages/config/src/config.ts`. It refuses placeholders and short secrets in
production rather than starting with them.

| Variable                           | Required | Purpose                                            |
| ---------------------------------- | -------- | -------------------------------------------------- |
| `AUTOMATE_API_KEY`                 | Yes      | Bearer token the web app presents. 32+ characters. |
| `COOKIE_SECRET`                    | Yes      | Session cookie signing. 32+ characters.            |
| `REPORTER_SECRET`                  | Yes      | Reporter upload authentication.                    |
| `WORKSPACE_ID`                     | Yes      | **The tenancy boundary.**                          |
| `DATABASE_URL`                     | No       | Omit to use the in-memory development store.       |
| `HOST`, `PORT`                     | No       | Bind address; `127.0.0.1:3000`.                    |
| `SENTRY_DSN`                       | No       | Source-map uploads need `SENTRY_AUTH_TOKEN` too.   |
| `KILO_GATEWAY_URL`, `KILO_API_KEY` | No       | Both, or neither. Enables `/api/v1/chat/*`.        |
| `OLLAMA_BASE_URL`                  | No       | Local provider; used when Kilo is not configured.  |

An unconfigured chat provider is **not** a startup failure. The route answers a coded
`503` and the composition root logs the reason at startup, because an optional
feature that is switched off should not be a deployment that will not start.

## Migrations

```bash
pnpm db:generate   # drizzle-kit generate
pnpm db:check      # journal and schema agree
pnpm migrate:plan  # build a plan; reads the repository, never a database
```

`pnpm migrate:apply` is deliberately **not** in `pnpm verify` and in no workflow. CI
has no persistent database, so applying a migration there proves that the statement
parses and nothing about whether it is correct.

### Rehearsing a destructive migration

D1 is "rehearse before breaking": a destructive migration does not merge until a
rehearsal has restored a post-migration database **and re-opened every encrypted
row**. A dump and restore proves the database came back. It does not prove the
ciphertexts are still readable — and a migration that renames a column the AAD is
bound to leaves a restored database that looks perfect and holds nothing anyone can
read.

```bash
pnpm migrate:rehearse -- --source <url> --restore <url>
```

The sequence is: dump the source; restore onto a **clean** instance; apply the
migration graph **to the restore**; re-open every sealed row through the product's
own `vault-crypto` module; fail if any will not open. The migration goes to the copy,
because the only data is in the source and the copy is what gets destroyed — the
command refuses a restore target equal to the source.

It needs a live second database, so it is `never-in-ci` and is not part of `verify`.
**No run of it has happened against a real installation yet — and the tenancy wave it
was gating is already in the tree**, in five migrations. That is recorded as an open
Blocker on the [Findings](/pages/quality/findings) page rather than left implicit, and
`docs/quality/wave-gates.json` is what makes it a gate rather than a sentence: it fails
when a migration exists on disk for a wave whose gating row is not `fixed`.

## What the gates mean

| Command                  | What it is                                                      |
| ------------------------ | --------------------------------------------------------------- |
| `pnpm verify`            | The whole chain. Sixteen steps.                                 |
| `pnpm verify:local`      | The same chain, scanners recorded `not_configured`.             |
| `pnpm coverage:ratchet`  | Coverage floors; fails on a regression, never on a lower floor. |
| `pnpm docs:check`        | No document cites a file that does not exist.                   |
| `pnpm docs:dead-exports` | No package exports something nothing uses.                      |
| `pnpm security:static`   | semgrep and gitleaks. Exits non-zero if it cannot scan.         |
| `pnpm test:render`       | `pr-reporting` until a baseline is recorded on real hardware.   |

## Known limits

- **Development is single-instance.** The realtime bus is process-local in the
  production composition root; the durable outbox feed exists and is tested, and the
  wiring is not finished.
- **There is no approved production topology.** The Compose assets are loopback
  development assets.
- **The rendering budget has never been measured**, so `pnpm test:render` reports
  numbers and compares nothing. That is a deliberate tier, not an oversight: a
  required check that can never pass blocks every pull request and teaches reviewers
  to read red as noise. Graduating it needs a recorded baseline on the reference
  hardware — a self-hosted single-node install, not a GitHub runner.
