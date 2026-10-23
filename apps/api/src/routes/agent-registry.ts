/**
 * Which agent domains exist, and which of them can execute anything yet.
 *
 * One registry, read by two endpoints that used to disagree: `/api/v1/agents` listed five
 * domains from a hand-written array, and `/api/v1/features` returned `features: {}` from a
 * literal — so one said the platform has five agents and the other said it has none, in the
 * same process, at the same moment. Both were "correct" against their own source, which is
 * what made it a defect rather than a bug: there was no value to compare, only two.
 *
 * Availability is **derived from the tool registry** the dispatch uses
 * (`@automate/tool-sdk`'s `ToolRegistry`), not declared beside it: a domain is available
 * exactly when an adapter has been registered for at least one of its actions, so the
 * advertisement and the behaviour cannot part company. That registry is built once, in the
 * composition root (`index.ts`); an app composed without adapters — as most tests are —
 * reports every domain unavailable and answers every pair `501`.
 *
 * Split out of `routes/agents.ts` so `/api/v1/features` can answer without importing the
 * router.
 */
import { AgentDomainSchema } from '@automate/shared-contracts';
import { AGENT_ACTIONS, type ToolRegistry } from '@automate/tool-sdk';
import { BROWSER_UNSUPPORTED_REASONS } from '../agents/browser-adapter.js';
import { LOAD_UNSUPPORTED_REASONS } from '../agents/load-adapter.js';

/** Every domain the contract declares, in the contract's own order. */
export const AGENT_DOMAINS: readonly string[] = AgentDomainSchema.options;

/**
 * Why a pair that a *configured* domain does not serve still answers `501`, keyed
 * `<domain>.<action>`. Only pairs with a real reason are listed; an unconfigured domain's
 * refusal needs none — "no adapter" is the whole reason.
 */
const UNSUPPORTED_REASONS: Readonly<Record<string, string>> = Object.fromEntries(
  (
    [
      ['browser', BROWSER_UNSUPPORTED_REASONS],
      ['load', LOAD_UNSUPPORTED_REASONS],
    ] as const
  ).flatMap(([domain, reasons]) =>
    Object.entries(reasons).map(([action, reason]) => [`${domain}.${action}`, reason]),
  ),
);

export interface AgentCatalog {
  /** Whether this build can execute work in `domain`. */
  available(domain: string): boolean;
  /** The actions of `domain` that have an adapter, in the contract's order. */
  actions(domain: string): string[];
  /** The documented reason an unregistered pair of a configured domain is unsupported. */
  unsupportedReasons(domain: string): Record<string, string>;
  reasonFor(domain: string, action: string): string | undefined;
}

/**
 * The catalog over a tool registry. Closures rather than methods on `this`, so
 * `catalog.available` can be handed to `createHealthRoutes` as a bare function.
 */
export function createAgentCatalog(registry: ToolRegistry): AgentCatalog {
  const actions = (domain: string): string[] =>
    AGENT_ACTIONS.filter((action) => registry.has(domain, action));
  const reasonFor = (domain: string, action: string): string | undefined =>
    registry.has(domain, action) ? undefined : UNSUPPORTED_REASONS[`${domain}.${action}`];
  return {
    available: (domain) => registry.configuredDomains().some((configured) => configured === domain),
    actions,
    reasonFor,
    unsupportedReasons: (domain) =>
      Object.fromEntries(
        AGENT_ACTIONS.flatMap((action) => {
          const reason = reasonFor(domain, action);
          return reason === undefined ? [] : [[action, reason]];
        }),
      ),
  };
}
