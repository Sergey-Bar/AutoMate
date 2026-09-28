import type { AppConfig } from './config.js';

/**
 * The `displayPrefix` the bootstrap installation key is recorded under.
 *
 * **P-72, Reading A: a mislabel.** The call site passed the literal `'dev'`
 * unconditionally, so a production deployment recorded a credential row labelled as a
 * development key. The label is **write-only** — `findUsable` selects `keyHash,
 * revokedAt, expiresAt`, and no route, no `apps/web` code, no audit row and no UI reads
 * `display_prefix` — so this is a cosmetic label on a database row and renaming it is
 * behaviourally free. The credential's real identity is
 * `hashCredential(authCookieSecret, installationKey)`, which this does not touch.
 *
 * **Reading B was not taken and is recorded as its own row.** B is the stronger reading
 * of the same title: that `ensureBootstrap` is called in production *at all*, deriving a
 * bootstrap credential on every boot. That changes what production does on first boot
 * and does not belong in the same change as a cosmetic label.
 */
export function bootstrapDisplayPrefix(config: Pick<AppConfig, 'nodeEnv'>): string {
  return config.nodeEnv;
}
