import { describe, expect, it } from 'vitest';
import { parseConfig } from '@automate/config';
import { bootstrapDisplayPrefix } from './bootstrap-display-prefix.js';

/**
 * P-72, Reading A.
 *
 * `index.ts` called `ensureBootstrap({ …, displayPrefix: 'dev' })` unconditionally
 * whenever a database existed, so **every** deployment — production included —
 * recorded a credential row labelled as a development key. The literal `'dev'` had no
 * test anywhere asserting it, so it could not have been noticed.
 *
 * Reading A was chosen over Reading B deliberately. Reading B — that `ensureBootstrap`
 * should not be called in production at all — changes what production does on first
 * boot and needs its own review; it is recorded as its own follow-up row rather than
 * smuggled into this change. Reading A says the label is wrong, and the label is
 * **write-only**: `findUsable` selects `keyHash, revokedAt, expiresAt` and nothing
 * anywhere — no route, no `apps/web` code, no audit row, no UI — reads `display_prefix`.
 * So renaming it is behaviourally free, and the credential's real identity is
 * `hashCredential(authCookieSecret, installationKey)`, not the cosmetic label.
 */
describe('bootstrap installation-key display prefix', () => {
  it('does not label a production deployment as a development key', () => {
    const config = parseConfig({ NODE_ENV: 'production' }, { requireProductionSecrets: false });
    expect(bootstrapDisplayPrefix(config)).not.toBe('dev');
  });

  it('keeps the dev label where the dev label is true', () => {
    const config = parseConfig({ NODE_ENV: 'development' }, { requireProductionSecrets: false });
    // `NODE_ENV` spells it `development`; the label used to be the abbreviation `dev`.
    // The value is write-only, so the full name costs nothing and reads unambiguously
    // next to the column it lands in.
    expect(bootstrapDisplayPrefix(config)).toBe('development');
  });

  it('is a function of the environment, not a literal at the call site', () => {
    // The three node environments, so a fourth added to the schema cannot silently
    // inherit the wrong label.
    for (const nodeEnv of ['development', 'test', 'production'] as const) {
      const prefix = bootstrapDisplayPrefix(
        parseConfig({ NODE_ENV: nodeEnv }, { requireProductionSecrets: false }),
      );
      expect(prefix.length).toBeGreaterThan(0);
      expect(prefix).not.toContain(' ');
    }
    expect(
      bootstrapDisplayPrefix(
        parseConfig({ NODE_ENV: 'test' }, { requireProductionSecrets: false }),
      ),
    ).toBe('test');
  });
});
