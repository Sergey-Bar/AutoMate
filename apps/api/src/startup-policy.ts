import {
  SECRET_MIN_LENGTH,
  isLoopbackBind,
  isSecretPlaceholder,
  type SecretVariable,
} from '@automate/config';
import type { AppConfig } from './config.js';

/**
 * The cookie secret used when `AUTOMATE_ALLOW_DEV_SECRETS=1` is set outside a
 * test environment.
 *
 * This literal is in git history and in every clone, so it is a *publicly known
 * signing key* for any install that uses it. That is acceptable only for a
 * developer's own machine, and only when the operator asked for it by name.
 * It is never used in a test (tests may pass an explicit secret) and never in
 * production.
 */
export const DEVELOPMENT_COOKIE_SECRET = 'development-only-cookie-secret-32-chars';
export const DEVELOPMENT_INSTALLATION_KEY = 'development-installation-key';

/**
 * One secret policy, and the numbers live in `@automate/config`.
 *
 * This file used to write `32` and `16` itself, in its own messages, while
 * `packages/config` wrote the same thresholds in a Zod schema. Two copies of one
 * number is a number that will drift, and the floor drifted: the schema held four
 * secrets to 16 while this policy held them to 16 and the cookie to 32, so the
 * weakest credential set the standard. `SECRET_MIN_LENGTH` and
 * `isSecretPlaceholder` are imported rather than restated, which is the only thing
 * that makes the second authority stop being one.
 *
 * The placeholder test is deliberately first for every secret. A 9-character
 * `change-me` is also too short, and reporting "too short" to an operator who
 * copied the example is a worse answer than the one they need — so the check that
 * names the mistake is the one that runs, at any floor.
 */
function refuseIfUnusable(variable: SecretVariable, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error(`${variable} is required in production`);
  }
  if (isSecretPlaceholder(variable, value)) {
    throw new Error(`${variable} must not be a placeholder`);
  }
  if (value.length < SECRET_MIN_LENGTH) {
    throw new Error(`${variable} must be at least ${String(SECRET_MIN_LENGTH)} characters`);
  }
  return value;
}

/**
 * The environment variable an operator must set to accept the committed
 * development secrets outside a test run. Grep for it to find every place the
 * development path is reachable.
 */
export const ALLOW_DEV_SECRETS_ENV = 'AUTOMATE_ALLOW_DEV_SECRETS';

export function devSecretsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[ALLOW_DEV_SECRETS_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

export function isProduction(config: AppConfig): boolean {
  return config.nodeEnv === 'production';
}

/**
 * Process-local (in-memory) stand-ins are an explicit development/test
 * convenience, never a production composition. Production callers must fail
 * closed instead of silently degrading to process-local state.
 *
 * **And when it is permitted, it is announced.** This was the one half that was
 * missing, and it is the half that costs something. Refusing in production is the
 * important guarantee, but a developer whose database is unreachable gets a working
 * API that is not durable, with nothing in the output to say so — and every
 * behaviour that depends on persistence is then answered from process-local state. That
 * is not hypothetical in this repository: `AGENTS.md` records that a missing
 * `DATABASE_URL` makes the end-to-end suite "fall back to the in-memory store and the
 * suite reports success without PostgreSQL ever being involved".
 *
 * So the fallback is logged, by name, at every site — which is why this is the single
 * choke point rather than something each caller does for itself. Eight call sites all
 * funnel through here; eight separate warnings are eight chances to forget one.
 *
 * @param config the parsed configuration, read for the environment
 * @param component what is falling back, named so the log says which one
 * @param log where to announce it; injected so a test can assert the announcement
 *   happened rather than reading stdout
 */
export function assertInMemoryAllowed(
  config: AppConfig,
  component: string,
  log: (message: string) => void = (message) => console.warn(message),
): void {
  if (isProduction(config)) {
    throw new Error(
      `Refusing in-memory ${component} in production; configure the durable backend instead`,
    );
  }
  log(
    `In-memory fallback: ${component} is process-local and NOT durable. Everything it holds ` +
      'is lost when this process exits, and nothing here reaches a database. Set ' +
      'DATABASE_URL to run against PostgreSQL — a suite that runs this way can report ' +
      'success without a database ever being involved.',
  );
}

export function checkProductionPolicy(config: AppConfig): void {
  if (isProduction(config)) {
    refuseIfUnusable('COOKIE_SECRET', config.cookieSecret);
    refuseIfUnusable('REPORTER_SECRET', config.reporterSecret);
    refuseIfUnusable('AUTOMATE_API_KEY', config.apiKey);
    refuseIfUnusable('VAULT_SECRET', config.vaultSecret);
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is required in production');
    }
    if (!config.objectStore) {
      // Artifact bytes are evidence. Without a durable object store they would
      // live on one process's filesystem and disappear with it, so production
      // fails closed instead of composing the local store.
      throw new Error(
        'OBJECT_STORE_ENDPOINT, OBJECT_STORE_BUCKET, OBJECT_STORE_REGION, OBJECT_STORE_ACCESS_KEY_ID, and OBJECT_STORE_SECRET_ACCESS_KEY are required in production; artifact bytes must be stored in a durable object store',
      );
    }
    if (config.objectStore.endpoint.startsWith('http:') && !config.objectStore.allowInsecureHttp) {
      throw new Error(
        'OBJECT_STORE_ENDPOINT must use https in production unless OBJECT_STORE_ALLOW_INSECURE is enabled',
      );
    }
    refuseIfUnusable('RUNNER_REGISTRATION_SECRET', config.runnerRegistrationSecret);
  }
}

/**
 * Who may reach this install, against who it lets in.
 *
 * The API had no login in front of it by design (ADR-006), and the only thing between that
 * and the network was a warning the start scripts printed when `AUTOMATE_BIND` was not
 * loopback. A warning is advice; a reachable install with no login is a decision someone
 * should have to make on purpose. So it is refused, in every environment — the network does
 * not care about `NODE_ENV` — and the refusal names the switch that makes it safe.
 *
 * This is the one place the rule lives. The start scripts refuse the same bind before they
 * start anything, so an operator sees the message at the prompt rather than in a container
 * log; they repeat it early, they do not decide it.
 */
export function checkExposurePolicy(config: AppConfig): void {
  if (config.lanMode === true && config.accessControl === 'open') {
    throw new Error(
      'AUTOMATE_LAN_MODE is on and ACCESS_CONTROL=open is set. LAN mode serves other machines ' +
        'and needs a login: remove ACCESS_CONTROL (LAN mode turns it on) or set it to enforced.',
    );
  }
  const bind = config.exposedBind ?? config.host ?? '127.0.0.1';
  if (!isLoopbackBind(bind) && (config.accessControl ?? 'open') === 'open') {
    throw new Error(
      `Automate would be reachable from other machines (${bind}) with no login in front of it. ` +
        'Set AUTOMATE_LAN_MODE=1 to serve your local network with sign-in, device pairing and ' +
        'a client allowlist, or bind to 127.0.0.1 to keep it on this machine.',
    );
  }
}

/**
 * What to tell the operator when the install cannot know whether it is reachable.
 *
 * The 3.0.0 compose file sets `HOST=0.0.0.0` (every interface of the container, which every
 * container needs) and does not pass `AUTOMATE_BIND`, and `start update` keeps that file. So
 * an upgraded install has a wildcard listen address and no declared bind, and refusing it
 * left every upgraded install down (v3.1.0). It is allowed, with this warning, because the
 * start scripts still refuse an exposed bind before anything starts, and the 3.1 compose
 * file always passes the real one. What is given up is the refusal for an API image run on
 * its own with `HOST=0.0.0.0` and nothing else, which is how 3.0.0 behaved.
 *
 * @returns the warning, or `undefined` when the bind is declared or the host is concrete
 */
export function exposureWarning(config: AppConfig): string | undefined {
  if (config.bindUndeclared !== true) return undefined;
  return (
    'AUTOMATE_BIND is not set and HOST is a wildcard, so this install cannot tell whether ' +
    'other machines can reach it. Set AUTOMATE_BIND to the address it is published on ' +
    '(127.0.0.1 keeps it on this machine, and AUTOMATE_LAN_MODE=1 serves your network with ' +
    'sign-in). Without a login, anything that can reach the port can use the install.'
  );
}

export interface AuthSecrets {
  cookieSecret: string;
  installationKey: string;
}

/**
 * Resolves the secrets that sign cookies and installation credentials.
 *
 * Previously this returned the committed development literal whenever
 * `nodeEnv` was anything other than the exact string `production`, and
 * `getConfig` passed `requireProductionSecrets: false` unconditionally. The
 * result was that a deployment started without `NODE_ENV=production` signed
 * its sessions with a key published in this repository — and the login page
 * was still reachable.
 *
 * Now the literal is reachable only where it is harmless: a test run, or a
 * developer's own machine with `AUTOMATE_ALLOW_DEV_SECRETS=1`. Everywhere else
 * a missing secret is a startup failure, not a silent fallback.
 *
 * **`AUTOMATE_API_KEY` is still required in production** by `checkProductionPolicy`.
 * The install has no login in front of it (open since 2026-09-30), but sessions are
 * still minted, and the credential they are minted against must not be a published
 * literal. This comment once said the opposite while the policy beside it refused a
 * missing key, so an operator reading one was misled by the other.
 *
 * **The credential is `AUTOMATE_INSTALLATION_KEY` when it is set (ledger MNT-20).** A
 * production boot with a database refuses to start without that variable
 * (`NO_INSTALLATION_KEY`), and until this was fixed nothing then *read* it: the
 * credential was derived from `AUTOMATE_API_KEY`, so the key the boot error told an
 * operator to set was not the key that signed them in. `AUTOMATE_API_KEY` remains the
 * fallback for a development or test run that sets only that.
 */
export function resolveAuthSecrets(
  config: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
): AuthSecrets {
  if (isProduction(config) && !config.cookieSecret) {
    throw new Error('COOKIE_SECRET is required in production');
  }
  const allowLiterals = config.nodeEnv === 'test' || devSecretsAllowed(env);
  if (!config.cookieSecret && !allowLiterals) {
    throw new Error(
      'COOKIE_SECRET is required. There is no fallback: the development ' +
        `literal is a publicly known signing key. Set COOKIE_SECRET (at least ` +
        `32 characters), or set ${ALLOW_DEV_SECRETS_ENV}=1 on a development ` +
        'machine to accept it deliberately.',
    );
  }
  if (!config.apiKey && !allowLiterals) {
    throw new Error(
      `AUTOMATE_API_KEY is required. Set it, or set ${ALLOW_DEV_SECRETS_ENV}=1 ` +
        'on a development machine to accept the development installation key.',
    );
  }
  const presented = env['AUTOMATE_INSTALLATION_KEY']?.trim();
  return {
    cookieSecret: config.cookieSecret ?? DEVELOPMENT_COOKIE_SECRET,
    installationKey:
      presented !== undefined && presented !== ''
        ? presented
        : (config.apiKey ?? DEVELOPMENT_INSTALLATION_KEY),
  };
}
