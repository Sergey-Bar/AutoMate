/**
 * `@automate/tool-sdk` — the boundary between the console and an agent that acts.
 *
 * The console mints a bounded token, an adapter acts inside it, and what the
 * adapter produces is a proposal a human reads. Nothing here writes to a
 * repository, and that is the property the contract test asserts by reading the
 * export list rather than by trusting the prose.
 *
 * The three halves, and the reason each is its own module:
 *
 * | Module | Owns |
 * |---|---|
 * | `session-token.ts` | what a grant carries and when it stops being valid |
 * | `proposal.ts` | the shape of a proposal, and the failure-first rule as code |
 * | `domain.ts` | which domains exist, read from the contract that declares them |
 *
 * The seam is the same one `@automate/reporter` uses for coverage formats: the API
 * holds the adapter, this package owns the envelope, and the semantics of a domain
 * live with the domain. A second place the envelopes are declared is a second place
 * a capability can be granted from.
 */

export {
  mintSessionToken,
  isUsable,
  narrowTo,
  type SessionToken,
  type DomainDescriptor,
  type Clock,
} from './session-token.js';
export {
  proposeTask,
  proposeDiff,
  AGENT_CAPABILITIES,
  NO_FAILING_TEST,
  type FailingTest,
  type TaskProposal,
  type DiffProposal,
} from './proposal.js';
export { domainsFor, domainFor, CONTRACT_DOMAINS, NEVER_GRANTED } from './domain.js';
