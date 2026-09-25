# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [2.1.0] - 2026-04-19

### Feature Graduation

Twelve v2.1 intelligence and enterprise features have graduated from experimental flags to stable defaults. They are on by default in every fresh install. To opt out, set the corresponding `FEATURE_*` env var to `false`.

- **Failure Taxonomy** (`FEATURE_FAILURE_TAXONOMY`) — Rule-based failure classification with configurable rules and a `failure_classifications` table. Categorises failures as flaky, env, assertion, timeout, or unknown with confidence scores.
- **Predictive Test Selection** (`FEATURE_PREDICTIVE_TEST_SELECTION`) — Scores tests by historical failure rate, recency, and code-change proximity to surface the highest-risk candidates first.
- **Screenshot Diff** (`FEATURE_SCREENSHOT_DIFF`) — Pixel-level visual regression via pixelmatch and a multi-strategy diff pipeline (Phase 3A). Integrates with the baseline management UI.
- **Looks-Same Diff** (`FEATURE_LOOKS_SAME_DIFF`) — Perceptual image comparison backend used by the screenshot-diff pipeline. Enables tolerance-aware comparison for anti-aliasing and rendering differences.
- **Cross-Run Clusters** (`FEATURE_CROSS_RUN_CLUSTERS`) — Groups related failures across multiple runs by error signature into the `failure_clusters` table, surfaced on the analytics dashboard.
- **Risk Scoring** (`FEATURE_RISK_SCORING`) — Assigns a composite risk score per test based on historical failure rate, flakiness, and recency. Drives priority ordering in the test explorer.
- **Audit Trail** (`FEATURE_AUDIT_TRAIL`) — Persists authenticated actions (MCP tool calls, config changes) to the `audit_events` table for compliance and forensics.
- **Per-Workspace Gates** (`FEATURE_PER_WORKSPACE_GATES`) — Quality gate thresholds can be scoped to a `workspaceId`, enabling per-project pass-rate policies.
- **Quarantine Approval** (`FEATURE_QUARANTINE_APPROVAL`) — Quarantine requests enter a `pending` state and require explicit `approved`/`rejected` review before taking effect in CI.
- **ROI Metrics** (`FEATURE_ROI_METRICS`) — Tracks time-to-fix, test execution cost, and quarantine ROI. Exposed via the `/api/analytics/roi` endpoint.
- **Locator Intelligence** (`FEATURE_LOCATOR_INTELLIGENCE`) — Phase 3B self-healing selectors: detects selector failures, generates three alternative locator strategies, optionally queries an AI backend, and persists suggestions to `locator_suggestions`.
- **Test Generation** (`FEATURE_TEST_GENERATION`) — Phase 2B natural-language → Playwright test generation. Accepts a plain-English description and produces a ready-to-run `.spec.ts` file.

### Testing

- Updated `feature-flags.test.ts` to reflect v2.1 graduation defaults.
- Updated `killswitch-drill.test.ts`: graduated flags moved to a new "default true, can be disabled via kill switch" block.
- MCP integration tests (`server.integration.test.ts`, `security-regression.test.ts`, `mcp-churn.test.ts`) updated to mock `db.insert` now that the `audit-trail` flag is on by default.
- Updated `reporter-bridge-locator.test.ts` to explicitly disable the flag in the "disabled" test path.



### QA & Release Hardening (2026-03-28)
- Coverage enforcement: per-package vitest thresholds ratcheted to current highs
  - Server: 95.72% lines (threshold 94%), 1,178 tests
  - Client: 96.37% lines (threshold 96%), 818 tests
  - CLI: 16 tests
- **2,012 total unit tests**, all passing
- Mutation testing: Stryker v9 configured with 75% break threshold (blocked on Stryker v9 + Vitest 4 Windows compatibility — exit code 3221225477)
- CI/CD pipeline: GitHub Actions with lint, typecheck, test+coverage, build, and E2E gates
- Multi-browser E2E: Playwright configured for Chromium, Firefox, and WebKit
- Accessibility E2E: axe-core WCAG 2.1 AA tests on login, runs, analytics, config, baselines, settings pages
- Dependency security: pnpm overrides for picomatch, flatted, undici, brace-expansion
- Full pipeline verified: all tests pass clean

### ⚠️ Breaking Changes

- **Prometheus metric prefix renamed**: All `automate_*` metrics have been renamed to `automate_*` (e.g. `automate_http_requests_total` → `automate_http_requests_total`). If you have dashboards or alerts referencing the old prefix, update them before upgrading.

### Feature Graduation

All eleven v2 features have graduated from experimental flags to stable defaults. They're on by default in every fresh install. No env var required.

- **AI Explain** — AI-powered explanations of test failures. Supports OpenAI, Ollama, and Anthropic backends. Surfaces a plain-English summary on any failure detail page.
- **PR Comparison** — Compares test results between a pull request and its base branch. Exports a Markdown report you can post directly to the PR.
- **Impact Analysis** — Builds a dependency graph of your test suite to identify which tests are affected by a given code change.
- **Codegen Launcher** — Launches `playwright codegen` from inside the dashboard and saves the recorded test back to your repository.
- **Baseline Management** — Accept or reject screenshot baselines through the UI. No more hunting for files on disk.
- **Auto-Quarantine** — Detects flaky tests automatically and moves them to a quarantine group so they can't block CI while the team investigates.
- **Scheduled Runs** — Trigger Playwright runs on a cron schedule directly from the dashboard. No external cron job needed.
- **NL Query** — Search runs and tests with plain English. Ask things like "show me flaky tests in checkout this week".
- **Error Clustering** — Groups similar failures by error signature so you see one grouped entry instead of dozens of identical alerts.
- **Known Failure Tracking** — Annotate expected failures to suppress them from alerts and quality gate checks.
- **Terminal Runner** — Run tests from an integrated terminal inside the dashboard. Uses a real PTY session.

### Auth & Security

- Login page with API key authentication — the dashboard now requires a key before exposing any data.
- Session management with HMAC-SHA256 signed `httpOnly` cookies. Sessions expire and rotate automatically.
- `ProtectedRoute` component on the client side — unauthenticated users are redirected to the login page before any route resolves.
- `/api/auth/status` endpoint returns current session state for client-side guards.

### Internationalization

- Hebrew (he) locale with full RTL layout support.
- Language switcher component in the top navigation bar.
- 243 translation keys covering every feature, error message, and UI label.
- Language preference is persisted to `localStorage`.

### Mobile Responsiveness

- KPI cards switch to a 2-column grid on viewports below 640px.
- Table columns hide progressively on small screens to avoid horizontal overflow.
- Date pickers and compare panels stack vertically on mobile.
- A best-viewed notice appears at the 640px breakpoint for users on very small devices.

### Operations

- Fixed CI trigger branch from `master` to `main`.
- Added GitHub Pages workflow for automatic docs-site deployment.
- Added structured request logging middleware using `pino`.
- Feature flag enforcement added to all v2 server routes and client route definitions.
- Docker deployment documentation updated with v2 auth and env var guidance.

### Testing

- E2E tests covering feature flag activation and deactivation.
- E2E tests covering the full auth login flow (correct key, wrong key, session expiry).
- Mobile viewport E2E tests at 375x812 for all responsive layouts.
- Accessibility compliance verified with `axe-core` across all views.
- 1,365 total unit tests: 724 server-side + 641 client-side.


## [1.0.0] - 2026-03-17

### Added

- Real-time test monitoring via WebSocket (two-port architecture: HTTP+browser on 4000, reporter on 4001)
- Failure analysis: screenshot diffs with slider/side-by-side view, video playback, trace viewer, step timeline
- Error display with copy-to-clipboard, collapsible stack traces, and failure-first tab ordering
- Analytics dashboard: pass-rate trends, duration charts, flaky test leaderboard
- Test explorer with groupable tree view (suite, file, tag, status)
- Run comparison (side-by-side diff)
- Integration hooks: Slack, Jira, GitHub
- Quality gates with configurable thresholds
- Docker single-command deployment with OCI metadata labels
- `@automate/reporter` npm package for Playwright integration
- Feature flag system for progressive feature enablement (`FEATURE_*` env vars)
- Documentation site powered by Starlight (getting started, deployment, configuration, architecture)
- Zero-question onboarding wizard (2-step connection flow)
- `@automate/cli init` zero-prompt setup command
- GitHub Actions workflows for Docker (GHCR) and npm publishing
- GitHub issue templates and PR template
- CONTRIBUTING.md with development setup guide

### Changed

- `node-pty` made optional (behind `FEATURE_TERMINAL_RUNNER` flag)
- Docker image no longer requires build tools (`python3`, `make`, `g++`) in production stage
- CLI rewritten from interactive prompts to zero-question flow
- Onboarding wizard redesigned from multi-question to 2-step connection flow

### Removed

- Interactive CLI prompts (replaced with zero-question flow)
- Dead "Network" tab from test detail view
