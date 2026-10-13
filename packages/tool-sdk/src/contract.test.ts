import { describe, expect, it } from 'vitest';
import * as sdk from './index.js';
import {
  AGENT_CAPABILITIES,
  domainsFor,
  domainFor,
  isUsable,
  mintSessionToken,
  narrowTo,
  proposeDiff,
  proposeTask,
} from './index.js';

/**
 * The contract behind `POST /api/v1/agents/api/:action`.
 *
 * This is the file `capability:evidence` runs for the `automation.agents` row, so
 * every assertion here is a claim the register makes about the product. A row that
 * names a command whose failure would make it false is a `real` row; a row whose
 * command passes is a row somebody checked. That is the whole difference, and it is
 * why this test is written as the contract rather than as coverage.
 *
 * The four properties, each of which is a thing the closing plan asked for:
 *
 *  1. **A token is bounded** — by what the domain declares and by a clock, and the
 *     mint fails closed rather than trimming what was asked for.
 *  2. **A proposal names a failing test or does not exist.**
 *  3. **Nothing here writes.** Asserted by reading the export list, because the
 *     next function anyone adds is the one that breaks this.
 *  4. **The domains are the contract's**, not a second list.
 */

const fixedClock = () => 1_700_000_000_000;

/** A descriptor for the api domain, straight from the registry. */
function apiDescriptor() {
  const descriptor = domainFor('api');
  if (descriptor === null) throw new Error('the test below assumes the api domain is registered');
  return descriptor;
}

/** @param overrides {Record<string, unknown>} @returns {SessionToken} */
function mint(overrides = {}) {
  const token = mintSessionToken(
    {
      sessionId: 'session-1',
      subject: 'workspace-1',
      requested: [AGENT_CAPABILITIES.readFindings, AGENT_CAPABILITIES.deriveTask],
      ttlMs: 60_000,
      ...overrides,
    },
    apiDescriptor(),
    fixedClock,
  );
  if (token === null) throw new Error('minting a token for the api domain must succeed here');
  return token;
}

describe('what a session token grants', () => {
  it('grants only what the domain declares, and refuses the rest as a whole', () => {
    // The mint fails closed. Returning a trimmed token instead would be a boundary
    // that quietly accepts an over-broad request, and a caller learns to ask for
    // everything it might want rather than what it needs.
    expect(
      mintSessionToken(
        {
          sessionId: 'session-1',
          subject: 'workspace-1',
          requested: [AGENT_CAPABILITIES.deriveTask, 'write-repository'],
          ttlMs: 60_000,
        },
        apiDescriptor(),
        fixedClock,
      ),
    ).toBeNull();
  });

  it('refuses a wildcard outright, so no ask-everything path exists', () => {
    expect(
      mintSessionToken(
        {
          sessionId: 'session-1',
          subject: 'workspace-1',
          requested: ['*'],
          ttlMs: 60_000,
        },
        apiDescriptor(),
        fixedClock,
      ),
    ).toBeNull();
  });

  it('refuses an empty grant, a blank subject and a non-positive ttl', () => {
    const base = {
      sessionId: 'session-1',
      subject: 'workspace-1',
      ttlMs: 60_000,
    };
    expect(mintSessionToken({ ...base, requested: [] }, apiDescriptor(), fixedClock)).toBeNull();
    expect(
      mintSessionToken(
        { ...base, subject: ' ', requested: [AGENT_CAPABILITIES.deriveTask] },
        apiDescriptor(),
        fixedClock,
      ),
    ).toBeNull();
    expect(
      mintSessionToken(
        { ...base, ttlMs: 0, requested: [AGENT_CAPABILITIES.deriveTask] },
        apiDescriptor(),
        fixedClock,
      ),
    ).toBeNull();
  });

  it('expires, against the clock it is given rather than the wall one', () => {
    const token = mint();
    expect(isUsable(token, () => fixedClock() + 59_999)).toBe(true);
    expect(isUsable(token, () => fixedClock() + 60_000)).toBe(false);
    // A token with an unparseable expiry is not usable, rather than usable forever.
    expect(isUsable({ ...token, expiresAt: 'not-a-date' }, fixedClock)).toBe(false);
  });

  it('carries no credential, and is frozen so a grant cannot widen itself', () => {
    const token = mint({ requested: [AGENT_CAPABILITIES.deriveTask] });
    expect(Object.keys(token).sort()).toEqual([
      'capabilities',
      'domain',
      'expiresAt',
      'sessionId',
      'subject',
    ]);
    expect(Object.isFrozen(token)).toBe(true);
    // Two layers, and the second is the runtime one: the field is `readonly`, so a
    // widening does not compile, and the array is frozen, so the same attempt
    // through an untyped handle throws. The cast is the point — it is how the
    // attempt gets made at all.
    expect(Object.isFrozen(token.capabilities)).toBe(true);
    expect(() => {
      (token.capabilities as string[]).push('write-repository');
    }).toThrow();
    expect(token.capabilities).toEqual([AGENT_CAPABILITIES.deriveTask]);
  });

  it('narrows, and cannot widen', () => {
    const token = mint();
    const narrower = narrowTo(token, [AGENT_CAPABILITIES.deriveTask]);
    expect(narrower?.capabilities).toEqual([AGENT_CAPABILITIES.deriveTask]);
    // Asking for what the original did not grant returns null rather than a wider
    // token — there is no function here that takes a token and returns more grant.
    expect(narrowTo(token, [AGENT_CAPABILITIES.readFindings, 'write-repository'])).toBeNull();
  });
});

describe('what a proposal is', () => {
  const failing = {
    name: 'the api adapter refuses a proposal that names no test',
    location: 'packages/tool-sdk/src/contract.test.ts:0',
    message: 'a proposal must name the test that fails',
  };

  it('refuses a task that cannot name a failing test', () => {
    // The failure-first rule, as a refusal rather than as documentation.
    expect(() =>
      proposeTask({ taskId: 't1', summary: 's', test: { ...failing, name: '' } }),
    ).toThrow(/PROPOSAL_REQUIRES_A_FAILING_TEST/);
    expect(() =>
      proposeTask({ taskId: 't1', summary: 's', test: { ...failing, location: '' } }),
    ).toThrow(/PROPOSAL_REQUIRES_A_FAILING_TEST/);
  });

  it('refuses an empty diff, so a proposal is a change and not a note', () => {
    const task = proposeTask({ taskId: 't1', summary: 's', test: failing });
    expect(() => proposeDiff(task, '   ')).toThrow(/empty diff/);
  });

  it('carries the failing test through to the diff a reviewer reads', () => {
    const task = proposeTask({ taskId: 't1', summary: 's', test: failing });
    const diff = proposeDiff(task, 'diff --git a/x b/x');
    expect(diff.failingTest).toEqual(task.failingTest);
    expect(Object.isFrozen(diff)).toBe(true);
  });
});

describe('what this module does not do', () => {
  it('exports nothing that writes to a repository', () => {
    // The next function added here is the one that breaks the rule, so the rule is
    // asserted against the export list rather than against a hand-written one — an
    // allowlist of names would be a second authority that stops tracking the code.
    const forbidden = Object.keys(sdk).filter((name) =>
      /^(write|commit|push|create|delete|save|patch|upload)/i.test(name),
    );
    expect(forbidden).toEqual([]);
    // The four halves are still all reachable, so an assertion that passes because
    // the module stopped exporting anything is not a green.
    for (const name of [
      'mintSessionToken',
      'isUsable',
      'narrowTo',
      'proposeTask',
      'proposeDiff',
      'domainsFor',
      'domainFor',
    ]) {
      expect(Object.keys(sdk)).toContain(name);
    }
  });

  it('declares no capability that would let an agent write, in any domain', () => {
    const declared = Object.values(AGENT_CAPABILITIES);
    for (const descriptor of domainsFor()) {
      for (const capability of descriptor.capabilities) {
        // A capability is one of the three the module names. A fourth capability
        // that nobody declared is a grant this file does not know about.
        expect(declared).toContain(capability);
      }
    }
    expect(sdk.NEVER_GRANTED).toEqual([
      'write-repository',
      'commit',
      'push',
      'create-file',
      'delete-file',
    ]);
  });
});

describe('which domains exist', () => {
  it('reads them from the contract, so a second list is impossible by construction', () => {
    // If `AgentDomainSchema` gains a domain, this package's list gains it too. The
    // two cannot disagree, because one of them is derived.
    expect(sdk.CONTRACT_DOMAINS).toContain('api');
    expect(domainsFor().map((descriptor) => descriptor.domain)).toEqual(['api']);
    expect(domainFor('performance')).toBeNull();
  });

  it('implements exactly one domain, which is the plan the register row records', () => {
    // One real adapter over five thin ones. The other four domains remain in the
    // contract and unimplemented here, which is what keeps their register rows an
    // honest `mock` rather than a claim.
    expect(domainsFor()).toHaveLength(1);
  });
});
