import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AGENT_ACTIONS,
  AGENT_DOMAINS,
  DEFAULT_RETRIES,
  defineOperation,
  runResultOperation,
} from './operation.js';

const base = {
  domain: 'load',
  action: 'run',
  input: z.object({ script: z.string() }),
  output: z.object({ ok: z.boolean() }),
  normalise: (raw: unknown) => raw,
  idempotent: true,
  timeoutMs: 1_000,
} as const;

describe('the vocabulary', () => {
  it('is the contract own, not a second copy', () => {
    expect([...AGENT_DOMAINS]).toEqual(['browser', 'api', 'load', 'security', 'mobile']);
    expect([...AGENT_ACTIONS]).toEqual(['generate', 'run', 'scan']);
  });
});

describe('defineOperation', () => {
  it('fills in the retry budget and keeps what it was given', () => {
    const operation = defineOperation(base);
    expect(operation.retries).toBe(DEFAULT_RETRIES);
    expect(operation.idempotent).toBe(true);
    expect(operation.timeoutMs).toBe(1_000);
    expect(defineOperation({ ...base, retries: 0 }).retries).toBe(0);
  });

  it('refuses a timeout that could never be met', () => {
    expect(() => defineOperation({ ...base, timeoutMs: 0 })).toThrow(/timeoutMs/);
    expect(() => defineOperation({ ...base, timeoutMs: Number.NaN })).toThrow(/timeoutMs/);
    expect(() => defineOperation({ ...base, timeoutMs: 1.5 })).toThrow(/timeoutMs/);
  });

  it('refuses a retry budget that is not a non-negative integer', () => {
    expect(() => defineOperation({ ...base, retries: -1 })).toThrow(/retries/);
    expect(() => defineOperation({ ...base, retries: 1.5 })).toThrow(/retries/);
  });
});

describe('runResultOperation', () => {
  it('fixes the output to the canonical run result', () => {
    const operation = runResultOperation({
      domain: 'api',
      action: 'run',
      input: z.object({}),
      idempotent: false,
      timeoutMs: 5,
      normalise: () => ({}),
    });
    // An empty object is not a run result, so this operation could never succeed with it.
    expect(operation.output.safeParse({}).success).toBe(false);
    expect(operation.idempotent).toBe(false);
  });
});
