import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { router as appRouter } from '../router.js';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  tanstackRouterBrowserTracingIntegration: vi.fn(() => ({ name: 'tanstackRouter' })),
}));

vi.mock('@sentry/react', () => sentry);

const { SENTRY_DATA_COLLECTION, buildBrowserSentryOptions } = await import('./sentry.js');

const DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
const router = {} as unknown as typeof appRouter;

beforeEach(() => {
  sentry.init.mockReset();
  sentry.tanstackRouterBrowserTracingIntegration.mockClear();
});

describe('buildBrowserSentryOptions', () => {
  it('returns nothing when no DSN is configured, so init is never called', () => {
    expect(buildBrowserSentryOptions(router, {})).toBeUndefined();
    expect(buildBrowserSentryOptions(router, { dsn: '' })).toBeUndefined();
    expect(buildBrowserSentryOptions(router, { dsn: '   ' })).toBeUndefined();
  });

  it('names transactions with the router instance', () => {
    const options = buildBrowserSentryOptions(router, { dsn: DSN });

    expect(sentry.tanstackRouterBrowserTracingIntegration).toHaveBeenCalledWith(router);
    expect(options?.integrations).toHaveLength(1);
  });

  it('reads the release, environment and sampling rate', () => {
    const options = buildBrowserSentryOptions(router, {
      dsn: DSN,
      release: ' automate@1.4.2 ',
      environment: 'staging',
      tracesSampleRate: '0.5',
    });

    expect(options?.release).toBe('automate@1.4.2');
    expect(options?.environment).toBe('staging');
    expect(options?.tracesSampleRate).toBe(0.5);
  });

  it('falls back to the build mode when no environment is given', () => {
    expect(buildBrowserSentryOptions(router, { dsn: DSN })?.environment).toBe(import.meta.env.MODE);
  });

  it('defaults tracing off and ignores an unparseable rate', () => {
    const rate = (raw?: string) =>
      buildBrowserSentryOptions(router, { dsn: DSN, tracesSampleRate: raw })?.tracesSampleRate;

    expect(rate(undefined)).toBe(0);
    for (const bad of ['', '  ', 'yes', '-1', '2', 'NaN']) {
      expect(rate(bad)).toBe(0);
    }
  });
});

describe('SENTRY_DATA_COLLECTION', () => {
  it('keeps the session cookie, the URL and the stack frames to themselves', () => {
    // The dashboard renders run output and reporter evidence, so the browser
    // defaults are at least as dangerous as the API's.
    expect(SENTRY_DATA_COLLECTION).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    });
  });

  it('does not ship session replay', () => {
    // Replay is the most useful thing to add next and also the largest new
    // disclosure surface, so it stays off until someone opts in on purpose.
    expect(SENTRY_DATA_COLLECTION).not.toHaveProperty('replaysSessionSampleRate');
    expect(sentry.tanstackRouterBrowserTracingIntegration).not.toHaveBeenCalled();
  });
});
