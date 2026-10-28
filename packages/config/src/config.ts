import { z } from 'zod/v4';
import { DEFAULT_CLIENT_CIDRS, isLoopbackBind, isWildcardBind, parseCidr } from './network.js';
import { PROFILES, resolveProfileDefaults, type Profile } from './profiles.js';
import {
  ACCESS_ROLES,
  REMOTE_MODES,
  normalizeCloudflareTeamDomain,
  parseCloudflareRoleMap,
  parseRoleMap,
  type AccessRole,
  type CloudflareAccessConfig,
  type RemoteMode,
  type RoleRule,
} from './remote.js';

/** A comma-separated environment value as its trimmed, non-empty entries. */
function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * The one secret floor in this repository.
 *
 * It used to be two: 32 for the cookie, session and vault secrets, and 16 for the
 * other four. The result was that the weakest credential in the system set the bar
 * for the rest — a reporter secret and a vault key were held to the same standard,
 * and the API's own startup policy restated the thresholds independently, so the two
 * could drift and did. `apps/api/src/startup-policy.ts` imports this value rather
 * than writing a number, which is the only thing that makes the drift impossible.
 *
 * 32 is not a magic number: it is the width at which PBKDF2 and HMAC-SHA256 stop
 * being the thing to worry about, and the shortest of the committed development
 * literal, so the literal passes the floor it is documented as passing.
 */
export const SECRET_MIN_LENGTH = 32;

export type SecretVariable =
  | 'COOKIE_SECRET'
  | 'SESSION_SECRET'
  | 'VAULT_SECRET'
  | 'AUTOMATE_API_KEY'
  | 'REPORTER_SECRET'
  | 'RUNNER_REGISTRATION_SECRET'
  | 'KILO_API_KEY'
  | 'GITHUB_WEBHOOK_SECRET';

/**
 * Placeholders matched by equality, per variable.
 *
 * Equality rather than substring, and that is a deliberate decision rather than a
 * lazy one. The documented quickstart values in `README.md` are real secrets with a
 * memorable prefix — `local-reporter-secret-change-me` is 30 characters and works —
 * so a check that refused any value *containing* `change-me` would refuse a working
 * configuration in order to catch a broken one, and the fix would be to weaken the
 * check.
 */
const EXACT_PLACEHOLDERS: Record<SecretVariable, readonly string[]> = {
  COOKIE_SECRET: ['automate'],
  SESSION_SECRET: ['automate'],
  VAULT_SECRET: ['change-me'],
  AUTOMATE_API_KEY: ['change-me', 'automate'],
  REPORTER_SECRET: ['change-me', 'reporter-secret'],
  RUNNER_REGISTRATION_SECRET: ['change-me', 'runner-registration-secret'],
  KILO_API_KEY: ['change-me', 'automate'],
  GITHUB_WEBHOOK_SECRET: ['change-me', 'github-webhook-secret'],
};

/**
 * The two cookie-secret placeholders that are only recognisable as fragments.
 *
 * The committed development literal is 38 characters of `development-only-…`, and the
 * string every quickstart on earth writes is `change-me-…`; neither can be matched by
 * equality without matching the healthy values too. The cookie secret is the one
 * credential whose *value* is a signing key, so it is the one where "this looks like
 * something you copied" is worth a false positive.
 */
const COOKIE_PLACEHOLDER_FRAGMENTS = ['change-me', 'development-only'] as const;

/** Whether a configured value is documentation rather than a secret. */
export function isSecretPlaceholder(variable: SecretVariable, value: string): boolean {
  if (EXACT_PLACEHOLDERS[variable].includes(value)) return true;
  return (
    variable === 'COOKIE_SECRET' && COOKIE_PLACEHOLDER_FRAGMENTS.some((f) => value.includes(f))
  );
}

/**
 * One secret schema, used by all seven variables.
 *
 * The placeholder check is written first and as a separate refinement on purpose. At a
 * 32-character floor a 9-character `change-me` fails the length check, and an operator
 * told only "too small" is not told to stop copying the example — so every assertion
 * that a placeholder is refused used to be unreachable in the real startup path, where
 * the schema parses before the API's policy ever runs. Zod collects both issues, so
 * `COOKIE_SECRET=change-me` now reports that it is a placeholder *and* that it is too
 * short, and the first thing an operator reads is the one that fixes it.
 */
function secretSchema(variable: SecretVariable) {
  return z
    .string()
    .refine((value) => !isSecretPlaceholder(variable, value), {
      message: `${variable} must not be a placeholder`,
    })
    .min(SECRET_MIN_LENGTH);
}

/**
 * Where the web dev server should proxy `/api` to.
 *
 * Exists because the quick start was broken in the way a document can be broken
 * most expensively: it looked right. `README.md` said to run the API on
 * `PORT=3456`, while `apps/web/vite.config.ts` hardcoded `http://127.0.0.1:3000`
 * and `.env.example` and `AGENTS.md` both said `3000`. A reader who followed the
 * README exactly got a dashboard whose every `/api` call went to a port nothing
 * was listening on — silently, because a failed fetch and a failed login render
 * the same thing on screen.
 *
 * So the proxy target reads the same `PORT` the API reads, through the *same*
 * `PORT_SCHEMA` below rather than a second copy of its rules — coercion,
 * integer, and the 1–65535 range are stated once. When `PORT` is absent or
 * unusable it falls back to the same default the API uses, so there is one
 * number in this repository rather than three that have to agree.
 *
 * `HOST` is validated rather than interpolated, because it lands in a URL
 * authority. Unvalidated, `HOST=127.0.0.1:3000@evil.example.com` produces a
 * target that reads as loopback in a log and whose real host is
 * `evil.example.com` — so every `/api` request, including the login body
 * carrying `AUTOMATE_API_KEY`, is proxied off-box. `EnvironmentSchema` accepts any
 * non-empty string for `HOST`, so nothing upstream catches it either.
 *
 * Not `parseConfig`: this is called from `vite.config.ts`, which runs before the
 * API's production startup policy and must not fail on a missing `DATABASE_URL`
 * or a placeholder secret just to work out a dev proxy target.
 *
 * @param env the process environment, or anything with the same shape
 * @returns an `http://host:port` origin
 */
export function apiProxyTarget(env: Record<string, string | undefined> = {}): string {
  /*
   * `E2E_API_PORT` is read **first**, and this is the third place that has learned it.
   *
   * The proxy derives its target from `PORT`, which is right: the target follows the API
   * rather than restating where the API is. But the E2E suite passes `PORT` only to the
   * API's own `webServer` entry — Vite inherits the Playwright process environment, where
   * `PORT` is unset and `E2E_API_PORT` is set. The proxy therefore fell back to
   * `DEFAULT_PORT` and every browser request in the lane went to whatever was listening
   * there.
   *
   * **The symptom was a lie that pointed at the product.** The cockpit reported "The project
   * registry is unavailable — HTTP 500" while `GET /api/v1/projects` returned 200 by hand
   * with the same key and the same database, and the API logged nothing — because
   * `apps/api/src/errors/boundary.ts` logs every unhandled error, so a 500 it produced
   * would carry a `requestId`. Nothing was logged because nothing reached it.
   *
   * So the ordering is: an explicit E2E override, then `PORT`, then the default. `PORT`
   * wins over the default because it is the API's own variable, and `E2E_API_PORT` wins
   * over `PORT` because it names this lane specifically.
   */
  const override = PORT_SCHEMA.safeParse(env['E2E_API_PORT']);
  if (override.success) return `http://${proxyHost(env['HOST'])}:${String(override.data)}`;
  const parsed = PORT_SCHEMA.safeParse(env['PORT']);
  const port = parsed.success ? parsed.data : DEFAULT_PORT;
  return `http://${proxyHost(env['HOST'])}:${String(port)}`;
}

/**
 * A hostname, IPv4 literal, or bracketed-or-bare IPv6 literal — and nothing else.
 *
 * Every character excluded here is one that changes *where* the URL points
 * rather than naming a host: `@` introduces userinfo, `/` `?` `#` start a path,
 * query, or fragment, and a second `:` is a port the caller does not own. A bare
 * IPv6 literal is the one shape that legitimately contains colons, so it is
 * matched by its own rule and re-bracketed — `http://::1:3000` is not a URL,
 * because the first colon reads as the port separator.
 *
 * @param value the configured `HOST`, verbatim
 * @returns a host usable in a URL authority, bracketed if it is IPv6
 */
function proxyHost(value: string | undefined): string {
  if (value === undefined || value.trim() === '') return DEFAULT_HOST;
  const host = value.trim();
  // A bracketed literal is already in its URL form; re-bracketing would double it.
  if (/^\[[0-9A-Fa-f:.]+\]$/.test(host)) return host;
  // A bare IPv6 literal is the one shape that legitimately contains colons.
  // `host.includes(':')` is the discriminator rather than a pattern, because a
  // single regex covering both the host and IPv6 shapes is ambiguous about which
  // colon is the separator — and an ambiguous host parser is the bug this
  // function exists to prevent.
  if (host.includes(':')) {
    return /^[0-9A-Fa-f:.]+$/.test(host) ? `[${host}]` : DEFAULT_HOST;
  }
  // A hostname or IPv4 literal: alphanumeric ends, and only `.`, `-`, `_` between.
  // Written as three lookaheads rather than `([A-Za-z0-9._-]*[A-Za-z0-9])?` because
  // that nested quantifier is the shape `security/detect-unsafe-regex` flags, and
  // the rule is right to: it is genuinely ambiguous, and here the ambiguity would
  // decide whether `HOST` names a host.
  if (!/^[A-Za-z0-9._-]+$/.test(host)) return DEFAULT_HOST;
  if (!/^[A-Za-z0-9]/.test(host) || !/[A-Za-z0-9]$/.test(host)) return DEFAULT_HOST;
  return host;
}

/** The bind address the API uses when `HOST` is unset. */
export const DEFAULT_HOST = '127.0.0.1';

/** The port the API uses when `PORT` is unset, and the port the web proxy targets. */
export const DEFAULT_PORT = 3000;

/**
 * The one rule for what counts as a usable `PORT`.
 *
 * Declared before both its users on purpose. `EnvironmentSchema` and
 * `apiProxyTarget` used to restate the same coercion, integer check, and 1–65535
 * range independently — so widening the schema would have left the proxy
 * validating the old rule, and nothing would have said so. `apiProxyTarget` is
 * reached from `vite.config.ts`, which runs in a context that must not fail
 * loudly, so it checks with `safeParse` and falls back rather than throwing.
 */
const PORT_SCHEMA = z.coerce.number().int().min(1).max(65535);

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default(DEFAULT_HOST),
  PORT: PORT_SCHEMA.default(DEFAULT_PORT),
  DATABASE_URL: z.string().url().optional(),
  COOKIE_SECRET: secretSchema('COOKIE_SECRET').optional(),
  SESSION_SECRET: secretSchema('SESSION_SECRET').optional(),
  VAULT_SECRET: secretSchema('VAULT_SECRET').optional(),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
  WORKSPACE_ID: z.string().min(1).default('default-workspace'),
  AUTOMATE_API_KEY: secretSchema('AUTOMATE_API_KEY').optional(),
  REPORTER_SECRET: secretSchema('REPORTER_SECRET').optional(),
  RUNNER_REGISTRATION_SECRET: secretSchema('RUNNER_REGISTRATION_SECRET').optional(),
  ARTIFACT_ROOT: z.string().min(1).default('./var/artifacts'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  // A legacy alias for WORKER_LEASE_DURATION_MS, read only as a fallback by
  // apps/worker/src/config.ts. Never documented in .env.example. Kept so an install that
  // set it keeps its lease length; see the workerLeaseDurationMs field for why.
  WORKER_LEASE_MS: z.coerce.number().int().positive().default(30000),
  WORKER_LEASE_DURATION_MS: z.coerce.number().int().positive().default(30000),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().max(10).default(2),
  KILO_GATEWAY_URL: z.string().url().optional(),
  KILO_API_KEY: secretSchema('KILO_API_KEY').optional(),
  OLLAMA_BASE_URL: z.string().url().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  // Whether a reverse proxy in front of the API sets X-Forwarded-For. Off unless said:
  // without a proxy the header is client-chosen (ledger MNT-7).
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  /**
   * open keeps ADR-006's single-operator posture: every caller is the operator. enforced
   * requires a session or an access token on every `/api/v1` route that is not a probe or a
   * sign-in, with viewer, operator and admin roles.
   *
   * **No default in the schema.** Unset, it is `open` — unless `AUTOMATE_LAN_MODE` is on, in
   * which case it is `enforced`. An explicit `open` beside LAN mode is kept as written so the
   * startup policy can refuse the contradiction by name instead of silently resolving it.
   */
  ACCESS_CONTROL: z.enum(['open', 'enforced']).optional(),
  /**
   * The deployment profile (ADR-014). Unset, it is `solo` — unless LAN mode or an explicit
   * `ACCESS_CONTROL=enforced` says the install already serves other people, which is
   * `startup`. A profile sets defaults only; an explicit variable beside it wins.
   */
  AUTOMATE_PROFILE: z.enum(PROFILES).optional(),
  /**
   * `cloudflare`: the install is reached through Cloudflare Tunnel, and a verified Cloudflare
   * Access identity is a credential (ADR-014). A tunnel is exposure even on a loopback bind,
   * so the startup policy requires enforced access control and both settings below.
   */
  AUTOMATE_REMOTE: z.enum(REMOTE_MODES).optional(),
  /** The Access team: `acme`, `acme.cloudflareaccess.com`, or its URL. */
  CF_ACCESS_TEAM_DOMAIN: z.string().min(1).optional(),
  /** The Access application's audience (AUD) tag. */
  CF_ACCESS_AUD: z.string().min(1).optional(),
  /** `role:who` rules; see `parseCloudflareRoleMap`. */
  CF_ACCESS_ROLE_MAP: z.string().optional(),
  /** The role of an Access identity no rule names. `none` admits only the named. */
  CF_ACCESS_DEFAULT_ROLE: z.enum([...ACCESS_ROLES, 'none']).default('viewer'),
  /** OIDC sign-in for the team profile (ADR-014): the provider's issuer URL. */
  AUTH_SSO_ENFORCED: z
    .enum(['1', 'true', 'yes', '0', 'false', 'no'])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : value === '1' || value === 'true' || value === 'yes',
    ),
  /** Lets the installation key sign a browser in while SSO is enforced. Audited every time. */
  AUTOMATE_BREAK_GLASS: z
    .enum(['1', 'true', 'yes', '0', 'false', 'no'])
    .optional()
    .transform((value) => value === '1' || value === 'true' || value === 'yes'),
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  /** Comma-separated email domains allowed to sign in. Unset: any the provider vouches for. */
  OIDC_ALLOWED_DOMAINS: z.string().optional(),
  /** `role:who` rules, the grammar of `CF_ACCESS_ROLE_MAP`. */
  OIDC_ROLE_MAP: z.string().optional(),
  /** The role of a person no rule names, on their first sign-in. `none` admits only the named. */
  OIDC_DEFAULT_ROLE: z.enum([...ACCESS_ROLES, 'none']).default('viewer'),
  /**
   * The one switch for serving other machines on the local network: access control on, the
   * client allowlist applied, and the start scripts allowed to publish beyond loopback.
   */
  AUTOMATE_LAN_MODE: z
    .enum(['1', 'true', 'yes', '0', 'false', 'no'])
    .optional()
    .transform((value) => value === '1' || value === 'true' || value === 'yes'),
  /**
   * The address the front door is published on. The compose stack passes the edge's own
   * `AUTOMATE_BIND` through, because the API listens on `0.0.0.0` *inside* the compose
   * network and that says nothing about whether another machine can reach it.
   */
  AUTOMATE_BIND: z.string().min(1).optional(),
  /** Comma-separated client ranges admitted. Unset: {@link DEFAULT_CLIENT_CIDRS}. */
  ALLOWED_CLIENT_CIDRS: z
    .string()
    .optional()
    .superRefine((value, context) => {
      for (const cidr of splitList(value)) {
        try {
          parseCidr(cidr);
        } catch (error) {
          context.addIssue({
            code: 'custom',
            // parseCidr throws only its own Errors, each naming the range.
            message: `ALLOWED_CLIENT_CIDRS: ${(error as Error).message}`,
          });
        }
      }
    }),
  /** Signs repository-health webhook alerts. Unset: webhooks are not sent. */
  HEALTH_WEBHOOK_SECRET: z.string().min(32).optional(),
  /**
   * Verifies GitHub's `X-Hub-Signature-256` on `POST /api/v1/webhooks/github`. The receiver
   * answers only with this set **and** `AUTOMATE_LAN_MODE` on; otherwise it is a 404.
   */
  GITHUB_WEBHOOK_SECRET: secretSchema('GITHUB_WEBHOOK_SECRET').optional(),
  /** A Slack bot token for repository-health alerts. Unset: Slack alerts are not sent. */
  SLACK_BOT_TOKEN: z.string().min(1).optional(),
  SESSION_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  SSE_REPLAY_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  RETENTION_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(3600),
  /**
   * How often the API runs the delivery syncs the worker queued. A whole number of
   * milliseconds, at least ten seconds: `Number('soon')` is NaN, and a NaN interval makes
   * `setInterval` fire continuously.
   */
  DELIVERY_SYNC_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),
  /**
   * The folder the API registers and re-detects at boot, and **opt-in with no
   * default**.
   *
   * There is deliberately no fallback to the working directory. In compose the cwd
   * is `/app`, which has a `package.json`, so a default would register the container
   * as the operator's project and the cockpit would analyse the wrong tree with total
   * confidence. An empty value is absence rather than an empty path, because
   * `parseConfig` filters empty strings out before the schema sees them.
   */
  AUTOMATE_PROJECT_ROOT: z.string().min(1).optional(),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl?: string;
  cookieSecret: string;
  sessionSecret?: string;
  vaultSecret?: string;
  publicAppUrl: string;
  workspaceId: string;
  installationApiKey?: string;
  reporterSecret?: string;
  runnerRegistrationSecret?: string;
  artifactRoot: string;
  workerPollIntervalMs: number;
  /**
   * The lease length, and the canonical name for it.
   *
   * There is also a `WORKER_LEASE_MS` environment variable for the same setting. It is
   * **undocumented** — `.env.example` has only ever listed `WORKER_LEASE_DURATION_MS` —
   * and `apps/worker/src/config.ts` reads it as a fallback for installs that set it before
   * the rename. It is kept rather than removed because removing an environment variable
   * silently changes behaviour for anyone who set one, and a lease length that quietly
   * reverts to 30 s is worse than a deprecated name.
   *
   * The previous `workerLeaseMs` field is gone: it was written here and read by nothing,
   * so the only thing it could do was look like the setting it was not.
   */
  workerLeaseDurationMs: number;
  workerMaxAttempts: number;
  kiloGatewayUrl?: string;
  kiloApiKey?: string;
  ollamaBaseUrl?: string;
  sessionTtlHours: number;
  /** `TRUST_PROXY`: read X-Forwarded-For for the client address. */
  trustProxy: boolean;
  /** `ACCESS_CONTROL`: whether the role guards refuse a caller with no credential. */
  accessControl: 'open' | 'enforced';
  /** `AUTOMATE_PROFILE`, or the profile the other settings imply. */
  profile: Profile;
  /** `AUTOMATE_REMOTE`: how the install is reached from outside its network, if it is. */
  remote?: RemoteMode;
  /** Present when both `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are set. */
  cloudflareAccess?: CloudflareAccessConfig;
  /** Present when `OIDC_ISSUER` and `OIDC_CLIENT_ID` are set. */
  oidc?: OidcConfig;
  /** `AUTH_SSO_ENFORCED`, or the profile's default: browsers sign in through SSO only. */
  ssoEnforced: boolean;
  /** `AUTOMATE_BREAK_GLASS`: the installation key may sign a browser in under enforced SSO. */
  breakGlass: boolean;
  /** `AUTOMATE_LAN_MODE`: serve other machines on the local network. */
  lanMode: boolean;
  /**
   * Where the install is reachable from: `AUTOMATE_BIND` when set. Otherwise `HOST`, unless
   * `HOST` is a wildcard (`0.0.0.0`, `::`), which names no machine: it is how every container
   * listens, and the 3.0.0 compose file sets it without `AUTOMATE_BIND`. That case reads as
   * loopback, with {@link bindUndeclared} saying the exposure is unknown rather than safe.
   */
  exposedBind: string;
  /** No `AUTOMATE_BIND`, and a wildcard `HOST`: the install cannot tell who can reach it. */
  bindUndeclared: boolean;
  /** `ALLOWED_CLIENT_CIDRS`, or {@link DEFAULT_CLIENT_CIDRS}. */
  allowedClientCidrs: string[];
  healthWebhookSecret?: string;
  /** `GITHUB_WEBHOOK_SECRET`: the GitHub webhook receiver's HMAC key. */
  githubWebhookSecret?: string;
  slackBotToken?: string;
  sessionRetentionDays: number;
  sseReplayRetentionHours: number;
  auditRetentionDays: number;
  retentionSweepIntervalSeconds: number;
  /** `DELIVERY_SYNC_INTERVAL_MS`: the delivery syncer's interval, 10 s or more. */
  deliverySyncIntervalMs: number;
  /** `undefined` means discovery is off. There is no working-directory default. */
  projectRoot?: string;
};

export function parseConfig(
  input: Record<string, string | undefined>,
  options: { requireProductionSecrets?: boolean } = {},
): AppConfig {
  const normalized = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== ''));
  const parsed = EnvironmentSchema.parse(normalized);
  const requireProductionSecrets =
    options.requireProductionSecrets ?? parsed.NODE_ENV === 'production';
  const cookieSecret = parsed.COOKIE_SECRET ?? parsed.SESSION_SECRET;
  if (!cookieSecret && requireProductionSecrets) throw new Error('COOKIE_SECRET is required');
  if (!parsed.DATABASE_URL && requireProductionSecrets) throw new Error('DATABASE_URL is required');
  if (!parsed.VAULT_SECRET && requireProductionSecrets) throw new Error('VAULT_SECRET is required');
  if (parsed.KILO_GATEWAY_URL && !parsed.KILO_API_KEY) {
    throw new Error('KILO_API_KEY is required with KILO_GATEWAY_URL');
  }
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    // The one committed fallback literal in the configuration layer, and it is a
    // 38-character value so that it satisfies the floor above it. It is a *published
    // signing key*, so it is never handed to a production composition: the API's
    // `getConfig` nulls it out for production and the startup policy refuses it by
    // name. Deriving it per process instead would be better, and would also mean a
    // developer's sessions do not survive a restart — recorded rather than done
    // here, because changing it is a behaviour change for every local install and
    // this row is about the floor, not about the fallback.
    cookieSecret: cookieSecret ?? 'development-only-cookie-secret-32-chars',
    sessionSecret: parsed.SESSION_SECRET,
    vaultSecret: parsed.VAULT_SECRET,
    publicAppUrl: parsed.PUBLIC_APP_URL,
    workspaceId: parsed.WORKSPACE_ID,
    installationApiKey: parsed.AUTOMATE_API_KEY,
    reporterSecret: parsed.REPORTER_SECRET,
    runnerRegistrationSecret: parsed.RUNNER_REGISTRATION_SECRET,
    artifactRoot: parsed.ARTIFACT_ROOT,
    workerPollIntervalMs: parsed.WORKER_POLL_INTERVAL_MS,
    workerLeaseDurationMs: parsed.WORKER_LEASE_DURATION_MS,
    workerMaxAttempts: parsed.WORKER_MAX_ATTEMPTS,
    kiloGatewayUrl: parsed.KILO_GATEWAY_URL,
    kiloApiKey: parsed.KILO_API_KEY,
    ollamaBaseUrl: parsed.OLLAMA_BASE_URL,
    sessionTtlHours: parsed.SESSION_TTL_HOURS,
    trustProxy: parsed.TRUST_PROXY === 'true',
    ...profileAndAccess(parsed),
    ...remoteAccess(parsed),
    ...oidcSignIn(parsed),
    lanMode: parsed.AUTOMATE_LAN_MODE,
    exposedBind: parsed.AUTOMATE_BIND ?? (isWildcardBind(parsed.HOST) ? DEFAULT_HOST : parsed.HOST),
    bindUndeclared: parsed.AUTOMATE_BIND === undefined && isWildcardBind(parsed.HOST),
    allowedClientCidrs:
      parsed.ALLOWED_CLIENT_CIDRS === undefined
        ? [...DEFAULT_CLIENT_CIDRS]
        : splitList(parsed.ALLOWED_CLIENT_CIDRS),
    ...optionalIntegrations(parsed),
    sessionRetentionDays: parsed.SESSION_RETENTION_DAYS,
    sseReplayRetentionHours: parsed.SSE_REPLAY_RETENTION_HOURS,
    auditRetentionDays: parsed.AUDIT_RETENTION_DAYS,
    retentionSweepIntervalSeconds: parsed.RETENTION_SWEEP_INTERVAL_SECONDS,
    deliverySyncIntervalMs: parsed.DELIVERY_SYNC_INTERVAL_MS,
    projectRoot: parsed.AUTOMATE_PROJECT_ROOT,
  };
}

/**
 * The profile, and the access control it defaults.
 *
 * An unset profile is derived rather than assumed: an install from before profiles that
 * turned LAN mode or access control on already serves other people, and reading it as
 * `solo` would make the startup policy refuse an install that was working.
 */
function profileAndAccess(
  parsed: z.infer<typeof EnvironmentSchema>,
): Pick<AppConfig, 'profile' | 'accessControl' | 'ssoEnforced' | 'breakGlass'> {
  // An install that already serves other people: LAN mode, a tunnel, or a login turned on.
  const serves =
    parsed.AUTOMATE_LAN_MODE ||
    parsed.AUTOMATE_REMOTE !== undefined ||
    parsed.ACCESS_CONTROL === 'enforced';
  const profile: Profile = parsed.AUTOMATE_PROFILE ?? (serves ? 'startup' : 'solo');
  const defaults = resolveProfileDefaults(profile);
  return {
    profile,
    accessControl:
      parsed.ACCESS_CONTROL ??
      (parsed.AUTOMATE_LAN_MODE || parsed.AUTOMATE_REMOTE !== undefined
        ? 'enforced'
        : defaults.accessControl),
    ssoEnforced: parsed.AUTH_SSO_ENFORCED ?? defaults.ssoEnforced,
    breakGlass: parsed.AUTOMATE_BREAK_GLASS,
  };
}

/**
 * Remote access settings. The team domain and role map are validated here so a malformed
 * value stops the process at startup; a missing half leaves `cloudflareAccess` out, and the
 * startup policy names what is missing when `AUTOMATE_REMOTE` asks for it.
 */
function remoteAccess(
  parsed: z.infer<typeof EnvironmentSchema>,
): Pick<AppConfig, 'remote' | 'cloudflareAccess'> {
  const remote: Pick<AppConfig, 'remote' | 'cloudflareAccess'> = {};
  if (parsed.AUTOMATE_REMOTE !== undefined) remote.remote = parsed.AUTOMATE_REMOTE;
  const teamDomain =
    parsed.CF_ACCESS_TEAM_DOMAIN === undefined
      ? undefined
      : normalizeCloudflareTeamDomain(parsed.CF_ACCESS_TEAM_DOMAIN);
  const roleMap = parseCloudflareRoleMap(parsed.CF_ACCESS_ROLE_MAP);
  if (teamDomain !== undefined && parsed.CF_ACCESS_AUD !== undefined) {
    remote.cloudflareAccess = {
      teamDomain,
      audience: parsed.CF_ACCESS_AUD,
      roleMap,
      defaultRole: parsed.CF_ACCESS_DEFAULT_ROLE === 'none' ? null : parsed.CF_ACCESS_DEFAULT_ROLE,
    };
  }
  return remote;
}

/** OIDC sign-in settings (ADR-014, the team profile). */
export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** `PUBLIC_APP_URL` + `/api/v1/auth/oidc/callback`: what the provider must have registered. */
  redirectUri: string;
  /** Lowercased email domains allowed to sign in; empty allows any. */
  allowedDomains: string[];
  roleMap: RoleRule[];
  /** The role of a person no rule names, on their first sign-in; `null` admits only the named. */
  defaultRole: AccessRole | null;
}

/**
 * OIDC sign-in. Off unless the issuer and the client id are both set. A client id without a
 * secret is refused rather than read as a public client, and the issuer must be HTTPS unless
 * it is on this machine: its keys sign every identity, and keys fetched in the clear prove
 * nothing.
 */
function oidcSignIn(parsed: z.infer<typeof EnvironmentSchema>): Pick<AppConfig, 'oidc'> {
  if (parsed.OIDC_ISSUER === undefined || parsed.OIDC_CLIENT_ID === undefined) return {};
  const issuer = new URL(parsed.OIDC_ISSUER);
  if (
    issuer.protocol !== 'https:' &&
    !(issuer.protocol === 'http:' && isLoopbackBind(issuer.hostname))
  ) {
    throw new Error(
      `OIDC_ISSUER must use https:// (or http:// on this machine only); got ${parsed.OIDC_ISSUER}`,
    );
  }
  if (parsed.OIDC_CLIENT_SECRET === undefined) {
    throw new Error(
      'OIDC_CLIENT_SECRET is required with OIDC_CLIENT_ID: register Automate with your identity ' +
        'provider as a confidential web application and copy its client secret.',
    );
  }
  const publicUrl = parsed.PUBLIC_APP_URL.replace(/\/+$/u, '');
  return {
    oidc: {
      issuer: parsed.OIDC_ISSUER.replace(/\/+$/u, ''),
      clientId: parsed.OIDC_CLIENT_ID,
      clientSecret: parsed.OIDC_CLIENT_SECRET,
      redirectUri: `${publicUrl}/api/v1/auth/oidc/callback`,
      allowedDomains: splitList(parsed.OIDC_ALLOWED_DOMAINS).map((domain) => domain.toLowerCase()),
      roleMap: parseRoleMap('OIDC_ROLE_MAP', parsed.OIDC_ROLE_MAP),
      defaultRole: parsed.OIDC_DEFAULT_ROLE === 'none' ? null : parsed.OIDC_DEFAULT_ROLE,
    },
  };
}

/**
 * The integration secrets that are absent rather than empty when unset, so a caller's
 * `config.x !== undefined` means "configured" and nothing else.
 */
function optionalIntegrations(
  parsed: z.infer<typeof EnvironmentSchema>,
): Pick<AppConfig, 'healthWebhookSecret' | 'githubWebhookSecret' | 'slackBotToken'> {
  const optional: Pick<AppConfig, 'healthWebhookSecret' | 'githubWebhookSecret' | 'slackBotToken'> =
    {};
  if (parsed.HEALTH_WEBHOOK_SECRET !== undefined) {
    optional.healthWebhookSecret = parsed.HEALTH_WEBHOOK_SECRET;
  }
  if (parsed.GITHUB_WEBHOOK_SECRET !== undefined) {
    optional.githubWebhookSecret = parsed.GITHUB_WEBHOOK_SECRET;
  }
  if (parsed.SLACK_BOT_TOKEN !== undefined) optional.slackBotToken = parsed.SLACK_BOT_TOKEN;
  return optional;
}
