import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  isEnabled: vi.fn(),
  captureException: vi.fn(),
  httpServerIntegration: vi.fn(() => ({ name: 'httpServer' })),
}));

vi.mock('@sentry/node', () => sentry);

const { SENTRY_DATA_COLLECTION, createSentryErrorReporter, initSentry, readSentrySettings } =
  await import('./sentry.js');

const DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

beforeEach(() => {
  sentry.init.mockReset();
  sentry.isEnabled.mockReset();
  sentry.captureException.mockReset();
  sentry.httpServerIntegration.mockClear();
});

describe('readSentrySettings', () => {
  it('reports nothing configured when SENTRY_DSN is absent or blank', () => {
    expect(readSentrySettings({})).toBeUndefined();
    expect(readSentrySettings({ SENTRY_DSN: '' })).toBeUndefined();
    expect(readSentrySettings({ SENTRY_DSN: '   ' })).toBeUndefined();
  });

  it('reads the DSN, release and environment', () => {
    const settings = readSentrySettings({
      SENTRY_DSN: DSN,
      SENTRY_RELEASE: 'automate@1.4.2',
      SENTRY_ENVIRONMENT: 'staging',
    });

    expect(settings).toEqual({
      dsn: DSN,
      release: 'automate@1.4.2',
      environment: 'staging',
      tracesSampleRate: 0,
    });
  });

  it('treats a blank release as absent rather than as an empty release name', () => {
    expect(readSentrySettings({ SENTRY_DSN: DSN, SENTRY_RELEASE: '  ' })?.release).toBeUndefined();
  });

  it('accepts a sampling rate in range and ignores anything else', () => {
    const rate = (raw?: string) =>
      readSentrySettings({ SENTRY_DSN: DSN, SENTRY_TRACES_SAMPLE_RATE: raw })?.tracesSampleRate;

    expect(rate('0.25')).toBe(0.25);
    expect(rate('0')).toBe(0);
    expect(rate('1')).toBe(1);
    for (const bad of ['', '  ', 'yes', '-1', '2', 'NaN', 'Infinity']) {
      expect(rate(bad)).toBe(0);
    }
  });
});

describe('initSentry', () => {
  it('does not initialise the SDK when no DSN is configured', () => {
    expect(initSentry({})).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('initialises with the restrictive collection policy and the http integration', () => {
    expect(initSentry({ SENTRY_DSN: DSN, NODE_ENV: 'production' })).toBe(true);

    const options = sentry.init.mock.calls[0]?.[0];
    expect(options?.dsn).toBe(DSN);
    expect(options?.environment).toBe('production');
    expect(options?.dataCollection).toBe(SENTRY_DATA_COLLECTION);
    expect(sentry.httpServerIntegration).toHaveBeenCalledTimes(1);
  });

  it('prefers an explicit Sentry environment over NODE_ENV', () => {
    initSentry({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'canary', NODE_ENV: 'production' });
    expect(sentry.init.mock.calls[0]?.[0]?.environment).toBe('canary');
  });
});

describe('SENTRY_DATA_COLLECTION', () => {
  it('collects nothing that could carry a credential or customer data', () => {
    // Every one of these is a v11 default, and each is on unless it is refused
    // here. `localVariablesIntegration` is a default *integration*, so
    // `stackFrameVariables: false` is the only thing standing between a stack
    // frame and the value of `authCookieSecret`.
    expect(SENTRY_DATA_COLLECTION).toEqual({
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
    });
  });
});

describe('createSentryErrorReporter', () => {
  it('reports the error with the request coordinates as tags', () => {
    sentry.isEnabled.mockReturnValue(true);
    sentry.captureException.mockReturnValue('event-id');
    const error = new Error('boom');

    createSentryErrorReporter()(error, {
      requestId: 'req-1',
      path: '/api/v1/runs',
      method: 'POST',
      code: 'INTERNAL',
    });

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const [captured, hint] = sentry.captureException.mock.calls[0] ?? [];
    expect(captured).toBe(error);
    expect(hint).toEqual({
      level: 'error',
      tags: {
        request_id: 'req-1',
        path: '/api/v1/runs',
        method: 'POST',
        error_code: 'INTERNAL',
      },
    });
  });

  it('does not capture anything while the SDK is disabled', () => {
    sentry.isEnabled.mockReturnValue(false);

    createSentryErrorReporter()(new Error('boom'), {
      requestId: 'req-1',
      path: '/api/v1/runs',
      method: 'GET',
      code: 'INTERNAL',
    });

    expect(sentry.captureException).not.toHaveBeenCalled();
  });
});
