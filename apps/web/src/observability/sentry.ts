import * as Sentry from '@sentry/react';
import type { router as appRouter } from '../router.js';

export interface BrowserSentryEnv {
  dsn?: string;
  release?: string;
  environment?: string;
  tracesSampleRate?: string;
}

type BrowserOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;

/**
 * What the browser SDK is allowed to collect, and it is nearly nothing.
 *
 * The same defaults that make the API SDK dangerous are worse here: the
 * dashboard renders run output, quarantine diffs and reporter evidence, all of
 * it customer data, and `stackFrameVariables` is on by default. Session
 * cookies and query parameters are off for the same reason as on the API.
 *
 * Session replay is deliberately absent. It is the most valuable thing to add
 * next for a QA product, and also the largest new disclosure surface on a
 * screen full of run output, so it is a decision to make on purpose with
 * `replaysOnErrorSampleRate` set deliberately — not a default.
 */
export const SENTRY_DATA_COLLECTION: NonNullable<BrowserOptions['dataCollection']> = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  stackFrameVariables: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
};

/**
 * Reads a sampling rate, falling back to 0 for anything unparseable.
 *
 * A bad value must not take down a page load, and 0 is also the default so a
 * misconfigured build reports errors without quietly spending tracing quota.
 */
function readSampleRate(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return 0;
  return parsed;
}

/**
 * The SDK options, or `undefined` when no DSN is configured.
 *
 * `undefined` is a meaningful result: `main.tsx` skips `init` entirely, so a
 * build with no DSN ships no SDK behaviour and makes no outbound calls.
 */
export function buildBrowserSentryOptions(
  router: typeof appRouter,
  env: BrowserSentryEnv,
): BrowserOptions | undefined {
  const dsn = env.dsn?.trim();
  if (!dsn) return undefined;
  return {
    dsn,
    release: env.release?.trim() || undefined,
    environment: env.environment?.trim() || import.meta.env.MODE,
    tracesSampleRate: readSampleRate(env.tracesSampleRate),
    dataCollection: SENTRY_DATA_COLLECTION,
    integrations: [
      // Without the router instance the SDK cannot name a transaction, so every
      // navigation would report as the document load instead of the route.
      Sentry.tanstackRouterBrowserTracingIntegration(router),
    ],
  };
}
