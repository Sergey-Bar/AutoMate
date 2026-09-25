---
title: Getting Started
description: Get Automate running and connect your Playwright tests in under 2 minutes.
---

Automate ships as a single Docker image or a Node.js monorepo. Either way, you're up in a couple of minutes.

## Prerequisites

Pick one:

- **Docker** 24+ (recommended for production)
- **Node.js** 22+ with `pnpm` 9+ (recommended for local development)

## Quick Start with Docker

The fastest path to a running dashboard:

```bash
docker run -d \
  -p 4000:4000 \
  -p 4001:4001 \
  ghcr.io/automate-hq/automate:latest
```

Then open [http://localhost:4000](http://localhost:4000). The dashboard loads immediately, waiting for test results.

Port `4000` serves the web UI and HTTP API. Port `4001` is the reporter WebSocket — your CI machines need direct access to this port.

## Quick Start from Source

Clone the repo and boot the dev server:

```bash
git clone https://github.com/automate-hq/automate.git
cd automate
pnpm install
pnpm dev
```

The dev server starts both ports with hot-reload. Changes to `apps/server` or `apps/client` rebuild automatically.

## Connect Your Tests

### 1. Install the reporter

```bash
npm install -D @automate/reporter
```

Or with pnpm / yarn:

```bash
pnpm add -D @automate/reporter
yarn add -D @automate/reporter
```

### 2. Add it to `playwright.config.ts`

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['@automate/reporter'],
  ],
});
```

The `list` reporter keeps your terminal output intact. `@automate/reporter` streams events to Automate in parallel.

### 3. Run your tests

```bash
AUTOMATE_DASHBOARD_URL=http://localhost:4000 npx playwright test
```

That's the only required env var. The reporter connects to port `4001` automatically (derived from `AUTOMATE_DASHBOARD_URL`).

## Verify Results

Results stream to the dashboard in real-time. You'll see:

- A new run appear the moment tests start
- Each test light up as it passes, fails, or skips
- Screenshots, videos, and traces attached as soon as they're uploaded
- A final summary with pass rate and duration once the run completes

Refresh isn't needed. The dashboard maintains a live WebSocket connection.

## Next Steps

- **[Reporter Setup](/reporter/)** — full options reference, CI configuration, and event types
- **[Deployment](/deployment/)** — Docker Compose, VPS setup, and reverse proxy config
- **[Configuration](/configuration/)** — all environment variables and feature flags
