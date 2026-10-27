/**
 * Deployment profiles: one install, sized by `AUTOMATE_PROFILE` (ADR-014).
 *
 * A profile sets **defaults only**. Every value it sets has its own variable, and an
 * explicit variable wins; a combination that contradicts itself is refused by the API's
 * startup policy (`checkExposurePolicy`), by name, rather than silently resolved here.
 *
 * Fields are added to {@link ProfileDefaults} as the setting they default lands, so the
 * table never carries a default that nothing reads.
 */
export const PROFILES = ['solo', 'startup', 'team', 'enterprise'] as const;
export type Profile = (typeof PROFILES)[number];

export interface ProfileDefaults {
  /** `ACCESS_CONTROL` when it is unset: only `solo` keeps ADR-006's single open operator. */
  accessControl: 'open' | 'enforced';
  /**
   * `AUTH_SSO_ENFORCED` when it is unset: a browser signs in through single sign-on only, and
   * the installation key works only under `AUTOMATE_BREAK_GLASS=1`. Tokens for CI still work.
   */
  ssoEnforced: boolean;
}

const DEFAULTS: Record<Profile, ProfileDefaults> = {
  solo: { accessControl: 'open', ssoEnforced: false },
  startup: { accessControl: 'enforced', ssoEnforced: false },
  team: { accessControl: 'enforced', ssoEnforced: false },
  enterprise: { accessControl: 'enforced', ssoEnforced: true },
};

export function resolveProfileDefaults(profile: Profile): ProfileDefaults {
  return DEFAULTS[profile];
}

export function isProfile(value: unknown): value is Profile {
  return typeof value === 'string' && (PROFILES as readonly string[]).includes(value);
}
