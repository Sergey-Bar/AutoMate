---
title: Configuration
description: Environment variables and feature flags reference.
---

Automate is configured entirely through environment variables. No config files, no YAML schemas to learn. Set vars in your shell, `.env` file, or Docker Compose's `environment` block.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | HTTP server port. Serves the SPA, REST API, and browser WebSocket. |
| `REPORTER_PORT` | `4001` | Reporter WebSocket port. CI machines connect here to stream test events. |
| `HOST` | `0.0.0.0` | Network interface to bind. Use `127.0.0.1` to restrict to localhost only. |
| `NODE_ENV` | `development` | Runtime mode. Set to `production` for deployed environments. |
| `AUTOMATE_DASHBOARD_API_KEY` | _(required)_ | Secret key for dashboard login and reporter authentication. |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed origins for WebSocket connections. Set this to your dashboard's origin in production. |
| `DATA_DIR` | `./data` | Directory for the SQLite database (`dashboard.db`). |
| `ARTIFACTS_DIR` | `./test-results` | Directory where screenshots, videos, and traces are stored. |
| `AUTOMATE_DASHBOARD_URL` | `ws://localhost:4001` | WebSocket URL the reporter connects to (set in CI). |
| `REPORTER_SECRET` | _(empty)_ | Shared secret for reporter WebSocket authentication. When set, reporters must provide this token to connect. |
| `COOKIE_SECRET` | `automate-dev-secret` | Key used to sign session cookies. |
| `SENTRY_DSN` | _(empty)_ | Sentry DSN for server-side error reporting. |
| `LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error`. |
| `PUBLIC_DASHBOARD_URL` | _(empty)_ | Public URL sent in Slack and Jira notifications. |

## Feature Flags

Automate uses a feature flag system to keep the default install focused on the MVP flow. MVP features are enabled by default; post-MVP capabilities are disabled by default and should be enabled only for a specific design-partner workflow.

### MVP Features

| Feature | Env Variable | Default |
|---------|-------------|---------|
| Live Monitoring | `FEATURE_LIVE_RUN_MONITORING` | `true` |
| Test Explorer | `FEATURE_TEST_EXPLORER` | `true` |
| Analytics | `FEATURE_ANALYTICS_DASHBOARD` | `true` |
| Artifact Viewers | `FEATURE_ARTIFACT_VIEWERS` | `true` |
| Quality Gate | `FEATURE_QUALITY_GATE` | `true` |

### Post-MVP Workflow Features

Set these to `true` to validate the workflow with a design partner:

| Feature | Env Variable | Default |
|---------|-------------|---------|
| Run Comparison | `FEATURE_RUN_COMPARISON` | `false` |
| Integration Hooks | `FEATURE_INTEGRATION_HOOKS` | `false` |
| Command Palette | `FEATURE_COMMAND_PALETTE` | `false` |
| Auto Quarantine | `FEATURE_AUTO_QUARANTINE` | `false` |
| Natural Language Query | `FEATURE_NL_QUERY` | `false` |
| Error Clustering | `FEATURE_ERROR_CLUSTERING` | `false` |
| Impact Analysis | `FEATURE_IMPACT_ANALYSIS` | `false` |
| AI Explain | `FEATURE_AI_EXPLAIN` | `false` |
| Scheduled Runs | `FEATURE_SCHEDULED_RUNS` | `false` |
| Codegen Launcher | `FEATURE_CODEGEN_LAUNCHER` | `false` |
| PR Comparison | `FEATURE_PR_COMPARISON` | `false` |
| Baseline Management | `FEATURE_BASELINE_MANAGEMENT` | `false` |
| Known Failure Tracking | `FEATURE_KNOWN_FAILURE_TRACKING` | `false` |
| Terminal Runner | `FEATURE_TERMINAL_RUNNER` | `false` |

### Intelligence Features (Experimental)

Set these to `true` to enable experimental capabilities:

| Feature | Env Variable | Default |
|---------|-------------|---------|
| MCP Server | `FEATURE_MCP_SERVER` | `false` |
| MCP Gateway | `FEATURE_MCP_GATEWAY` | `false` |
| MCP Playwright | `FEATURE_MCP_PLAYWRIGHT` | `false` |
| Failure Taxonomy | `FEATURE_FAILURE_TAXONOMY` | `false` |
| Predictive Selection | `FEATURE_PREDICTIVE_TEST_SELECTION` | `false` |
| Role-based Views | `FEATURE_ROLE_BASED_VIEWS` | `false` |
| Locator Intelligence | `FEATURE_LOCATOR_INTELLIGENCE` | `false` |
| Test Generation | `FEATURE_TEST_GENERATION` | `false` |
| Screenshot Diff | `FEATURE_SCREENSHOT_DIFF` | `false` |
| Looks Same Diff | `FEATURE_LOOKS_SAME_DIFF` | `false` |
| Frequent Failures | `FEATURE_FREQUENT_FAILURES` | `false` |
| Checks Annotations | `FEATURE_CHECKS_ANNOTATIONS` | `false` |

## Example `.env`

```bash
# Server
PORT=4000
REPORTER_PORT=4001
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info

# Storage
DATA_DIR=/app/data
ARTIFACTS_DIR=/app/test-results

# Security
CORS_ORIGIN=https://qa.example.com

# Notifications
PUBLIC_DASHBOARD_URL=https://qa.example.com

# Optional: error reporting
# SENTRY_DSN=https://abc123@o0.ingest.sentry.io/0

# Optional: enable post-MVP features for a design partner
# FEATURE_AUTO_QUARANTINE=true
# FEATURE_ERROR_CLUSTERING=true
# FEATURE_AI_EXPLAIN=true
```

Copy this to `.env` in your project root and adjust as needed. Docker Compose picks it up automatically with `env_file: .env`.
