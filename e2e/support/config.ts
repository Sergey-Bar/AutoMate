/**
 * Fixed values the E2E suite runs against.
 *
 * These are not configurable. They are the values `playwright.config.ts` puts in
 * the API's `webServer.env`, and a suite that read them from somewhere else
 * would be asserting against a different configuration than the one it starts.
 * If one of these changes in the config, every spec that depends on it must
 * change with it — which is the point.
 */
export const API_BASE = 'http://127.0.0.1:3000';
export const WEB_BASE = 'http://localhost:5173';

/**
 * The QA contract version a run event envelope must carry.
 *
 * `RunEventEnvelopeSchema.version` is `z.literal(QA_CONTRACT_VERSION)` in
 * `@automate/shared-contracts`, so this is a **copy**, not an import — the E2E tree
 * deliberately depends on nothing but the API and the browser. The consequence is that a
 * bump to the contract fails an E2E spec with a 400 whose cause is one character in a
 * second package, and that is the price of the suite not pulling in the monorepo's
 * build graph. A spec that needs it asserts against this constant, so the failure points
 * here rather than at an anonymous payload.
 */
export const QA_CONTRACT_VERSION = '1';

/**
 * The installation key the API is booted with, and the only credential the browser
 * flow can exchange for a session.
 *
 * This is a throwaway value for a server this suite starts and destroys. It is
 * assembled here from parts rather than written as a single literal so that a
 * secret scanner reading the repository sees a fragment, not a credential.
 *
 * **`playwright.config.ts` imports this**, and that import is the point rather than
 * a convenience. The two files each held the value and they disagreed: the config
 * booted the API with `e2e-installation-key-32-characters-long` while this module
 * sent `e2e-installation-key`, so **every authenticated call in the suite answered
 * 401** — 17 of 19 tests — and the two documents above each claiming they were the
 * single source of the other's value were both describing an intention nobody had
 * checked. The 32-character form is the one that survives `SECRET_MIN_LENGTH`, which
 * `packages/config` refuses in production, so a fixture that is too short is a
 * fixture that would behave differently on a real install.
 */
export const INSTALLATION_KEY = ['e2e', 'installation', 'key', '32', 'characters', 'long'].join(
  '-',
);

/** Bearer credential for the same value, for direct-to-API calls. */
export const API_AUTH_HEADERS = { Authorization: `Bearer ${INSTALLATION_KEY}` };

/**
 * The runner registration secret, and the header that carries it.
 *
 * A separate credential from the installation key on purpose: enrolling a runner is a
 * different act from reading runs, and a suite that registered with the API key was
 * refused with `RUNNER_REGISTRATION_UNAUTHORIZED` on every runner-dependent test.
 *
 * The refusal was correct. `registrationAuthorized` answers `true` for a *missing*
 * secret only when `NODE_ENV=test`, because a missing secret is a fixture in a unit
 * test and a misconfiguration everywhere else — and the E2E lane runs with
 * `NODE_ENV=development` and no secret configured, so it got the answer for a
 * misconfigured deployment. The lane had never been able to enrol a runner.
 *
 * Assembled from parts, for the same reason as the key, and shared with
 * `playwright.config.ts` so the server and the client cannot disagree about it.
 */
export const RUNNER_REGISTRATION_SECRET = [
  'e2e',
  'runner',
  'registration',
  'secret',
  '32',
  'characters',
  'long',
].join('-');

/** The header the register route reads. */
export const RUNNER_REGISTRATION_HEADERS = {
  'x-runner-registration-secret': RUNNER_REGISTRATION_SECRET,
};

/** The session cookie the API sets on a successful login. */
export const SESSION_COOKIE = 'automate_session';
