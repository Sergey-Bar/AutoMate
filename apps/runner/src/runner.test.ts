import { describe, expect, it } from 'vitest';
import { parseRunnerConfig } from './config.js';

describe('runner configuration', () => {
  it('requires API and instance identity', () => {
    expect(
      parseRunnerConfig({
        AUTOMATE_API_URL: 'http://localhost:3000',
        RUNNER_INSTANCE_ID: 'runner-1',
      }),
    ).toMatchObject({ maxConcurrentJobs: 1 });
    expect(() => parseRunnerConfig({})).toThrow();
  });
});
