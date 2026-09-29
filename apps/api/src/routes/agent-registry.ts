/**
 * Which agent domains exist, and which of them can execute anything yet.
 *
 * One registry, read by two endpoints that used to disagree: `/api/v1/agents`
 * listed five domains from a hand-written array, and `/api/v1/features` returned
 * `features: {}` from a literal — so one said the platform has five agents and the
 * other said it has none, in the same process, at the same moment. Both were
 * "correct" against their own source, which is what made it a defect rather than a
 * bug: there was no value to compare, only two.
 *
 * Split out of `routes/agents.ts` so `/api/v1/features` can answer without
 * importing the router, and so the answer is derived rather than restated in each
 * place.
 *
 * The availability question is answered honestly today: **no** domain has a
 * configured execution adapter, so every entry is `false`. That is a product
 * state, not a placeholder — a bounded adapter that refuses with a reason is a
 * decision, and this registry is where that decision is recorded so the API
 * advertises it rather than omitting it.
 */
import { AgentDomainSchema } from '@automate/shared-contracts';

/** Every domain the contract declares, in the contract's own order. */
export const AGENT_DOMAINS: readonly string[] = AgentDomainSchema.options;

/**
 * Domains with a configured execution adapter.
 *
 * Empty, and the reason the refusal bodies in `routes/agents.ts` exist at all: a
 * registered pair with no adapter is a 501 with a `not_configured` body, which is a
 * decision the caller can read. Adding an adapter means adding its id here, and
 * `/api/v1/features` starts reporting it — which is why this is a list rather than
 * a hard-coded `true`.
 */
const DOMAINS_WITH_ADAPTERS = new Set<string>();

/**
 * Whether this build can execute work in `domain`.
 *
 * @param domain a value from `AgentDomainSchema`
 */
export function agentAvailability(domain: string): boolean {
  return DOMAINS_WITH_ADAPTERS.has(domain);
}
