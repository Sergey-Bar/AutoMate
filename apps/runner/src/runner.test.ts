import { parseRunnerConfig } from './config.js';
import { describe, expect, it } from 'vitest';

describe('runner configuration', () => {
  it('requires API, instance identity, and a registration credential', () => {
    expect(
      parseRunnerConfig({
        AUTOMATE_API_URL: 'http://localhost:3000',
        RUNNER_INSTANCE_ID: 'runner-1',
        RUNNER_REGISTRATION_SECRET: 'registration-secret',
      }),
    ).toMatchObject({
      maxConcurrentJobs: 1,
      slots: 1,
      capabilities: ['playwright', 'chromium', 'api'],
    });
    expect(() =>
      parseRunnerConfig({
        AUTOMATE_API_URL: 'http://localhost:3000',
        RUNNER_INSTANCE_ID: 'runner-1',
      }),
    ).toThrow();
  });

  it('roots API collections in the shipped fixtures unless told otherwise', () => {
    const base = {
      AUTOMATE_API_URL: 'http://localhost:3000',
      RUNNER_INSTANCE_ID: 'runner-1',
      RUNNER_CREDENTIAL: 'token',
    };
    expect(parseRunnerConfig(base).apiCollectionRoot).toMatch(/fixtures[\\\\/]api-smoke[\\\\/]?$/u);
    expect(
      parseRunnerConfig({ ...base, RUNNER_API_COLLECTION_ROOT: '/srv/collections' })
        .apiCollectionRoot,
    ).toBe('/srv/collections');
  });

  it('names each runner after its instance unless told otherwise', () => {
    // `runners` is unique on (workspace_id, name), so a default name shared by every runner
    // made the second runner on an installation fail to register with an opaque 23505
    // DUPLICATE, whatever its instance id.
    const base = { AUTOMATE_API_URL: 'http://localhost:3000', RUNNER_CREDENTIAL: 'token' };
    const first = parseRunnerConfig({ ...base, RUNNER_INSTANCE_ID: 'runner-1' });
    const second = parseRunnerConfig({ ...base, RUNNER_INSTANCE_ID: 'runner-2' });
    expect(first.name).toBe('automate-playwright-runner-runner-1');
    expect(second.name).not.toBe(first.name);
    expect(
      parseRunnerConfig({ ...base, RUNNER_INSTANCE_ID: 'runner-1', RUNNER_NAME: 'ci-east-1' }).name,
    ).toBe('ci-east-1');
  });

  it('normalizes only explicit URL origins and list allowlists', () => {
    const config = parseRunnerConfig({
      AUTOMATE_API_URL: 'http://localhost:3000/',
      RUNNER_INSTANCE_ID: 'runner-1',
      RUNNER_CREDENTIAL: 'token',
      RUNNER_ALLOWED_TARGET_URLS: 'https://example.test/path,https://example.test:443/other',
      RUNNER_LABELS: 'linux,linux,trusted',
    });
    expect(config.apiUrl).toBe('http://localhost:3000');
    expect(config.allowedTargetUrls).toEqual(['https://example.test']);
    expect(config.labels).toEqual(['linux', 'trusted']);
  });

  it('exposes bounded spool configuration for the durable event queue', () => {
    const config = parseRunnerConfig({
      AUTOMATE_API_URL: 'http://localhost:3000',
      RUNNER_INSTANCE_ID: 'runner-1',
      RUNNER_CREDENTIAL: 'token',
    });
    expect(config).toMatchObject({
      spoolMaxEntries: 10_000,
      spoolMaxBytes: 64_000_000,
      spoolKey: undefined,
    });
    expect(config.spoolRoot).toContain('automate-runner-spool');

    const tuned = parseRunnerConfig({
      AUTOMATE_API_URL: 'http://localhost:3000',
      RUNNER_INSTANCE_ID: 'runner-1',
      RUNNER_CREDENTIAL: 'token',
      RUNNER_SPOOL_ROOT: '/var/lib/automate/spool',
      RUNNER_SPOOL_KEY: 'a-stable-spool-key',
      RUNNER_SPOOL_MAX_ENTRIES: '25',
      RUNNER_SPOOL_MAX_BYTES: '1048576',
    });
    expect(tuned).toMatchObject({
      spoolRoot: '/var/lib/automate/spool',
      spoolKey: 'a-stable-spool-key',
      spoolMaxEntries: 25,
      spoolMaxBytes: 1_048_576,
    });
    expect(() =>
      parseRunnerConfig({
        AUTOMATE_API_URL: 'http://localhost:3000',
        RUNNER_INSTANCE_ID: 'runner-1',
        RUNNER_CREDENTIAL: 'token',
        RUNNER_SPOOL_KEY: 'short',
      }),
    ).toThrow();
  });
});
