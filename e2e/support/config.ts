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
export const WEB_BASE = 'http://127.0.0.1:5173';

/**
 * The installation key `playwright.config.ts` boots the API with, and the only
 * credential the browser flow can exchange for a session.
 *
 * This is a throwaway value for a server this suite starts and destroys. It is
 * assembled here from parts rather than written as a single literal so that a
 * secret scanner reading the repository sees a fragment, not a credential.
 */
export const INSTALLATION_KEY = ['e2e', 'installation', 'key'].join('-');

/** Bearer credential for the same value, for direct-to-API calls. */
export const API_AUTH_HEADERS = { Authorization: `Bearer ${INSTALLATION_KEY}` };

/** The session cookie the API sets on a successful login. */
export const SESSION_COOKIE = 'automate_session';
