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
  bootEnvironment,
  bootProbes,
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
