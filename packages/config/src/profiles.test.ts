import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';
import { PROFILES, isProfile, resolveProfileDefaults } from './profiles.js';

describe('deployment profiles', () => {
  it('names exactly four profiles, smallest first', () => {
    expect(PROFILES).toEqual(['solo', 'startup', 'team', 'enterprise']);
  });

  it('keeps solo open and every larger profile enforced', () => {
    expect(resolveProfileDefaults('solo').accessControl).toBe('open');
    for (const profile of ['startup', 'team', 'enterprise'] as const) {
      expect(resolveProfileDefaults(profile).accessControl, profile).toBe('enforced');
    }
  });

  it('enforces single sign-on for enterprise only', () => {
    expect(PROFILES.filter((profile) => resolveProfileDefaults(profile).ssoEnforced)).toEqual([
      'enterprise',
    ]);
  });

  it('recognises a profile and nothing else', () => {
    for (const profile of PROFILES) expect(isProfile(profile)).toBe(true);
    for (const value of ['', 'Solo', 'business', 'free', undefined]) {
      expect(isProfile(value), String(value)).toBe(false);
    }
  });
});

describe('the profile in the parsed configuration', () => {
  it('is solo by default, and solo behaves as an install did before profiles', () => {
    const config = parseConfig({});
    expect(config.profile).toBe('solo');
    expect(config.accessControl).toBe('open');
    expect(config.lanMode).toBe(false);
  });

  it('is startup for an install that already turned LAN mode or access control on', () => {
    // An install from before profiles that serves its network must not read as solo: solo
    // refuses to leave this machine, and that install already has.
    expect(parseConfig({ AUTOMATE_LAN_MODE: '1' }).profile).toBe('startup');
    expect(parseConfig({ ACCESS_CONTROL: 'enforced' }).profile).toBe('startup');
  });

  it('turns access control on for every profile above solo', () => {
    for (const profile of ['startup', 'team', 'enterprise']) {
      expect(parseConfig({ AUTOMATE_PROFILE: profile }).accessControl, profile).toBe('enforced');
    }
  });

  it('keeps an explicit ACCESS_CONTROL beneath a profile, so the policy can refuse the conflict', () => {
    expect(parseConfig({ AUTOMATE_PROFILE: 'team', ACCESS_CONTROL: 'open' }).accessControl).toBe(
      'open',
    );
    expect(
      parseConfig({ AUTOMATE_PROFILE: 'solo', ACCESS_CONTROL: 'enforced' }).accessControl,
    ).toBe('enforced');
  });

  it('keeps an explicit profile over the one LAN mode would derive', () => {
    expect(parseConfig({ AUTOMATE_PROFILE: 'solo', AUTOMATE_LAN_MODE: '1' }).profile).toBe('solo');
    expect(parseConfig({ AUTOMATE_PROFILE: 'team', AUTOMATE_LAN_MODE: '1' }).profile).toBe('team');
  });

  it('refuses a profile it does not know, naming the variable', () => {
    expect(() => parseConfig({ AUTOMATE_PROFILE: 'business' })).toThrow('AUTOMATE_PROFILE');
  });

  it('reads an empty AUTOMATE_PROFILE as unset, which is how compose passes an unset value', () => {
    expect(parseConfig({ AUTOMATE_PROFILE: '' }).profile).toBe('solo');
  });

  it('enforces single sign-on on enterprise unless told otherwise, and break-glass is off', () => {
    expect(parseConfig({ AUTOMATE_PROFILE: 'enterprise' }).ssoEnforced).toBe(true);
    expect(
      parseConfig({ AUTOMATE_PROFILE: 'enterprise', AUTH_SSO_ENFORCED: '0' }).ssoEnforced,
    ).toBe(false);
    expect(parseConfig({ AUTOMATE_PROFILE: 'team', AUTH_SSO_ENFORCED: '1' }).ssoEnforced).toBe(
      true,
    );
    expect(parseConfig({}).ssoEnforced).toBe(false);
    expect(parseConfig({}).breakGlass).toBe(false);
    expect(parseConfig({ AUTOMATE_BREAK_GLASS: '1' }).breakGlass).toBe(true);
  });
});
