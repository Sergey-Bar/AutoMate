/**
 * Vitest workspace configuration for the Automate monorepo.
 *
 * When `vitest related --run` is executed from the repo root (e.g. during
 * lint-staged pre-commit checks), Vitest uses this file to discover the
 * correct per-package config for each test file.  Without it, Vitest would
 * fall back to a single root-level config that lacks the path aliases and
 * environment settings (jsdom, @/) required by the web package.
 *
 * Note: Playwright e2e specs (e2e/**) are intentionally excluded — they are
 * run by @playwright/test, not Vitest.
 */
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'apps/server/vitest.config.ts',
  'apps/web/vitest.config.ts',
  'packages/shared/vitest.config.ts',
  'packages/connector-sdk/vitest.config.ts',
  'packages/connectors/github/vitest.config.ts',
  'packages/connectors/jira/vitest.config.ts',
  'packages/connectors/slack/vitest.config.ts',
  'packages/connectors/sql-browser/vitest.config.ts',
]);
