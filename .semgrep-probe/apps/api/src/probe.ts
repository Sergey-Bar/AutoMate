import { exec, execSync, spawn, spawnSync } from 'node:child_process';
import { and, eq, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { runs } from '@automate/db';

/**
 * A semgrep probe fixture. Not application code, never imported, never executed.
 *
 * Its only job is to make the rules in `.semgrep.yml` fire, so that a rewrite
 * which silences a rule fails `scripts/lib/semgrep-rules.test.mjs`. Three rules in
 * that file have already been rewritten into silence by a change that looked
 * correct, and each time the suite stayed green.
 *
 * It sits outside the workspace on purpose: a hazard here would make
 * `security:static` fail on every ordinary run. It is scanned as
 * `apps/api/src/probe.ts` relative to this directory, which is what makes the
 * `paths:` filters in the real configuration apply to it.
 */

/** HAZARD: a caller-controlled list becomes the statement. */
export function hazardIdentifierList(ids: string[]): SQL {
  return inArray(runs.id, ids);
}

/** HAZARD: a spread of a request body is the same hazard. */
export function hazardSpreadList(ids: string[]): SQL {
  return inArray(runs.id, [...ids]);
}

/** SAFE: three fixed strings cannot grow with a request. */
export function safeLiteralList(): SQL {
  return inArray(runs.id, ['a', 'b', 'c']);
}

// A **member access** is the exact shape the rule's `pattern-not` names, and a
// method call is not one — `db.select()` binds no `$FIELD` — so this twin has to
// be the property form or it asserts a behaviour the rule does not claim.
/** SAFE: a subquery the planner sizes from the table, not from the request. */
export function safeSubquery(db_: { scoped: SQL }): SQL {
  return inArray(runs.id, db_.scoped);
}

interface Presented {
  /**
   * An exact name from the rule's list, deliberately. The list is anchored, so
   * `apiToken` and `sessionSecret` are *not* matched — the rule claims a name
   * list, not a shape, and a compound name is a different claim. `token` is on
   * the list, so this is the hazard.
   */
  token: string;
  userId: string;
  key: string;
}

/** HAZARD: a secret compared with `===` leaks its prefix length by timing. */
export function hazardSecretComparison(presented: Presented, expected: string): boolean {
  return presented.token === expected;
}

/** SAFE: an identifier comparison carries no secret. */
export function safeIdentifierComparison(a: Presented, b: Presented): boolean {
  return a.userId === b.userId;
}

/** SAFE: a bare `key` is a keyboard or route key, not a credential. */
export function safeKeyComparison(a: Presented): boolean {
  return a.key === 'ArrowUp';
}

/** SAFE: a constant on the right is not an oracle — there is nothing to measure. */
export function safeLiteralComparison(presented: Presented): boolean {
  return presented.token === 'literal-value';
}

/** HAZARD: a command *line* is interpreted by a shell. */
export function hazardCommandLine(): unknown {
  return spawn('git rev-parse HEAD', { shell: false });
}

/** HAZARD: `shell: true` with any command. */
export function hazardShellOption(): unknown {
  return exec('ls -la', { shell: true });
}

/** HAZARD: a template command line, which carries an interpolation. */
export function hazardInterpolatedCommand(branch: string): unknown {
  return execSync(`git checkout ${branch}`);
}

/** SAFE: the argument-array form. Nothing is interpreted. */
export function safeArgumentArray(): unknown {
  return spawnSync('git', ['rev-parse', 'HEAD']);
}

/** HAZARD: a literal credential assigned to a secret-shaped name. */
export function hazardHardcodedSecret(): string {
  const apiKey = 'aB3xQ9mZ7pL2vN8kR4wY6tU1';
  return apiKey;
}

/** HAZARD: the same, on an object property. */
export function hazardHardcodedSecretProperty(config: { sessionSecret: string }): string {
  config.sessionSecret = 'kQ2wErTyUiOpAsDfGhJkLzXc';
  return config.sessionSecret;
}

/** SAFE: an error code, which a client branches on. */
export function safeErrorCode(): string {
  const code = 'REPORTER_SECRET_NOT_CONFIGURED';
  return code;
}

/** SAFE: a published cookie *name*. */
export function safeCookieName(): string {
  const SESSION_COOKIE = 'automate_session';
  return SESSION_COOKIE;
}

/** SAFE: the setting is supposed to come from the environment. */
export function safeEnvSecret(): string | undefined {
  return process.env['SESSION_SECRET'];
}

/** SAFE: `secret = readSecret()` is correct code, and reporting it teaches a
 *  reader to ignore the rule — which is how a gate ends up switched off. */
export function safeComputedSecret(readSecret: () => string): string {
  const password = readSecret();
  return password;
}

/** SAFE: Drizzle's own composition, which is how every real query is written. */
export function safeDrizzleComposition(ids: string[]): SQL {
  return and(eq(runs.id, ids[0] ?? ''), inArray(runs.status, ['queued', 'running']));
}
