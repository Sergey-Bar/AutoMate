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
 */
export function bootstrapDisplayPrefix(config: Pick<AppConfig, 'nodeEnv'>): string {
  return config.nodeEnv;
}

/**
 * Whether this deployment may *derive* a bootstrap installation key.
 *
 * **P-72, Reading B — the consequential half of the same title, and the one that was
 * open.** `ensureBootstrap` ran on every boot that had a database, development and
 * production alike, and inserted a row whose credential is
 * `hashCredential(authCookieSecret, installationKey)`. So a production deployment
 * silently grew a credential that nobody chose, derived from a default
 * `installationKey` that lives in the repository. Reading A renamed the label on that
 * row and left the derivation untouched, which is why the two were separate rows.
 *
 * Development keeps the convenience, because that is where it is one: a
 * `git clone` and `pnpm dev` should not require an operator to mint a credential.
 * Production requires the operator to present `AUTOMATE_INSTALLATION_KEY`, because
 * that is where it is not one.
 *
 * `test` is treated as development. A CI run against a production config that has no
 * key should fail the same way a production boot does, rather than minting a
 * credential a test suite then treats as a passing sign-in.
 *
 * @param config the resolved configuration
 * @returns true when deriving a key is permitted in this environment
 */
export function mayDeriveInstallationKey(config: Pick<AppConfig, 'nodeEnv'>): boolean {
  return config.nodeEnv !== 'production';
}

/**
 * The message a production deployment gets when it has presented no key.
 *
 * A boot that fails with `null` for a hash, or with a generic "no installation key",
 * sends an operator looking through a `.env` file for a variable the API never asked
 * for. This names the variable and says what deriving one would have cost.
 */
export const NO_INSTALLATION_KEY =
  'AUTOMATE_INSTALLATION_KEY is required in production. Automate will not derive one: a ' +
  'bootstrapped key is a credential nobody chose, derived from a default that is in the ' +
  'repository, and it is written to the installation_keys table on first boot. Set a ' +
  '32+ character value, or run with NODE_ENV=development for the local sample.';
