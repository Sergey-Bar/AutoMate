/**
 * One jest-dom registration for the whole client suite.
 *
 * The `/vitest` entry point is the one that matters: it imports `expect` from `vitest`
 * directly, so a matcher cannot register against a different global scope and vanish.
 * Loading it here means a new test file gets the matchers by existing, rather than by
 * remembering an import line.
 */
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

/**
 * How long `waitFor` waits before it reports a failure.
 *
 * Testing-library defaults this to 1000 ms, and it is a **separate clock** from
 * `testTimeout` — so raising `testTimeout` in `apps/web/vitest.config.ts` does not
 * raise this one. Without it, every `await waitFor(...)` in the client suite races a
 * one-second deadline and fails intermittently on a loaded machine.
 *
 * 5 s rather than matching `testTimeout`: the expensive part of these tests is module
 * import, not the wait, so matching the bigger clock would buy nothing and would make
 * a genuinely broken selector slow to find.
 */
export const ASYNC_UTIL_TIMEOUT_MS = 5_000;

configure({ asyncUtilTimeout: ASYNC_UTIL_TIMEOUT_MS });
