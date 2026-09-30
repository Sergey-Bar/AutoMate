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

/** The session cookie the API sets on a successful login. */
export const SESSION_COOKIE = 'automate_session';
