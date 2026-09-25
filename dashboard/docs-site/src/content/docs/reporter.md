---
title: Reporter Setup
description: Install and configure @automate/reporter to stream Playwright results to Automate.
---

`@automate/reporter` is a custom Playwright reporter that streams test events to the Automate over WebSocket. It runs alongside your existing reporters and adds zero overhead to test execution time.

## Installation

```bash
# npm
npm install -D @automate/reporter

# pnpm
pnpm add -D @automate/reporter

# yarn
yarn add -D @automate/reporter
```

## Configuration

Add `@automate/reporter` to your `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],                // keep terminal output
    ['@automate/reporter'],   // stream to Automate
  ],
});
```

You can pass options directly in the config:

```ts
export default defineConfig({
  reporter: [
    ['list'],
    ['@automate/reporter', {
      port: 4001,            // reporter WebSocket port (default: 4001)
      host: 'localhost',     // Automate server host (default: localhost)
      runId: 'my-custom-id', // override the auto-generated run ID
    }],
  ],
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `4001` | Reporter WebSocket port on the Automate server |
| `host` | `string` | `localhost` | Automate server hostname or IP |
| `runId` | `string` | auto-generated | Custom run identifier. Useful for linking runs to specific CI builds. |

## Environment Variables

Environment variables take precedence over config file options.

| Variable | Description |
|----------|-------------|
| `AUTOMATE_DASHBOARD_URL` | Full URL of the Automate server (e.g., `http://qa.example.com`). The reporter derives the WebSocket URL from this. |
| `DASHBOARD_RUN_ID` | Override the run ID. Use `$GITHUB_RUN_ID` or similar in CI to link runs to builds. |
| `PR_NUMBER` | Pull request number. Shown in the dashboard and used for PR comparison. |
| `GITHUB_REF` | Git ref (e.g., `refs/heads/main`). Set automatically by GitHub Actions. |
| `GITHUB_HEAD_REF` | Source branch for pull requests. Set automatically by GitHub Actions. |
| `GITHUB_BASE_REF` | Target branch for pull requests. Set automatically by GitHub Actions. |
| `GITHUB_ACTOR` | GitHub username that triggered the run. Set automatically by GitHub Actions. |
| `GITHUB_SHA` | Commit SHA. Links the run to a specific commit in the dashboard. |

## CI Setup

### GitHub Actions

```yaml
name: Playwright Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps

      - name: Run tests
        env:
          AUTOMATE_DASHBOARD_URL: ${{ secrets.AUTOMATE_DASHBOARD_URL }}
          DASHBOARD_RUN_ID: ${{ github.run_id }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          GITHUB_SHA: ${{ github.sha }}
          GITHUB_ACTOR: ${{ github.actor }}
        run: npx playwright test
```

Set `AUTOMATE_DASHBOARD_URL` as a repository secret in GitHub Settings. Everything else is available as a built-in GitHub Actions variable.

### GitLab CI

```yaml
playwright:
  image: mcr.microsoft.com/playwright:v1.49.0-noble
  script:
    - npm ci
    - npx playwright test
  variables:
    AUTOMATE_DASHBOARD_URL: $AUTOMATE_DASHBOARD_URL
    DASHBOARD_RUN_ID: $CI_PIPELINE_ID
    PR_NUMBER: $CI_MERGE_REQUEST_IID
    GITHUB_SHA: $CI_COMMIT_SHA
    GITHUB_ACTOR: $GITLAB_USER_LOGIN
  only:
    - merge_requests
    - main
```

Add `AUTOMATE_DASHBOARD_URL` as a masked CI/CD variable in your GitLab project settings.

## Event Types

The reporter sends these WebSocket events to the Automate server:

| Event | Payload | Description |
|-------|---------|-------------|
| `run:start` | run metadata, env vars, git info | Fired once when the test suite begins |
| `test:begin` | test title, file, line number | Fired when a single test starts executing |
| `test:end` | test title, status, duration, error | Fired when a test finishes (pass, fail, skip, or timeout) |
| `step:begin` | step title, category, start time | Fired at the start of each Playwright action or assertion |
| `step:end` | step title, duration, error if any | Fired when a step completes |
| `stdout` | text content, test context | Captured `console.log` output from test code |
| `stderr` | text content, test context | Captured `console.error` output from test code |
| `run:end` | summary stats, duration, status | Fired once when the entire suite finishes |

## Connection Behavior

The reporter connects to the Automate server before the first test runs. If the connection fails (server unreachable), it queues all events in memory and retries the connection with exponential backoff.

This means **your tests still run even if Automate is down**. Events are buffered and flushed once the connection is restored. If the connection never succeeds, events are dropped silently — your test results are unaffected.

On shutdown, the reporter waits up to 500 ms to flush any remaining events before the process exits. This ensures the final `run:end` event always reaches the server.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `Connection refused` in reporter output | Automate server isn't running | Start the server before running tests, or set `AUTOMATE_DASHBOARD_URL` correctly |
| Events not appearing in dashboard | Wrong `AUTOMATE_DASHBOARD_URL` | Verify the URL resolves and port `4001` is reachable from your CI machine |
| Run shows as "in progress" forever | `run:end` event was lost | Check network stability; the reporter may have been killed before flushing |
| Artifacts missing | Artifacts upload happens separately | Confirm `ARTIFACTS_DIR` on the server is writable and has enough disk space |
| Duplicate runs | `DASHBOARD_RUN_ID` set to a non-unique value | Use a value that's unique per run, like `$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT` |
