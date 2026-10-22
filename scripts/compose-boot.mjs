#!/usr/bin/env node
/**
 * `pnpm compose:boot` — start the production compose stack from nothing, probe it as a
 * new user would, and tear it down.
 *
 * Generates a throwaway env file with a random value for every variable the compose file
 * requires, builds and starts the stack with `--wait`, then probes the API's readiness,
 * the web UI, and a sign-in with the installation key. On any failure it prints the
 * container states and the last log lines of each service, because "the stack did not
 * come up" with no output is the report this gate exists to replace. Volumes are always
 * removed afterwards, so a second run starts from the same nothing as the first.
 *
 * Usage: node scripts/compose-boot.mjs [--keep] [--base http://127.0.0.1:8080]
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  NODE_RUNTIME_IMAGES,
  bootEnvironment,
  bootProbes,
  budgetProblems,
  devPackageProbe,
  envFileText,
  requiredVariables,
} from './lib/compose-boot.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const COMPOSE_FILE = 'infra/compose/docker-compose.unified.yml';
const PROJECT = 'automate-compose-boot';

/** @param {string} flag @returns {string | undefined} */
function option(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * @param {string} envFile
 * @param {string[]} args
 * @returns {number}
 */
function compose(envFile, args) {
  const result = spawnSync(
    'docker',
    ['compose', '-p', PROJECT, '--env-file', envFile, '-f', COMPOSE_FILE, ...args],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
  return result.status ?? 1;
}

/**
 * @param {ReturnType<typeof bootProbes>} probes
 * @returns {Promise<string[]>} failures
 */
async function runProbes(probes) {
  /** @type {string[]} */
  const failures = [];
  for (const probe of probes) {
    const status = await fetch(probe.url, probe.init)
      .then((response) => response.status)
      .catch((error) => `unreachable (${String(error)})`);
    const ok = status === probe.expect;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${probe.name}: ${String(status)}`);
    if (!ok)
      failures.push(`${probe.name}: expected ${String(probe.expect)}, got ${String(status)}`);
  }
  return failures;
}

/**
 * What the built images carry: each under its size ceiling, and no Node runtime able to
 * resolve a dev-only package (the images used to ship Vitest, ESLint and TypeScript).
 *
 * @returns {string[]} failures
 */
function imageProblems() {
  /** @type {Record<string, unknown>} */
  const budget = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'infra/docker/image-budget.json'), 'utf8'),
  );
  /** @type {Map<string, number>} */
  const sizes = new Map();
  /** @type {string[]} */
  const failures = [];
  for (const service of Object.keys(budget).filter((key) => !key.startsWith('$'))) {
    const inspected = spawnSync(
      'docker',
      ['image', 'inspect', '--format', '{{.Size}}', `${PROJECT}-${service}`],
      { encoding: 'utf8' },
    );
    if (inspected.status !== 0) failures.push(`image \`${service}\` was not built`);
    else sizes.set(service, Number(inspected.stdout.trim()));
  }
  failures.push(...budgetProblems(sizes, budget));
  for (const service of NODE_RUNTIME_IMAGES) {
    const probed = spawnSync(
      'docker',
      ['run', '--rm', '--entrypoint', 'node', `${PROJECT}-${service}`, '-e', devPackageProbe()],
      { encoding: 'utf8' },
    );
    const found =
      probed.status === 0
        ? /** @type {string[]} */ (JSON.parse(probed.stdout.trim() || '[]'))
        : null;
    if (found === null)
      failures.push(`image \`${service}\` could not run node: ${probed.stderr.trim()}`);
    else if (found.length > 0)
      failures.push(`image \`${service}\` ships dev-only packages: ${found.join(', ')}`);
  }
  for (const [service, bytes] of sizes)
    console.log(`     image ${service}: ${String(Math.round(bytes / 1024 / 1024))} MB`);
  return failures;
}

async function main() {
  const values = bootEnvironment(
    requiredVariables(readFileSync(path.join(REPO_ROOT, COMPOSE_FILE), 'utf8')),
  );
  const directory = mkdtempSync(path.join(tmpdir(), 'automate-boot-'));
  const envFile = path.join(directory, 'boot.env');
  writeFileSync(envFile, envFileText(values), { mode: 0o600 });
  const base = option('--base') ?? 'http://127.0.0.1:8080';
  /** @type {string[]} */
  let failures = [];
  try {
    if (compose(envFile, ['up', '--build', '--wait', '--wait-timeout', '600']) !== 0) {
      failures.push('docker compose up --wait did not reach a healthy stack');
    } else {
      failures = await runProbes(bootProbes(base, values.get('AUTOMATE_INSTALLATION_KEY') ?? ''));
      failures.push(...imageProblems());
    }
    if (failures.length > 0) {
      compose(envFile, ['ps', '-a']);
      compose(envFile, ['logs', '--no-color', '--tail', '60']);
    }
  } finally {
    if (!process.argv.includes('--keep')) compose(envFile, ['down', '-v', '--remove-orphans']);
    rmSync(directory, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    console.error(`compose:boot failed:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log(
    'compose:boot passed: the production stack starts from nothing and serves a sign-in.',
  );
}

await main();
