import { describe, expect, it } from 'vitest';
import { isUsable } from '@automate/tool-sdk';
import { runApiAgent } from './api-adapter.js';

/**
 * The adapter behind `POST /api/v1/agents/api/:action`.
 *
 * This is the file the route's contract runs, and it is what `capability:evidence`
 * runs for the `automation.agents` register row. Two properties are load-bearing
 * and each is asserted against something that fails without it:
 *
 *  1. **The adapter proposes and never applies.** The result carries a task naming
 *     a test and a `diff` that is `null`, because there is no repository here to
 *     read and a diff invented without one is the thing the failure-first rule
 *     exists to refuse.
 *  2. **A request that cannot name a failing test is refused**, in the API's own
 *     shape, rather than answered with a placeholder a reviewer would merge.
 *
 * The clock and the randomness are injected, so the ttl assertion below is about
 * the adapter's own grant and not about whatever `Date.now()` happened to say.
 */

const fixedNow = () => 1_700_000_000_000;
let counter = 0;
const unique = () => `id-${String(++counter)}`;

/** @param overrides {Record<string, unknown>} */
function request(overrides = {}) {
  return {
    domain: 'api' as const,
    action: 'generate' as const,
    workspaceId: 'workspace-1',
    ...overrides,
  };
}

describe('the api domain adapter', () => {
  it('proposes a task that names the failing test, and a session that expires', () => {
    const outcome = runApiAgent(
      request({ specPath: 'packages/quality/gates.test.ts:42' }),
      fixedNow,
      unique,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe('proposed');
    expect(outcome.result.task.failingTest.location).toBe('packages/quality/gates.test.ts:42');
    // A short grant, and one that has already stopped being usable by the time the
    // ttl has elapsed — the adapter mints per request precisely so the lifetime is
    // the request's.
    const expiry = Date.parse(outcome.result.session.expiresAt);
    expect(isUsable(outcome.result.session as never, () => expiry + 1)).toBe(false);
  });

  it('never returns a diff, because there is no repository here to read', () => {
    const outcome = runApiAgent(request({ specPath: 'x.test.ts:1' }), fixedNow, unique);
    if (!outcome.ok) throw new Error('this request must be answered');
    expect(outcome.result.diff).toBeNull();
  });

  it('refuses a request that cannot name a failing test', () => {
    const outcome = runApiAgent(request(), fixedNow, unique);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.code).toBe('INVALID_REQUEST_BODY');
    expect(outcome.failure.message).toContain('failing test');
  });

  it('takes the failing test from the derived finding when no specPath is given', () => {
    // This is the shape the derived-finding loop actually supplies: the finding
    // carries the evidence that produced it, and the evidence is what a reviewer
    // reads. Without this, the adapter would refuse the only caller that has a
    // reason to call it.
    const outcome = runApiAgent(
      request({ metadata: { testLocation: 'apps/api/src/agents/api-adapter.test.ts:0' } }),
      fixedNow,
      unique,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.task.failingTest.location).toBe(
      'apps/api/src/agents/api-adapter.test.ts:0',
    );
  });

  it('mints a fresh grant per request, so no grant outlives an action', () => {
    // Two requests at two different times, so the grants are different grants rather
    // than the same grant read twice. Asserting on `Date.now()` here would make this
    // a test about the clock; injecting it makes it a test about the adapter.
    const first = runApiAgent(request({ specPath: 'a.test.ts:1' }), fixedNow, unique);
    const later = runApiAgent(
      request({ specPath: 'b.test.ts:2' }),
      () => fixedNow() + 60_000,
      unique,
    );
    if (!first.ok || !later.ok) throw new Error('both requests must be answered');
    expect(later.result.session.expiresAt).not.toBe(first.result.session.expiresAt);
    // Both grants are scoped to the three capabilities the domain declares — the
    // second request's grant is not wider than the first's.
    expect(first.result.session.capabilities).toEqual([
      'read-findings',
      'derive-task',
      'propose-diff',
    ]);
    expect(later.result.session.capabilities).toEqual(first.result.session.capabilities);
    expect(later.result.task.taskId).not.toBe(first.result.task.taskId);
  });
});
