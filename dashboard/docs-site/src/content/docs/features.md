---
title: Features
description: MVP feature list and post-MVP opt-in capabilities.
---

Automate is MVP-first. The default product promise is one focused workflow: connect Playwright, stream a run, inspect failures, and gate CI. Everything outside that workflow is post-MVP and opt-in behind feature flags.

## MVP Features

These ship enabled with every install.

### Live Run Monitoring

Watch your Playwright suite execute in real-time. Each test lights up as it starts, passes, fails, or skips. The WebSocket connection from your browser to port `4000` keeps the view current without polling.

### Failure Analysis

When a test fails, you get everything you need to reproduce it:

- **Screenshot diff** — side-by-side comparison of expected vs. actual
- **Video playback** — full recording of the test session
- **Trace viewer** — Playwright's trace.playwright.dev embedded inline, no separate tab needed
- **Step timeline** — each `page.click`, `expect`, and network request with its duration

### Analytics Essentials

Historical trends across all your runs:

- Pass-rate chart over time (daily, weekly, monthly)
- Duration trends to catch performance regressions
- Recent pass-rate and duration trends
- Run-health summaries for local and CI runs

### Test Explorer

Browse your entire test suite without running it. Tests are grouped by file, describe block, or tag. Search by name, filter by status (passed, failed, flaky, skipped), and pin tests you care about.

### Quality Gate

Define a minimum pass-rate threshold. If a run falls below it, the dashboard returns a non-zero exit code and the CI step fails. Integrate this with your pipeline to block deploys when test quality drops.

```bash
# Example: fail CI if pass rate drops below 95%
QUALITY_GATE_THRESHOLD=95 npx @automate/cli check-gate --run-id $RUN_ID
```

---

## Post-MVP Features

These capabilities exist in the repository, but they are not part of the MVP promise. They are disabled by default and should be enabled only to validate a specific design-partner workflow.

### AI Explain

When a test fails, Automate calls your configured AI backend (OpenAI, Ollama, or Anthropic) and generates a plain-English explanation of why it failed. The explanation surfaces on the failure detail page alongside the stack trace and screenshot. Set `AI_EXPLAIN_PROVIDER` and the matching API key in your env to choose your backend.

Enable with `FEATURE_AI_EXPLAIN=true`.

### PR Comparison

Automate compares test results between a pull request and its base branch automatically when both run IDs are available. The diff highlights newly failing tests, newly passing tests, and duration changes. You can export the full diff as a Markdown report to post directly on the PR.

Enable with `FEATURE_PR_COMPARISON=true`.

### Run Comparison

Pick any two runs and diff them side by side. Useful for before/after validation, branch-to-main comparison, and sudden failure spikes. The diff highlights newly failing tests, newly passing tests, and tests whose duration changed significantly.

Enable with `FEATURE_RUN_COMPARISON=true`.

### Integration Hooks

Send notifications when runs complete or quality gates fire. Supported channels include Slack, Jira, and GitHub. Configure webhook URLs and API tokens in Settings.

Enable with `FEATURE_INTEGRATION_HOOKS=true`.

### Command Palette

Press `Cmd+K` (or `Ctrl+K` on Windows/Linux) from anywhere in the dashboard to open a search-and-navigate dialog. Jump to any run, test, or settings page without touching the mouse.

Enable with `FEATURE_COMMAND_PALETTE=true`.

### Impact Analysis

Automate builds a dependency graph of your test suite and, when a run finishes, shows which tests are most likely affected by the commits in that run. Useful for triaging failures when multiple things changed at once.

Enable with `FEATURE_IMPACT_ANALYSIS=true`.

### Codegen Launcher

Start a `playwright codegen` session from inside the dashboard. The recorder opens in a new browser window, and when you're done, the generated test file is saved back to your repository path. No separate terminal window needed.

Enable with `FEATURE_CODEGEN_LAUNCHER=true`.

### Baseline Management

Manage visual screenshot baselines from the dashboard UI. Review any failing screenshot diff, then accept the new screenshot as the baseline or reject it and mark the test as a known failure. No more editing files on disk.

Enable with `FEATURE_BASELINE_MANAGEMENT=true`.

### Auto-Quarantine

Automate tracks flakiness scores for every test. When a test flakes above your configured threshold, it moves automatically into a quarantine group. Quarantined tests still run, but they don't count against quality gates or trigger alerts.

Enable with `FEATURE_AUTO_QUARANTINE=true`.

### Scheduled Runs

Define cron schedules directly in the dashboard to trigger Playwright runs at fixed intervals. Automate handles the scheduling itself, so you don't need an external cron job or CI schedule.

Enable with `FEATURE_SCHEDULED_RUNS=true`.

### NL Query

Search your runs and tests using plain English. Type something like "flaky tests in the checkout flow this week" and Automate translates it into a filtered query. Works across test names, suite names, tags, and statuses.

Enable with `FEATURE_NL_QUERY=true`.

### Error Clustering

Automate groups similar failures by error signature instead of surfacing each one separately. If twelve tests all throw the same `TimeoutError` on `/cart`, you see one grouped entry with a count rather than twelve identical alerts.

Enable with `FEATURE_ERROR_CLUSTERING=true`.

### Known Failure Tracking

Mark specific test failures as "known" to suppress them from alerts and exclude them from quality gate calculations. Known failures still appear in the UI with a distinct indicator so they're not invisible.

Enable with `FEATURE_KNOWN_FAILURE_TRACKING=true`.

### Terminal Runner

Run Playwright tests from a real terminal session embedded in the dashboard. The runner uses a PTY so you get interactive output, including colour and progress bars, exactly as you'd see in a local terminal.

Enable with `FEATURE_TERMINAL_RUNNER=true`.

---

## Auth & Security

Automate v2 requires authentication before exposing any data.

### Login Page

The dashboard shows a login screen on first load. Enter your API key to start a session. Sessions are stored in a signed `httpOnly` cookie using HMAC-SHA256, so they survive page refreshes without re-prompting. Set `AUTOMATE_DASHBOARD_API_KEY` in your server environment to define the valid key.

### Route Guards

Every client-side route is wrapped in a `ProtectedRoute` component. Unauthenticated users are redirected to the login page before any dashboard content loads. The `/api/auth/status` endpoint lets the client check session validity without a full page reload.

---

## Internationalization

Automate supports English and Hebrew out of the box.

### Language Switcher

A language selector in the top navigation bar lets users switch between English and Hebrew at any time. The preference is saved to `localStorage` and restored on the next visit.

### RTL Support

Switching to Hebrew flips the entire layout to right-to-left. All 243 UI strings, including error messages, labels, and feature-specific copy, have Hebrew translations.

---

## Mobile Support

The dashboard is usable on mobile without horizontal scrolling or overlapping elements.

### Responsive Layout

KPI cards switch to a 2-column grid below 640px. Table columns hide progressively on small viewports. Date pickers and compare panels stack vertically. A best-viewed notice appears at the 640px breakpoint for very small devices.
