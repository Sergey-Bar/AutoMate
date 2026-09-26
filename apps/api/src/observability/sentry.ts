import * as Sentry from '@sentry/node';
import type { NodeOptions } from '@sentry/node';
import type { ReportedErrorContext } from '../errors/boundary.js';

const SENTRY_VARIABLES = {
  dsn: 'SENTRY_DSN',
  release: 'SENTRY_RELEASE',
  environment: 'SENTRY_ENVIRONMENT',
  tracesSampleRate: 'SENTRY_TRACES_SAMPLE_RATE',
} as const;

export interface SentrySettings {
  dsn: string;
  release?: string;
  environment?: string;
  tracesSampleRate: number;
}

/**
 * What the SDK is allowed to collect, and it is nearly nothing.
 *
 * Sentry v11 collects by default and `localVariablesIntegration` ships enabled,
 * so an unconfigured SDK attaches the values of every local variable in a
 * stack frame, the cookies on the request, every request and response header,
 * request and response bodies, bound query parameters, and any AI prompt or
 * completion. Applied to this API that means `authCookieSecret`,
 * `installationKey`, the `Authorization` and `x-reporter-secret` headers, the
 * `DATABASE_URL` query parameters and the agent prompts reaching the Kilo
 * gateway all leave the process on the first error.
 *
 * The startup policy already treats every one of those as a secret that must
 * not be logged (`apps/api/src/startup-policy.ts`), and the error boundary
 * keeps SQL fragments and stack traces out of responses for the same reason.
 * Collecting them for a third party would be the same disclosure with an extra
 * hop, so each field is switched off explicitly rather than left to a default
 * that a minor version can change. Structural metadata — method, URL path,
 * status, sanitized statement shape, frame context lines — still arrives, which
 * is what makes an event actionable.
 */
export const SENTRY_DATA_COLLECTION: NonNullable<NodeOptions['dataCollection']> = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  stackFrameVariables: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  queues: false,
};

/**
 * Reads a sampling rate, falling back to 0 for anything unparseable.
 *
 * Unlike the object store configuration, a bad value here does not throw. This
 * is read from a preload that runs before `checkProductionPolicy`, so throwing
 * would let a typo in a monitoring variable refuse to start the API — a
 * misconfigured error reporter must not be able to take down the service it
 * reports on. 0 means "no transaction data", which is also the default: errors
 * are the reason to run this, and tracing costs quota.
 */
function readSampleRate(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return 0;
  return parsed;
}

/**
 * The Sentry configuration, or `undefined` when no DSN is set.
 *
 * Absent a DSN the SDK is never initialised, so a clone of this repository
 * makes no outbound calls and a forgotten variable cannot silently become a
 * no-op that looks configured.
 */
export function readSentrySettings(
  env: NodeJS.ProcessEnv = process.env,
): SentrySettings | undefined {
  const dsn = env[SENTRY_VARIABLES.dsn]?.trim();
  if (!dsn) return undefined;
  return {
    dsn,
    release: env[SENTRY_VARIABLES.release]?.trim() || undefined,
    environment: env[SENTRY_VARIABLES.environment]?.trim() || undefined,
    tracesSampleRate: readSampleRate(env[SENTRY_VARIABLES.tracesSampleRate]),
  };
}

/**
 * Initialises the SDK. Returns whether it is now enabled, so a caller can tell
 * "no DSN configured" apart from "configured and reporting".
 */
export function initSentry(env: NodeJS.ProcessEnv = process.env): boolean {
  const settings = readSentrySettings(env);
  if (!settings) return false;
  Sentry.init({
    dsn: settings.dsn,
    release: settings.release,
    environment: settings.environment ?? env['NODE_ENV'],
    tracesSampleRate: settings.tracesSampleRate,
    dataCollection: SENTRY_DATA_COLLECTION,
    // `httpServerIntegration` is not a default integration: without it the
    // Hono server still reports errors, but no request is ever a transaction
    // and there is nothing to attribute a slow 5xx to.
    integrations: [Sentry.httpServerIntegration()],
  });
  return true;
}

/**
 * The reporting hook `createErrorBoundary` calls for a failure.
 *
 * Only the request coordinates go on the event. The boundary already routes the
 * cause, the SQLSTATE detail and `DomainError.logMessage()` to the log, and
 * duplicating that into a third-party payload would widen the disclosure
 * without adding anything a stack trace does not already carry. The
 * `requestId` tag is the join key: it is in the log line and in the response
 * body, so an operator holding a `requestId` from a caller can find the event
 * without searching by stack frame.
 */
export function createSentryErrorReporter(): (
  error: unknown,
  context: ReportedErrorContext,
) => void {
  return (error, context) => {
    if (!Sentry.isEnabled()) return;
    Sentry.captureException(error, {
      level: 'error',
      tags: {
        request_id: context.requestId,
        path: context.path,
        method: context.method,
        error_code: context.code,
      },
    });
  };
}
