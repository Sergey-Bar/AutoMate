/**
 * The pieces of `pnpm compose:boot` that can be tested without a container runtime.
 *
 * `scripts/compose-boot.mjs` starts the production compose stack from a clean state,
 * probes it the way a person who just installed it would, and tears it down. Static
 * checks (`compose-contract.mjs`) catch the defects that can be read; this catches the
 * ones that only exist once the containers run — the nginx pid path and tmpfs ownership
 * of ledger MNT-23 passed every static check and failed on the first `up`.
 */

import { randomBytes } from 'node:crypto';

/**
 * Every variable a compose file refuses to start without (`${NAME:?…}`).
 *
 * @param {string} text the compose file
 * @returns {string[]} sorted, unique
 */
export function requiredVariables(text) {
  const names = new Set();
  for (const match of text.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)) names.add(match[1] ?? '');
  names.delete('');
  return [...names].sort();
}

/**
 * A throwaway value for each required variable.
 *
 * Secrets are 48 hex characters — over the 32-character floor in `@automate/config`, and
 * random per run so nothing credential-shaped is committed. The bucket and region are the
 * only two that must be a particular shape rather than secret.
 *
 * @param {string[]} names
 * @param {(size: number) => Buffer} [random]
 * @returns {Map<string, string>}
 */
export function bootEnvironment(names, random = randomBytes) {
  /** @type {Map<string, string>} */
  const values = new Map();
  for (const name of names) {
    if (name === 'OBJECT_STORE_BUCKET') values.set(name, 'automate-artifacts');
    else if (name === 'OBJECT_STORE_REGION') values.set(name, 'us-east-1');
    else if (name === 'OBJECT_STORE_ACCESS_KEY_ID') {
      values.set(name, `AK${random(9).toString('hex').toUpperCase()}`);
    } else values.set(name, random(24).toString('hex'));
  }
  return values;
}

/**
 * The `.env` text for a map of values.
 *
 * @param {Map<string, string>} values
 * @returns {string}
 */
export function envFileText(values) {
  return `${[...values].map(([name, value]) => `${name}=${value}`).join('\n')}\n`;
}

/**
 * The probes a fresh install has to pass, in order.
 *
 * @param {string} base the URL a user opens, for example `http://127.0.0.1:8080`
 * @param {string} installationKey the key the start script prints
 * @returns {Array<{ name: string, url: string, init?: RequestInit, expect: number }>}
 */
export function bootProbes(base, installationKey) {
  return [
    { name: 'API ready', url: `${base}/api/v1/ready`, expect: 200 },
    { name: 'web UI', url: `${base}/`, expect: 200 },
    {
      name: 'sign in with the installation key',
      url: `${base}/api/v1/auth/login`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: installationKey }),
      },
      expect: 200,
    },
  ];
}

/** Packages that exist for development only; none may resolve inside a runtime image. */
export const DEV_ONLY_PACKAGES = ['vitest', 'eslint', 'typescript'];

/** The Node images whose runtime is a `pnpm deploy --prod` output. */
export const NODE_RUNTIME_IMAGES = ['api', 'worker', 'migrate', 'runner'];

/**
 * A script for `node -e` that prints the dev-only packages it can resolve.
 *
 * @returns {string}
 */
export function devPackageProbe() {
  const names = JSON.stringify(DEV_ONLY_PACKAGES);
  return `const f=[];for(const n of ${names}){try{require.resolve(n);f.push(n)}catch{}}console.log(JSON.stringify(f))`;
}

/**
 * Images over their size ceiling, and built images with no ceiling.
 *
 * @param {Map<string, number>} sizes service name to bytes
 * @param {Record<string, unknown>} budget the parsed `infra/docker/image-budget.json`
 * @returns {string[]}
 */
export function budgetProblems(sizes, budget) {
  /** @type {string[]} */
  const problems = [];
  for (const [service, bytes] of sizes) {
    const entry = /** @type {Record<string, unknown> | undefined} */ (budget[service]);
    const ceiling = entry?.['maxMegabytes'];
    const megabytes = Math.round(bytes / 1024 / 1024);
    if (typeof ceiling !== 'number') {
      problems.push(
        `image \`${service}\` (${String(megabytes)} MB) has no ceiling in image-budget.json`,
      );
    } else if (megabytes > ceiling) {
      problems.push(
        `image \`${service}\` is ${String(megabytes)} MB, over its ${String(ceiling)} MB ceiling`,
      );
    }
  }
  return problems;
}
