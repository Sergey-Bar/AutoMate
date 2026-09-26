import { describe, expect, it } from 'vitest';
import { looksLikeSecret, REDACTED, sanitizeOutboxEnvelope } from './outbox-sanitizer.js';
import {
  syntheticAwsKeyId,
  syntheticConnectionString,
  syntheticGithubFineGrainedToken,
  syntheticGithubToken,
  syntheticJwt,
  syntheticPrivateKeyBlock,
  syntheticSlackToken,
} from './synthetic-credentials.js';

describe('outbox payload sanitizer', () => {
  it('keeps the keys the store is allowed to publish', () => {
    const sanitized = sanitizeOutboxEnvelope({
      runId: 'run-1',
      jobId: 'job-1',
      eventId: 'event-1',
      sequence: 3,
      type: 'test.completed',
      occurredAt: '2026-09-25T00:00:00.000Z',
      outcome: 'passed',
      phase: 'complete',
      status: 'completed',
    });
    expect(Object.keys(sanitized).sort()).toEqual([
      'eventId',
      'jobId',
      'occurredAt',
      'outcome',
      'phase',
      'runId',
      'sequence',
      'status',
      'type',
    ]);
  });

  it('keeps fencingToken, which the old denylist dropped for matching /token/', () => {
    const sanitized = sanitizeOutboxEnvelope({ runId: 'run-1', fencingToken: 7 });
    expect(sanitized['fencingToken']).toBe(7);
  });

  it('drops a lease credential even though nothing about the key looks sensitive', () => {
    const sanitized = sanitizeOutboxEnvelope({
      runId: 'run-1',
      leaseId: 'lease-secret',
      fencingToken: 1,
    });
    expect(sanitized).not.toHaveProperty('leaseId');
    expect(sanitized).toHaveProperty('fencingToken');
  });

  it('drops any key that is not on the allowlist', () => {
    const sanitized = sanitizeOutboxEnvelope({
      runId: 'run-1',
      configuration: { anything: 'goes' },
      rawArgs: '--dangerous',
    });
    expect(sanitized).toEqual({ runId: 'run-1' });
  });

  describe('value-level secret detection', () => {
    // Assembled rather than written: these match real provider token patterns,
    // and committing them as literals is committing something a secret scanner
    // must flag. `synthetic-credentials.ts` explains why that is worth doing
    // rather than asking for an exemption.
    it.each([
      ['PEM private key', syntheticPrivateKeyBlock()],
      ['GitHub token', syntheticGithubToken()],
      ['GitHub fine-grained token', syntheticGithubFineGrainedToken()],
      ['AWS access key id', syntheticAwsKeyId()],
      ['Slack token', syntheticSlackToken()],
      ['JWT', syntheticJwt()],
      ['bearer header', 'Bearer abcdefghijklmnop'],
      ['credential in a connection string', syntheticConnectionString()],
    ])('redacts a %s', (_label, secret) => {
      expect(looksLikeSecret(secret)).toBe(true);
      const sanitized = sanitizeOutboxEnvelope({ runId: 'run-1', payload: { note: secret } });
      expect((sanitized['payload'] as { note: string }).note).toBe(REDACTED);
    });

    it('drops a nested key whose name denotes a credential', () => {
      const sanitized = sanitizeOutboxEnvelope({
        runId: 'run-1',
        payload: { testId: 'test-1', title: 'checkout', apiKey: 'anything' },
      });
      expect(sanitized['payload']).toEqual({ testId: 'test-1', title: 'checkout' });
    });

    it('keeps a nested key that merely contains a non-credential word', () => {
      const sanitized = sanitizeOutboxEnvelope({
        runId: 'run-1',
        payload: { tokenizedInput: 'abc', passwordPolicy: 'none' },
      });
      expect(sanitized['payload']).toEqual({ tokenizedInput: 'abc' });
    });

    it('accepts that a credential-shaped key name is dropped even when harmless', () => {
      // Deliberate trade-off: a false positive costs one dropped metadata
      // field, a false negative leaks a credential into the durable stream.
      const sanitized = sanitizeOutboxEnvelope({ runId: 'run-1', payload: { private: 1 } });
      expect(sanitized['payload']).toEqual({});
    });

    it('does not redact a sha256 digest, which is legitimate evidence', () => {
      const digest = 'a'.repeat(64);
      expect(looksLikeSecret(digest)).toBe(false);
      const sanitized = sanitizeOutboxEnvelope({ runId: 'run-1', payload: { checksum: digest } });
      expect((sanitized['payload'] as { checksum: string }).checksum).toBe(digest);
    });

    it('does not redact ordinary evidence text', () => {
      const sanitized = sanitizeOutboxEnvelope({
        runId: 'run-1',
        payload: { title: 'signs in as a user', file: 'tests/login.spec.ts' },
      });
      expect(sanitized['payload']).toEqual({
        title: 'signs in as a user',
        file: 'tests/login.spec.ts',
      });
    });
  });

  describe('bounds', () => {
    it('truncates over-long text', () => {
      const sanitized = sanitizeOutboxEnvelope({ runId: 'r', payload: { note: 'x'.repeat(5000) } });
      expect((sanitized['payload'] as { note: string }).note).toHaveLength(1024);
    });

    it('caps array breadth', () => {
      const items = Array.from({ length: 500 }, (_value, index) => index);
      const sanitized = sanitizeOutboxEnvelope({ runId: 'r', payload: { items } });
      expect((sanitized['payload'] as { items: number[] }).items).toHaveLength(100);
    });

    it('stops recursing at the depth limit instead of following an arbitrary nest', () => {
      let deep: Record<string, unknown> = { value: 'bottom' };
      for (let index = 0; index < 12; index += 1) deep = { nested: deep };
      const sanitized = sanitizeOutboxEnvelope({ runId: 'r', payload: deep });
      // The nest is truncated at the documented depth, so the deepest value is
      // replaced by null rather than being carried into the outbox.
      expect(JSON.stringify(sanitized['payload'])).not.toContain('bottom');
      expect(JSON.stringify(sanitized['payload'])).toContain('null');
    });

    it('drops function and symbol values', () => {
      const sanitized = sanitizeOutboxEnvelope({
        runId: 'r',
        payload: { fn: () => 'nope', sym: Symbol('nope') } as Record<string, unknown>,
      });
      expect(sanitized['payload']).toEqual({ fn: null, sym: null });
    });
  });
});
