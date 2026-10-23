import { describe, expect, it } from 'vitest';
import {
  LOAD_DEFAULT_DURATION_SECONDS,
  LOAD_DEFAULT_VUS,
  LOAD_MAX_DURATION_SECONDS,
  LOAD_MAX_VUS,
  LoadJobConfigurationSchema,
  LoadRunInputSchema,
} from './load.js';

const VALID = { script: 'smoke.js', targetUrl: 'http://127.0.0.1:3000' };

describe('LoadRunInputSchema', () => {
  it('accepts a script, a target and nothing else', () => {
    expect(LoadRunInputSchema.parse(VALID)).toEqual(VALID);
  });

  it('accepts the ceilings exactly and the run-request fields the runs API defines', () => {
    const input = {
      ...VALID,
      script: 'scenarios/checkout.js',
      vus: LOAD_MAX_VUS,
      durationSeconds: LOAD_MAX_DURATION_SECONDS,
      projectId: 'p',
      environmentId: 'e',
      releaseId: 'r',
      branch: 'main',
      commit: 'abc',
      idempotencyKey: 'k',
    };
    expect(LoadRunInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    ['one VU over the ceiling', { vus: LOAD_MAX_VUS + 1 }],
    ['zero VUs', { vus: 0 }],
    ['a fractional VU count', { vus: 1.5 }],
    ['one second over the duration ceiling', { durationSeconds: LOAD_MAX_DURATION_SECONDS + 1 }],
    ['a zero duration', { durationSeconds: 0 }],
    ['a duration given as a k6 string', { durationSeconds: '30s' }],
    ['a parent-directory script', { script: '../secrets.js' }],
    ['a nested parent-directory script', { script: 'a/../../b.js' }],
    ['an absolute script', { script: '/etc/passwd.js' }],
    ['a Windows drive script', { script: 'C:/x.js' }],
    ['a backslash script', { script: 'a\\b.js' }],
    ['a script that is not .js', { script: 'smoke.sh' }],
    ['a script that is a CLI flag', { script: '--vus=9999.js' }],
    ['a file: target', { targetUrl: 'file:///etc/passwd' }],
    ['a target with credentials', { targetUrl: 'http://u:p@host.test/' }],
    ['a thresholds override, which k6 cannot take from outside the script', { thresholds: {} }],
    ['an arbitrary command', { command: ['sh', '-c', 'id'] }],
    ['extra k6 arguments', { args: ['--out', 'cloud'] }],
    ['a caller-chosen timeout', { timeoutMs: 1 }],
  ])('refuses %s', (_name, extra) => {
    expect(LoadRunInputSchema.safeParse({ ...VALID, ...extra }).success).toBe(false);
  });

  it('exports defaults that are themselves inside the ceilings', () => {
    expect(LOAD_DEFAULT_VUS).toBeLessThanOrEqual(LOAD_MAX_VUS);
    expect(LOAD_DEFAULT_DURATION_SECONDS).toBeLessThanOrEqual(LOAD_MAX_DURATION_SECONDS);
  });
});

describe('LoadJobConfigurationSchema', () => {
  it('is the same bounds, with every value explicit', () => {
    expect(
      LoadJobConfigurationSchema.parse({ script: 'a.js', vus: 2, durationSeconds: 5 }),
    ).toEqual({
      script: 'a.js',
      vus: 2,
      durationSeconds: 5,
    });
    expect(LoadJobConfigurationSchema.safeParse({ script: 'a.js' }).success).toBe(false);
    expect(
      LoadJobConfigurationSchema.safeParse({ script: 'a.js', vus: 9999, durationSeconds: 5 })
        .success,
    ).toBe(false);
    expect(
      LoadJobConfigurationSchema.safeParse({ script: '../a.js', vus: 1, durationSeconds: 5 })
        .success,
    ).toBe(false);
  });
});
