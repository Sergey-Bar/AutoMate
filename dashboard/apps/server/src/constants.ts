/**
 * Centralized application constants.
 *
 * Keep this file free of runtime dependencies so it can be imported anywhere
 * without pulling in side-effects.
 */

/** SQLite busy_timeout pragma value (ms). Prevents SQLITE_BUSY under contention. */
export const SQLITE_BUSY_TIMEOUT_MS = 5000;

/** Maximum rows returned by the CSV export endpoint. */
export const CSV_EXPORT_LIMIT = 1000;

/** Timeout (ms) for shelling out to `git` commands. */
export const GIT_COMMAND_TIMEOUT_MS = 5000;

/** Default page-size for list endpoints when the caller omits a limit. */
export const DEFAULT_QUERY_LIMIT = 50;

/** Session / cookie lifetime — 7 days expressed in seconds. */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Session / cookie lifetime — 7 days expressed in milliseconds. */
export const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;
