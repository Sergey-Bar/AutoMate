# @automate/reporter

**Playwright test reporter for Automate** — streams test events in real-time to your Automate server via WebSocket.

![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)
![MIT License](https://img.shields.io/badge/License-MIT-green)

---

## Features

- **Real-time streaming** — test events sent via WebSocket as they happen
- **Full lifecycle coverage** — run start, test begin/end, step begin/end, stdout/stderr, run end
- **PR metadata extraction** — automatically detects PR number, branch, commit author from CI environments
- **Zero config** — works out of the box with sensible defaults
- **Lightweight** — minimal dependencies (`ws` only)

---

## Installation

```bash
npm install @automate/reporter
# or
pnpm add @automate/reporter
# or
yarn add @automate/reporter
```

---

## Usage

Add the reporter to your `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'], // Keep the default list reporter for console output
    ['@automate/reporter', { port: 4001, host: 'localhost' }],
  ],
  // ... other config
});
```

### Options

```typescript
interface WsReporterOptions {
  port?: number;     // Default: 4001
  host?: string;     // Default: 'localhost'
  runId?: string;    // Default: auto-generated UUID
}
```

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `AUTOMATE_DASHBOARD_URL` | Automate server URL (overrides `host` and `port` options) | `http://localhost:4001` |
| `REPORTER_SECRET` | Shared secret for reporter authentication | `my-secret-token` |
| `DASHBOARD_RUN_ID` | Custom run ID (overrides `runId` option) | `my-custom-run-id` |
| `PR_NUMBER` | PR number (for GitHub, GitLab, etc.) | `123` |
| `GITHUB_REF` | GitHub PR ref (auto-extracted) | `refs/pull/123/merge` |
| `GITHUB_HEAD_REF` | GitHub PR source branch | `feature/my-feature` |
| `GITHUB_BASE_REF` | GitHub PR target branch | `main` |
| `GITHUB_ACTOR` | GitHub commit author | `username` |
| `GITHUB_SHA` | GitHub commit SHA | `abc123...` |

**Note:** The reporter automatically detects PR metadata from GitHub Actions and GitLab CI environments.

---

## API Reference

### `WsReporter`

The main reporter class. Implements the Playwright `Reporter` interface.

```typescript
import WsReporter from '@automate/reporter';

// Custom instantiation (if needed)
const reporter = new WsReporter({
  port: 4001,
  host: 'localhost',
  runId: 'my-run-id',
});
```

### `extractPRMetadata()`

Utility function to extract PR metadata from environment variables.

```typescript
import { extractPRMetadata } from '@automate/reporter';

const prMeta = extractPRMetadata();
// => { prNumber?: number, prBranch?: string, baseBranch?: string, commitAuthor?: string }
```

---

## Event Types

The reporter emits the following events to the Automate server:

| Event | Trigger | Payload |
|-------|---------|---------|
| `run:start` | Test suite begins | `{ total, projects, config, pr, branch, commitSha }` |
| `test:begin` | Individual test starts | `{ testId, title, titlePath, file, line, column, ... }` |
| `test:end` | Individual test completes | `{ testId, status, durationMs, error, attachments, ... }` |
| `step:begin` | Test step starts | `{ testId, stepId, title, category, location, startTime }` |
| `step:end` | Test step completes | `{ testId, stepId, durationMs, error }` |
| `stdout` | Test writes to stdout | `{ testId?, chunk }` |
| `stderr` | Test writes to stderr | `{ testId?, chunk }` |
| `run:end` | Test suite completes | `{ status, durationMs }` |

---

## Example: Standalone Usage

You can also use the reporter programmatically outside of `playwright.config.ts`:

```typescript
import { test, expect } from '@playwright/test';
import WsReporter from '@automate/reporter';

const reporter = new WsReporter({ port: 4001 });

// Use in custom test runner or CI script
// (Playwright will automatically invoke reporter methods)
```

---

## Connection Behavior

- **Queue-based buffering** — events are queued until the WebSocket connection is established
- **Automatic reconnection** — if the connection fails, events remain queued (no retry logic in this version)
- **Graceful shutdown** — the reporter waits 500ms after `run:end` to flush remaining events before closing

---

## CI Environment Support

The reporter automatically extracts PR metadata from:

- **GitHub Actions** — `GITHUB_REF`, `GITHUB_HEAD_REF`, `GITHUB_BASE_REF`, `GITHUB_ACTOR`, `GITHUB_SHA`
- **GitLab CI** — `CI_MERGE_REQUEST_IID`, `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`, `CI_MERGE_REQUEST_TARGET_BRANCH_NAME`, `GITLAB_USER_NAME`, `CI_COMMIT_SHA`
- **Generic** — `PR_NUMBER` (fallback)

---

## License

MIT
