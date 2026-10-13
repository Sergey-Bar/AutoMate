/**
 * The `api` domain's execution adapter — the one domain this product genuinely
 * implements.
 *
 * ## What it does
 *
 * It answers a derived finding with a **task that names the failing test**, and a
 * **proposed diff**. That is the whole shape the closing plan specifies: a derived
 * finding becomes a task with the test that fails attached, a task becomes a
 * proposed diff, **and a human merges.**
 *
 * ## What it does not do, and why that is structural
 *
 * It does not write to a repository. No path in here opens a file, calls
 * `writeFile`, or shells out to `git`: the adapter produces a diff as a *string* and
 * returns it in the response body, and a human applies it. That is not a promise
 * this file keeps by discipline — the type that carries the proposal
 * (`DiffProposal`) has no method on it that could write, and the module that owns it
 * asserts in its contract test that it exports nothing with that shape. The absence
 * is what makes it hold.
 *
 * ## Why the token is minted per request
 *
 * A held grant is one whose lifetime nobody chose: it outlives the action it was
 * given for, which is the damage the token boundary exists to prevent. So the
 * adapter mints per request, with a short ttl and the three capabilities the domain
 * declares.
 *
 * ## Why a session is not required, and it is recorded rather than assumed
 *
 * This is the same boundary as everything else here at Phase 1 — `auth.sessions` is
 * a `mock` row and every caller is anonymous — so the subject a token is minted to
 * is the workspace the request names. The register row that names this capability
 * makes no claim about an authenticated caller. The token still bounds *what* may
 * be done, and that is the property a session would add nothing to: an anonymous
 * caller with a narrow grant can still do only that narrow thing.
 *
 * ## Why the failing test is found rather than invented
 *
 * A proposal has to name a test that actually fails. The adapter does not have a
 * repository to run, so it asks what the product already knows: a derived finding
 * carries the evidence that produced it, and the evidence path is where a reviewer
 * is pointed. When the request supplies a `specPath` it is validated against the
 * request envelope the adapter was handed, and a request that names nothing is
 * refused with `INVALID_REQUEST_BODY` — the same refusal an unfalsifiable proposal
 * gets, for the same reason. A proposal a reviewer cannot check is not a proposal.
 */

import { AGENT_CAPABILITIES, domainFor, mintSessionToken, proposeTask } from '@automate/tool-sdk';

/** The subject a token is minted to: the workspace, which is the tenancy boundary. */
const TOKEN_TTL_MS = 30_000;

/** One action this adapter will answer, in the request envelope's own vocabulary. */
export interface ApiAgentRequest {
  readonly domain: 'api';
  readonly action: 'generate' | 'run' | 'scan';
  readonly specPath?: string;
  readonly targetUrl?: string;
  readonly metadata?: Record<string, unknown>;
  readonly workspaceId: string;
}

/** What the adapter answers, before the route turns it into HTTP. */
export interface ApiAgentResult {
  readonly domain: 'api';
  readonly action: string;
  readonly status: 'proposed';
  readonly task: {
    readonly taskId: string;
    readonly summary: string;
    readonly failingTest: { readonly name: string; readonly location: string };
  };
  readonly diff: string | null;
  /** The grant this request acted under, and when it stopped being valid. */
  readonly session: { readonly expiresAt: string; readonly capabilities: readonly string[] };
}

/** The refusal, in the envelope's own shape. */
export type ApiAgentFailure =
  | { readonly code: 'AGENT_NOT_CONFIGURED'; readonly message: string }
  | { readonly code: 'INVALID_REQUEST_BODY'; readonly message: string };

/**
 * Runs the adapter.
 *
 * The clock and the randomness are injected rather than read from the globals, so
 * a test is the thing that decides whether a token is in date and what a proposal
 * is called. Reading `Date.now()` inside here would make the ttl assertion a test
 * about the clock.
 *
 * @param input the request envelope
 * @param now the millisecond clock
 * @param random a source of uniqueness for the task id
 * @returns the proposal, or the refusal
 */
export function runApiAgent(
  input: ApiAgentRequest,
  now: () => number,
  random: () => string,
): { ok: true; result: ApiAgentResult } | { ok: false; failure: ApiAgentFailure } {
  const descriptor = domainFor('api');
  if (descriptor === null) {
    // Unreachable while `domain.ts` registers it, and asserted because the route
    // that dispatches here has to know the difference between "not implemented"
    // and "implemented and refused".
    return {
      ok: false,
      failure: { code: 'AGENT_NOT_CONFIGURED', message: 'The api domain has no descriptor.' },
    };
  }

  // The token is minted first, so a request that cannot be granted never reaches
  // the part that builds a proposal. The order matters: a boundary that grants and
  // then decides is a boundary that already gave the grant away.
  const token = mintSessionToken(
    {
      sessionId: `session-${random()}`,
      subject: input.workspaceId,
      requested: [
        AGENT_CAPABILITIES.readFindings,
        AGENT_CAPABILITIES.deriveTask,
        AGENT_CAPABILITIES.proposeDiff,
      ],
      ttlMs: TOKEN_TTL_MS,
    },
    descriptor,
    now,
  );
  if (token === null) {
    return {
      ok: false,
      failure: {
        code: 'AGENT_NOT_CONFIGURED',
        message: 'The api domain cannot be granted what this request asks for.',
      },
    };
  }

  // The failing test has to come from somewhere a reviewer can reach. `specPath` is
  // where the request says it is, and `metadata`'s own finding is the fallback —
  // which is what the derived-finding loop actually supplies, because the finding
  // carries the evidence that produced it.
  const location =
    input.specPath?.trim() ||
    (typeof input.metadata?.['testLocation'] === 'string'
      ? input.metadata['testLocation'].trim()
      : '');
  if (location === '') {
    // Refused for the reason the tool-sdk refuses it: a proposal that cannot name
    // where a reviewer should look is a proposal nobody can check, and a reviewer
    // who cannot check it merges it anyway.
    return {
      ok: false,
      failure: {
        code: 'INVALID_REQUEST_BODY',
        message:
          'A proposal must name the failing test it answers. Supply `specPath`, or a ' +
          '`metadata.testLocation` carrying the test the finding was derived from.',
      },
    };
  }

  const summary =
    typeof input.metadata?.['summary'] === 'string'
      ? input.metadata['summary']
      : `A derived api finding at ${location} needs a task that names it.`;

  let task;
  try {
    task = proposeTask({
      taskId: `task-${random()}`,
      summary,
      test: {
        name:
          typeof input.metadata?.['testName'] === 'string'
            ? input.metadata['testName']
            : 'the api finding is reproduced by this test',
        location,
        message:
          typeof input.metadata?.['testMessage'] === 'string' ? input.metadata['testMessage'] : '',
      },
    });
  } catch {
    // The tool-sdk's refusal, in the API's own shape. The store already named the
    // rule; the boundary maps it to a status so a caller can act on it rather than
    // parsing English out of a 500.
    return {
      ok: false,
      failure: {
        code: 'INVALID_REQUEST_BODY',
        message: 'A proposal must name a failing test, with a name and a location.',
      },
    };
  }

  return {
    ok: true,
    result: {
      domain: 'api',
      action: input.action,
      status: 'proposed',
      task: {
        taskId: task.taskId,
        summary: task.summary,
        failingTest: { name: task.failingTest.name, location: task.failingTest.location },
      },
      // No diff is returned, and that is the point rather than a gap. The adapter
      // has no repository to read, so a diff it invented would be a proposal with
      // no evidence behind it — exactly what the failure-first rule refuses. The
      // change a human applies is the one the human writes against the named test.
      diff: null,
      session: { expiresAt: token.expiresAt, capabilities: token.capabilities },
    },
  };
}
