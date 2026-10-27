import type { AccessRole, RoleRule } from '@automate/config';

/**
 * The role a role map gives an identity — one rule for every identity source, Cloudflare
 * Access and OIDC (ADR-014): the highest role any rule grants, or the default when no rule
 * names it. An email rule never matches a service token, which has no email.
 */
export interface MappedIdentity {
  email: string | null;
  groups: readonly string[];
  serviceTokenId: string | null;
}

const ROLE_ORDER: readonly AccessRole[] = ['viewer', 'operator', 'admin'];

/** The highest role a rule grants this identity, or `null` when no rule names it. */
export function ruleRoleFor(
  identity: MappedIdentity,
  rules: readonly RoleRule[],
): AccessRole | null {
  const email = identity.email?.toLowerCase() ?? null;
  const domain = email === null ? null : email.slice(email.lastIndexOf('@') + 1);
  let best = -1;
  for (const rule of rules) {
    const matches =
      (rule.kind === 'email' && email === rule.value) ||
      (rule.kind === 'domain' && domain === rule.value) ||
      (rule.kind === 'group' && identity.groups.includes(rule.value)) ||
      (rule.kind === 'service' && identity.serviceTokenId === rule.value);
    if (matches) best = Math.max(best, ROLE_ORDER.indexOf(rule.role));
  }
  return best === -1 ? null : (ROLE_ORDER[best] ?? null);
}

export function roleForIdentity(
  identity: MappedIdentity,
  access: { roleMap: readonly RoleRule[]; defaultRole: AccessRole | null },
): AccessRole | null {
  return ruleRoleFor(identity, access.roleMap) ?? access.defaultRole;
}
