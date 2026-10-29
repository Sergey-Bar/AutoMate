<div align="center">
  <h1>Automate</h1>
  <p><strong>Every test. One clear answer.</strong></p>
  <p>A self-hosted home for test runs, evidence, and release decisions.</p>
  <p>
    <a href="https://github.com/Sergey-Bar/AutoMate/actions/workflows/unified-ci.yml"><img alt="CI" src="https://github.com/Sergey-Bar/AutoMate/actions/workflows/unified-ci.yml/badge.svg?branch=main"></a>
    <a href="https://sergey-bar.github.io/AutoMate/"><img alt="Docs" src="https://img.shields.io/badge/docs-site-555555"></a>
    <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/License-MIT-555555.svg"></a>
  </p>
</div>

<p align="center"><a href="site/guide/install.md"><strong>Get started</strong></a> &nbsp; · &nbsp; <a href="site/guide/concepts.md">Explore the concepts</a> &nbsp; · &nbsp; <a href="https://sergey-bar.github.io/AutoMate/">Documentation</a></p>

Send Automate the reports your test tools already produce — Playwright, JUnit, k6 or
OWASP ZAP. It keeps each run, retry and artifact together, then shows your team what
passed, what needs attention and what was never measured.

![The runs view](docs/assets/runs.png)

## From run to decision

| See the signal                                                           | Keep the evidence                                                 | Make the call                                                                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Compare runs and spot flaky retries without losing the original outcome. | Open traces, screenshots and reports from the run they belong to. | Read quality gates that distinguish passed, failed, unknown and not configured. |

## More capabilities

- **One result model for every producer.** Retries are recorded as `flaky`, not as passes.
- **Quality gates** that answer `unknown` or `not_configured` instead of quietly passing.
- **Quarantine** for flaky tests, with a required reason and an audit trail — set aside, never hidden. A quarantined failure excuses itself at the gate and in CI (`automate test`), and an optional per-project policy quarantines on retry-pass evidence and releases after a clean streak.
- **Live Playwright reporter and balanced CI shards.** `@automate/playwright-reporter` streams a run with failure traces; `automate shard` splits files by measured duration. An Allure results importer is on the upload door. See [how AutoMate compares](site/guide/compare.md), including what it does not do.
- **Live run updates** over server-sent events, and a runner that executes declared commands outside the API process.
- **A "Now" page** that answers "what needs me?" in five items or fewer, with focus mode, compact density, reduced motion and keyboard shortcuts (`?` lists them).
- **Scheduled reports**, daily, weekly or custom, to Slack, Microsoft Teams, Telegram, WhatsApp, Signal or the built-in inbox — see [scheduled reports](site/guide/notifications.md).
- **One server for your whole network.** `AUTOMATE_LAN_MODE=1` turns on sign-in everywhere, HTTPS with a local certificate, device pairing by QR code, a client allowlist and remote runners — see [LAN mode](site/guide/lan-mode.md).

## Why it is interesting to an SDET

The repository is built the way it asks you to test: every fix starts as a test watched
failing first, coverage and complexity are **ratchets** that can only improve, and every
confirmed defect is a row in a machine-checked
[findings ledger](docs/quality/findings-ledger.json). See
[how this repository tests itself](site/guide/testing-strategy.md) and
[how it is maintained](site/guide/maintenance.md).

## Quick start

You need [Docker](https://docs.docker.com/get-docker/) and nothing else.

1. Download `automate-<version>.zip` from the
   [latest release](https://github.com/Sergey-Bar/AutoMate/releases/latest) and unzip it.
2. Start Docker.
3. Run **`start.cmd`** on Windows (double-click it) or **`./start.sh`** on macOS and Linux.

Your browser opens `http://localhost:8080`, and the terminal prints the key to sign in with.
`stop`, `update` and `uninstall` work the same way; [Install](site/guide/install.md) has the
details. To send a report from CI, see [sending results](site/guide/sending-results.md).

### From source

Requires Node.js 24 and pnpm 11 (`corepack enable` provides it). This runs on the
in-memory store, so nothing else needs installing.

```bash
pnpm install --frozen-lockfile

# Terminal 1: the API
NODE_ENV=development \
AUTOMATE_API_KEY=local-installation-key-32-characters \
COOKIE_SECRET=local-cookie-secret-32-characters-long \
REPORTER_SECRET=local-reporter-secret-32-characters \
pnpm --filter @automate/api dev

# Terminal 2: the console
pnpm --filter @automate/unified-web dev
```

Open `http://localhost:5173`. Sign in with `local-installation-key-32-characters` if asked.
[Getting started](site/guide/getting-started.md) has the PowerShell version and the
PostgreSQL stack, and [sending results](site/guide/sending-results.md) shows the one
`curl` that gets a report from CI into a run.

## Documentation

| Read                                                         | For                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| [Core concepts](site/guide/concepts.md)                      | Runs, attempts, results and evidence                     |
| [Quality gates and quarantine](site/guide/quality-gates.md)  | How a run is judged, and how flaky tests are handled     |
| [Architecture](site/architecture.md)                         | The runtime, the evidence chain and the tenancy boundary |
| [Capability register](docs/migration/capability-register.md) | What is implemented, partial or not built yet            |
| [Documentation index](docs/README.md)                        | Everything else, including ADRs and quality records      |

## Contributing

Start with [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md). Before a pull request, run `pnpm verify`
(or `pnpm verify:local` on a machine without `semgrep` and `gitleaks`). Security reports go
through [`.github/SECURITY.md`](.github/SECURITY.md).

## License

[MIT](LICENSE) © 2026 Automate Platform Contributors
