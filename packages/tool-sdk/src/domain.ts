/**
 * The domains an agent may be registered for, derived from the contract.
 *
 * The contract that declares them is `AgentDomainSchema` in
 * `@automate/shared-contracts`, and this module reads it rather than restating it.
 * That is the same rule `apps/api/src/routes/agents.ts` follows, and the reason is
 * the same: a second list is how the boundary ends up registering a domain the
 * contract does not describe, and how the API ends up refusing a domain the
 * boundary grants.
 *
 * Only `api` has a descriptor today. The other four exist in the contract and are
 * deliberately **not** described here, because the plan is explicit that one real
 * domain beats five thin ones: a `mock` row is a honest record of an absence, and
 * five adapters that each answer a canned response are five `mock` rows. When one
 * of the other four is genuinely implemented, it gets a descriptor beside this one
 * and the register row that names it moves on the strength of a command.
 */

import { AgentDomainSchema } from '@automate/shared-contracts';
import type { DomainDescriptor } from './session-token.js';
import { AGENT_CAPABILITIES } from './proposal.js';

/** Every domain the contract declares. Read from the schema, never written out. */
export const CONTRACT_DOMAINS: readonly string[] = AgentDomainSchema.options;

/** The domains this package has a real adapter for. */
const DESCRIPTORS: Readonly<Record<string, DomainDescriptor>> = {
  api: {
    domain: 'api',
    capabilities: [
      AGENT_CAPABILITIES.readFindings,
      AGENT_CAPABILITIES.deriveTask,
      AGENT_CAPABILITIES.proposeDiff,
    ],
    description:
      'Turns a derived API-quality finding into a task naming the test that fails, and ' +
      'a proposed diff against that task. Proposes; never applies.',
  },
};

/** The one capability an api agent may not be granted: writing to a repository. */
export const NEVER_GRANTED: readonly string[] = Object.freeze([
  'write-repository',
  'commit',
  'push',
  'create-file',
  'delete-file',
]);

/**
 * The descriptors this package ships, keyed by domain.
 *
 * Only domains with a descriptor are returned — a domain the contract declares and
 * this package does not implement is absent rather than present with no
 * capabilities, because "declared and unimplemented" is the `mock` row's own
 * vocabulary and collapsing the two would hide it.
 *
 * @returns the implemented domains, in the contract's own order
 */
export function domainsFor(): readonly DomainDescriptor[] {
  return CONTRACT_DOMAINS.map((domain) => DESCRIPTORS[domain]).filter(
    (descriptor): descriptor is DomainDescriptor => descriptor !== undefined,
  );
}

/** The descriptor for one domain, or `null` when this package does not implement it. */
export function domainFor(domain: string): DomainDescriptor | null {
  return DESCRIPTORS[domain] ?? null;
}
