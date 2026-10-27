/**
 * Remote access through Cloudflare Tunnel and Cloudflare Access (ADR-014).
 *
 * The settings are read and validated here, once, so a malformed team domain or role map is
 * a startup error naming the variable rather than a request-time surprise. Verifying the
 * `Cf-Access-Jwt-Assertion` header is the API's job (`apps/api/src/http/cloudflare-access.ts`).
 */
export const REMOTE_MODES = ['cloudflare'] as const;
export type RemoteMode = (typeof REMOTE_MODES)[number];

export const ACCESS_ROLES = ['viewer', 'operator', 'admin'] as const;
export type AccessRole = (typeof ACCESS_ROLES)[number];

/** One rule of a role map: who it matches, and the role it grants. */
export interface RoleRule {
  role: AccessRole;
  /** A person by email, every person at an email domain, a forwarded group, or a service token. */
  kind: 'email' | 'domain' | 'group' | 'service';
  /** Lowercased for `email` and `domain`; as written for `group` and `service`. */
  value: string;
}

/** One rule of `CF_ACCESS_ROLE_MAP`. */
export type CloudflareRoleRule = RoleRule;

export interface CloudflareAccessConfig {
  /** `<team>.cloudflareaccess.com`. */
  teamDomain: string;
  /** The Access application's audience (AUD) tag. */
  audience: string;
  roleMap: CloudflareRoleRule[];
  /** The role of an identity no rule names; `null` admits nobody the map does not name. */
  defaultRole: AccessRole | null;
}

const TEAM_SUFFIX = '.cloudflareaccess.com';

/** One DNS label: letters, digits and inner hyphens, at most 63 characters. */
function isTeamLabel(label: string): boolean {
  return (
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z0-9-]+$/u.test(label) &&
    !label.startsWith('-') &&
    !label.endsWith('-')
  );
}

/**
 * The team domain from whatever an operator pasted: the team name, the domain, or the URL.
 *
 * Strict on purpose: the result becomes both the issuer every token must name and the host
 * the signing keys are fetched from, so anything that is not exactly a Cloudflare Access team
 * domain — another host, a path, userinfo, plain HTTP — is refused rather than used.
 */
export function normalizeCloudflareTeamDomain(value: string): string {
  let domain = value.trim().toLowerCase();
  if (domain.startsWith('https://')) domain = domain.slice('https://'.length);
  if (domain.endsWith('/')) domain = domain.slice(0, -1);
  if (domain !== '' && !domain.includes('.') && !domain.includes(':')) {
    domain = `${domain}.cloudflareaccess.com`;
  }
  if (!domain.endsWith(TEAM_SUFFIX) || !isTeamLabel(domain.slice(0, -TEAM_SUFFIX.length))) {
    throw new Error(
      'CF_ACCESS_TEAM_DOMAIN must be your Cloudflare Access team, like acme or ' +
        `acme.cloudflareaccess.com; got ${JSON.stringify(value)}`,
    );
  }
  return domain;
}

function isAccessRole(value: string): value is AccessRole {
  return (ACCESS_ROLES as readonly string[]).includes(value);
}

/**
 * `CF_ACCESS_ROLE_MAP`: comma-separated `role:who` rules, where `who` is an email, `*@domain`,
 * `group:<name>` or `service:<client id>`. An identity gets the highest role any rule grants.
 */
export function parseCloudflareRoleMap(value: string | undefined): CloudflareRoleRule[] {
  return parseRoleMap('CF_ACCESS_ROLE_MAP', value);
}

/**
 * One role-map grammar for every identity source — `CF_ACCESS_ROLE_MAP` and
 * `OIDC_ROLE_MAP` — so an operator learns it once and the two cannot drift.
 *
 * @param variable named in every refusal
 */
export function parseRoleMap(variable: string, value: string | undefined): RoleRule[] {
  const rules: RoleRule[] = [];
  for (const raw of (value ?? '').split(',')) {
    const rule = raw.trim();
    if (rule === '') continue;
    const refuse = (why: string): never => {
      throw new Error(`${variable}: ${JSON.stringify(rule)} ${why}`);
    };
    const at = rule.indexOf(':');
    const role = at === -1 ? rule : rule.slice(0, at);
    const who = at === -1 ? '' : rule.slice(at + 1).trim();
    if (!isAccessRole(role)) refuse('must start with viewer:, operator: or admin:');
    const granted = role as AccessRole;
    if (who.startsWith('group:') && who.length > 'group:'.length) {
      rules.push({ role: granted, kind: 'group', value: who.slice('group:'.length) });
    } else if (who.startsWith('service:') && who.length > 'service:'.length) {
      rules.push({ role: granted, kind: 'service', value: who.slice('service:'.length) });
    } else if (who.startsWith('*@') && who.length > 2 && !who.slice(2).includes('@')) {
      rules.push({ role: granted, kind: 'domain', value: who.slice(2).toLowerCase() });
    } else if (/^[^@\s]+@[^@\s]+$/u.test(who)) {
      rules.push({ role: granted, kind: 'email', value: who.toLowerCase() });
    } else {
      refuse('must name an email, *@domain, group:<name> or service:<client id>');
    }
  }
  return rules;
}
