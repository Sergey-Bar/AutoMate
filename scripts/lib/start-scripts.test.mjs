import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { requiredVariables } from './compose-boot.mjs';
import { releaseCompose } from './release-compose.mjs';

/**
 * `infra/release/start.sh` and `start.ps1`, run for real against a fake `docker`.
 *
 * The fake records every call to a log and answers `info`/`compose version` according to
 * `FAKE_DOCKER_STATE`, so these tests assert what the scripts *ask Docker to do* — the
 * pull, the up, the volumes kept or removed — and what they tell the user, without a
 * container runtime. Readiness is a real HTTP server on a free port, so the poll loop is
 * exercised too.
 *
 * Each shell is run where it exists. A POSIX `sh` is on every Linux and macOS runner and
 * comes with Git for Windows; PowerShell is on every Windows host and on runners that
 * install `pwsh`. Where a shell is absent its suite is skipped **with the reason**, through
 * the options object — never a committed `.skip()`.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SOURCE = readFileSync(
  path.join(REPO_ROOT, 'infra/compose/docker-compose.unified.yml'),
  'utf8',
);
const RELEASE = releaseCompose(SOURCE, '2.5.0');

/** @returns {string | null} */
function findSh() {
  for (const candidate of ['sh', 'C:\\Program Files\\Git\\bin\\sh.exe']) {
    const probe = spawnSync(candidate, ['-c', 'echo ok'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim() === 'ok') return candidate;
  }
  return null;
}

/** @returns {string | null} */
function findPowerShell() {
  // `AUTOMATE_TEST_POWERSHELL=powershell` runs the suite under Windows PowerShell 5.1,
  // which is what start.cmd launches; `pwsh` is preferred otherwise.
  const preferred = process.env['AUTOMATE_TEST_POWERSHELL'];
  for (const candidate of [...(preferred ? [preferred] : []), 'pwsh', 'powershell']) {
    const probe = spawnSync(candidate, ['-NoProfile', '-Command', 'Write-Output ok'], {
      encoding: 'utf8',
    });
    if (probe.status === 0 && probe.stdout.trim() === 'ok') return candidate;
  }
  return null;
}

const SH = findSh();
const POWERSHELL = findPowerShell();

/** A Node fake for `docker`: logs argv, answers by state. */
const FAKE_DOCKER = `
const { appendFileSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + '\\n');
const state = process.env.FAKE_DOCKER_STATE || 'running';
if (args[0] === 'info' && state === 'stopped') process.exit(1);
if (args[0] === 'compose' && args[1] === 'version' && state === 'no-compose') process.exit(1);
// 'compose cp service:/path local' leaves a file behind, so a backup has bytes to digest.
const cp = args.indexOf('cp');
if (args[0] === 'compose' && cp !== -1) {
  const [from, to] = args.slice(cp + 1);
  if (to !== undefined && !/^[a-z]+:/.test(to)) writeFileSync(to, 'fake bytes of ' + from);
}
// The migration count a backup records and a restore compares.
if (args.includes('psql')) process.stdout.write((process.env.FAKE_MIGRATIONS || '') + '\\n');
process.exit(0);
`;

/**
 * An install directory with the release files, and a fake docker on PATH.
 *
 * @returns {{ dir: string, bin: string, log: string, cleanup: () => void }}
 */
function install() {
  const dir = mkdtempSync(path.join(tmpdir(), 'automate-start-'));
  const bin = path.join(dir, 'fake-bin');
  cpSync(path.join(REPO_ROOT, 'infra/release'), dir, { recursive: true });
  writeFileSync(path.join(dir, 'compose.yml'), RELEASE);
  const log = path.join(dir, 'docker.log');
  writeFileSync(log, '');
  // A fake binary per platform: a POSIX shim and a Windows .cmd, both running the Node fake.
  const fake = path.join(dir, 'fake-docker.cjs');
  writeFileSync(fake, FAKE_DOCKER);
  cpSync(fake, path.join(bin, 'fake-docker.cjs'));
  writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/sh\nexec node "${fake.replace(/\\/g, '/')}" "$@"\n`,
  );
  chmodSync(path.join(bin, 'docker'), 0o755);
  writeFileSync(path.join(bin, 'docker.cmd'), `@node "${fake}" %*\r\n`);
  return { dir, bin, log, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * A server answering `/api/v1/ready` (and the releases API), on a free port.
 *
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
async function readyServer() {
  const server = createServer((request, response) => {
    if (request.url === '/api/v1/ready') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"status":"ready"}');
      return;
    }
    if (request.url === '/releases/latest') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"tag_name":"v9.8.7","name":"v9.8.7"}');
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { port, close: () => new Promise((resolve) => server.close(() => resolve(undefined))) };
}

/**
 * Run a start script, asynchronously so the in-process ready server can answer.
 *
 * @param {'sh' | 'ps'} kind
 * @param {{ dir: string, bin: string, log: string }} where
 * @param {string[]} args
 * @param {Record<string, string>} env
 * @returns {Promise<{ status: number | null, output: string }>}
 */
function run(kind, where, args, env) {
  const command = kind === 'sh' ? (SH ?? 'sh') : (POWERSHELL ?? 'pwsh');
  const argv =
    kind === 'sh'
      ? [path.join(where.dir, 'start.sh'), ...args]
      : [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(where.dir, 'start.ps1'),
          ...args,
        ];
  const child = spawn(command, argv, {
    cwd: where.dir,
    env: {
      ...process.env,
      PATH: `${where.bin}${path.delimiter}${process.env['PATH'] ?? ''}`,
      FAKE_DOCKER_LOG: where.log,
      AUTOMATE_NO_BROWSER: '1',
      AUTOMATE_READY_TIMEOUT: '10',
      ...env,
    },
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += String(chunk)));
  child.stderr.on('data', (chunk) => (output += String(chunk)));
  return new Promise((resolve) => child.on('close', (status) => resolve({ status, output })));
}

/** @param {string} log @returns {string[][]} */
function calls(log) {
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => /** @type {string[]} */ (JSON.parse(line)));
}

/** @param {string[][]} all @param {string} verb */
function composeCall(all, verb) {
  return all.find((argv) => argv[0] === 'compose' && argv.includes(verb));
}

/** @param {string | Buffer} value @returns {string} lowercase hex */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {string} file @returns {Map<string, string>} */
function readEnv(file) {
  return new Map(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
      .map(
        (line) =>
          /** @type {[string, string]} */ ([
            line.slice(0, line.indexOf('=')),
            line.slice(line.indexOf('=') + 1),
          ]),
      ),
  );
}

test('the cloudflare profile runs a tunnel that publishes nothing and is off by default', () => {
  // A tunnel dials out; a published port beside it would be a second front door.
  const block = /\n {2}cloudflared:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9_-]*:\n|\nnetworks:)/u.exec(
    SOURCE,
  )?.[1];
  assert.ok(block, 'no cloudflared service in the compose file');
  assert.match(block, /profiles: \['cloudflare'\]/u);
  assert.match(block, /image: cloudflare\/cloudflared:\d{4}\.\d+\.\d+/u);
  assert.match(block, /TUNNEL_TOKEN: \$\{TUNNEL_TOKEN:-\}/u);
  assert.doesNotMatch(block, /ports:/u);
  // The API reads the tunnel settings, so the startup policy can refuse half of them.
  for (const name of ['AUTOMATE_REMOTE', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD']) {
    assert.match(SOURCE, new RegExp(`\\n {6}${name}: \\$\\{${name}:-\\}`, 'u'), name);
  }
});

for (const [kind, shell] of /** @type {const} */ ([
  ['sh', SH],
  ['ps', POWERSHELL],
])) {
  const skip =
    shell === null ? `no ${kind === 'sh' ? 'POSIX sh' : 'PowerShell'} on this host` : false;
  const label = kind === 'sh' ? 'start.sh' : 'start.ps1';

  test(
    `${label}: first run writes .env with every required secret, then pulls and starts`,
    { skip },
    async () => {
      const where = install();
      const server = await readyServer();
      try {
        const result = await run(kind, where, [], { AUTOMATE_PORT: String(server.port) });
        assert.equal(result.status, 0, result.output);
        const env = readEnv(path.join(where.dir, '.env'));
        for (const name of requiredVariables(RELEASE)) {
          assert.ok(env.has(name), `${label} did not write ${name}`);
          if (name === 'OBJECT_STORE_BUCKET' || name === 'OBJECT_STORE_REGION') continue;
          // An S3 access key id is an identifier, not a secret: 20 characters, AWS-shaped.
          const floor = name === 'OBJECT_STORE_ACCESS_KEY_ID' ? 16 : 32;
          assert.ok(
            (env.get(name) ?? '').length >= floor,
            `${name} is shorter than ${String(floor)} characters`,
          );
        }
        assert.notEqual(env.get('COOKIE_SECRET'), env.get('VAULT_SECRET'), 'secrets must differ');
        const all = calls(where.log);
        assert.ok(composeCall(all, 'pull'), 'no compose pull');
        const up = composeCall(all, 'up');
        assert.ok(up?.includes('-d'), 'no compose up -d');
        assert.match(result.output, new RegExp(`http://localhost:${String(server.port)}`));
        assert.ok(
          result.output.includes(env.get('AUTOMATE_INSTALLATION_KEY') ?? '!'),
          'the sign-in key is not printed',
        );
      } finally {
        await server.close();
        where.cleanup();
      }
    },
  );

  test(`${label}: a second run keeps the existing .env`, { skip }, async () => {
    const where = install();
    const server = await readyServer();
    try {
      await run(kind, where, [], { AUTOMATE_PORT: String(server.port) });
      const first = readFileSync(path.join(where.dir, '.env'), 'utf8');
      const result = await run(kind, where, [], { AUTOMATE_PORT: String(server.port) });
      assert.equal(result.status, 0, result.output);
      assert.equal(readFileSync(path.join(where.dir, '.env'), 'utf8'), first);
    } finally {
      await server.close();
      where.cleanup();
    }
  });

  test(
    `${label}: says what to do when Docker is missing, stopped, or has no Compose v2`,
    { skip },
    async () => {
      const where = install();
      try {
        const missing = await run(kind, where, [], { AUTOMATE_DOCKER: 'no-such-docker-binary' });
        assert.notEqual(missing.status, 0);
        assert.match(missing.output, /Docker is not installed/);
        assert.match(missing.output, /https:\/\/docs\.docker\.com\/get-docker\//);
        const stopped = await run(kind, where, [], { FAKE_DOCKER_STATE: 'stopped' });
        assert.notEqual(stopped.status, 0);
        assert.match(stopped.output, /Docker is not running/);
        const noCompose = await run(kind, where, [], { FAKE_DOCKER_STATE: 'no-compose' });
        assert.notEqual(noCompose.status, 0);
        assert.match(noCompose.output, /Docker Compose v2/);
        assert.equal(
          existsSync(path.join(where.dir, '.env')),
          false,
          'no .env before Docker is usable',
        );
      } finally {
        where.cleanup();
      }
    },
  );

  test(
    `${label}: lan-cert issues the certificate inside the edge image, for this machine's names`,
    { skip },
    async () => {
      const where = install();
      try {
        const result = await run(kind, where, ['lan-cert'], {
          AUTOMATE_TLS_NAMES: 'qa.example.lan',
        });
        assert.equal(result.status, 0, result.output);
        const issued = composeCall(calls(where.log), 'run');
        assert.ok(issued, `no compose run: ${result.output}`);
        // As root, because the certificate directory is a host mount nginx cannot write.
        assert.deepEqual(issued.slice(issued.indexOf('run')), [
          'run',
          '--rm',
          '--no-deps',
          '--user',
          '0',
          '--entrypoint',
          'automate-lan-cert',
          'edge',
          issued.at(-1) ?? '',
        ]);
        const names = (issued.at(-1) ?? '').split(',');
        for (const name of ['automate.local', 'localhost', '127.0.0.1', 'qa.example.lan']) {
          assert.ok(names.includes(name), `${name} missing from ${names.join(',')}`);
        }
        assert.ok(!names.includes(''), 'an empty name would be an empty subjectAltName');
        assert.match(result.output, /ca\.crt/);
      } finally {
        where.cleanup();
      }
    },
  );

  test(
    `${label}: refuses to open the install beyond this machine without LAN mode`,
    { skip },
    async () => {
      // It used to warn and start anyway. A reachable install with no login is refused now,
      // here before anything is pulled and again by the API's own startup policy.
      const where = install();
      const server = await readyServer();
      try {
        const refused = await run(kind, where, [], {
          AUTOMATE_PORT: String(server.port),
          AUTOMATE_BIND: '0.0.0.0',
        });
        assert.notEqual(refused.status, 0, refused.output);
        assert.match(refused.output, /AUTOMATE_LAN_MODE=1/);
        assert.equal(composeCall(calls(where.log), 'up'), undefined, 'nothing may start');

        const lan = await run(kind, where, [], {
          AUTOMATE_PORT: String(server.port),
          AUTOMATE_BIND: '0.0.0.0',
          AUTOMATE_LAN_MODE: '1',
        });
        assert.equal(lan.status, 0, lan.output);
        assert.match(lan.output, /LAN mode/);
        // The firewall is the operator's to change, so the command is printed, never run.
        assert.match(lan.output, kind === 'ps' ? /New-NetFirewallRule/ : /ufw allow|firewall-cmd/);

        const quiet = await run(kind, where, [], { AUTOMATE_PORT: String(server.port) });
        assert.equal(quiet.status, 0, quiet.output);
        assert.doesNotMatch(quiet.output, /LAN mode|AUTOMATE_LAN_MODE/);
      } finally {
        await server.close();
        where.cleanup();
      }
    },
  );

  test(
    `${label}: a profile decides who may reach the install, and solo stays on this machine`,
    { skip },
    async () => {
      // The API refuses the same combinations (checkExposurePolicy, ADR-014); the script
      // repeats them so the operator reads the refusal before anything is pulled.
      const where = install();
      const server = await readyServer();
      try {
        const base = { AUTOMATE_PORT: String(server.port) };
        const unknown = await run(kind, where, [], { ...base, AUTOMATE_PROFILE: 'business' });
        assert.notEqual(unknown.status, 0, unknown.output);
        assert.match(unknown.output, /solo, startup, team or enterprise/);

        const soloReachable = await run(kind, where, [], {
          ...base,
          AUTOMATE_PROFILE: 'solo',
          AUTOMATE_BIND: '0.0.0.0',
        });
        assert.notEqual(soloReachable.status, 0, soloReachable.output);
        assert.match(soloReachable.output, /AUTOMATE_PROFILE=startup/);

        const soloLan = await run(kind, where, [], {
          ...base,
          AUTOMATE_PROFILE: 'solo',
          AUTOMATE_LAN_MODE: '1',
        });
        assert.notEqual(soloLan.status, 0, soloLan.output);
        assert.match(soloLan.output, /AUTOMATE_PROFILE=solo/);
        assert.equal(composeCall(calls(where.log), 'up'), undefined, 'nothing may start');

        // Every profile above solo turns sign-in on, so it may be published.
        const team = await run(kind, where, [], {
          ...base,
          AUTOMATE_PROFILE: 'team',
          AUTOMATE_BIND: '0.0.0.0',
        });
        assert.equal(team.status, 0, team.output);
        assert.match(team.output, /after signing in/);
      } finally {
        await server.close();
        where.cleanup();
      }
    },
  );

  test(
    `${label}: --profile records the profile in .env, keeps every secret, and names the next step`,
    { skip },
    async () => {
      const where = install();
      const server = await readyServer();
      try {
        const base = { AUTOMATE_PORT: String(server.port) };
        const first = await run(kind, where, ['--profile', 'team'], base);
        assert.equal(first.status, 0, first.output);
        const before = readEnv(path.join(where.dir, '.env'));
        assert.equal(before.get('AUTOMATE_PROFILE'), 'team');
        assert.match(first.output, /Profile: team/);
        assert.match(first.output, /Next step:/);

        const second = await run(kind, where, ['--profile', 'startup'], base);
        assert.equal(second.status, 0, second.output);
        const text = readFileSync(path.join(where.dir, '.env'), 'utf8');
        assert.equal(text.match(/^AUTOMATE_PROFILE=/gm)?.length, 1, 'one profile line, not two');
        const after = readEnv(path.join(where.dir, '.env'));
        assert.equal(after.get('AUTOMATE_PROFILE'), 'startup');
        // A rerun that rewrote a secret would lock the install out of its own vault.
        for (const name of ['COOKIE_SECRET', 'VAULT_SECRET', 'AUTOMATE_INSTALLATION_KEY']) {
          assert.equal(after.get(name), before.get(name), `${name} changed on a rerun`);
        }

        const wrong = await run(kind, where, ['--profile', 'business'], base);
        assert.notEqual(wrong.status, 0, wrong.output);
        assert.equal(readEnv(path.join(where.dir, '.env')).get('AUTOMATE_PROFILE'), 'startup');
      } finally {
        await server.close();
        where.cleanup();
      }
    },
  );

  test(
    `${label}: backup writes the database, the objects, the secrets and a digest of each`,
    { skip },
    async () => {
      const where = install();
      const server = await readyServer();
      try {
        // A backup is of an install that exists, so the first start comes first.
        const env = {
          AUTOMATE_PORT: String(server.port),
          AUTOMATE_VERSION: '3.2.0',
          FAKE_MIGRATIONS: '34',
        };
        const nothing = await run(kind, where, ['backup'], env);
        assert.notEqual(nothing.status, 0, nothing.output);
        assert.match(nothing.output, /nothing to back up/i);
        assert.equal((await run(kind, where, [], env)).status, 0);
        const created = await run(kind, where, ['backup'], env);
        assert.equal(created.status, 0, created.output);
        const backups = path.join(where.dir, 'backups');
        const [name] = readdirSync(backups);
        assert.ok(name?.startsWith('automate-'), `no backup directory in ${backups}`);
        const folder = path.join(backups, name ?? '');
        const manifest = readEnv(path.join(folder, 'manifest.env'));
        assert.equal(manifest.get('format'), '1');
        assert.equal(manifest.get('version'), '3.2.0');
        assert.equal(manifest.get('migrations'), '34');
        // A digest of the vault key, never the key: restore compares it.
        const vault = readEnv(path.join(where.dir, '.env')).get('VAULT_SECRET') ?? '';
        assert.equal(manifest.get('vault'), sha256(vault));
        assert.ok(!readFileSync(path.join(folder, 'manifest.env'), 'utf8').includes(vault));
        const sums = readFileSync(path.join(folder, 'SHA256SUMS'), 'utf8');
        for (const part of ['database.dump', 'objects.tar', 'env']) {
          const digest = sha256(readFileSync(path.join(folder, part)));
          assert.match(sums, new RegExp(`^${digest}  ${part}$`, 'm'), `${part} digest`);
        }
        const all = calls(where.log);
        assert.ok(
          all.some((argv) => argv.includes('pg_dump')),
          'the database was not dumped',
        );
        assert.ok(
          all.some((argv) => argv.includes('objectstore') && argv.includes('tar')),
          'the objects were not archived',
        );
        assert.match(created.output, /holds your secrets/);
      } finally {
        await server.close();
        where.cleanup();
      }
    },
  );

  test(
    `${label}: restore refuses a damaged, newer or foreign backup, and restores a good one`,
    { skip },
    async () => {
      const where = install();
      const server = await readyServer();
      try {
        const base = {
          AUTOMATE_PORT: String(server.port),
          AUTOMATE_VERSION: '3.2.0',
          FAKE_MIGRATIONS: '34',
        };
        assert.equal((await run(kind, where, [], base)).status, 0);
        assert.equal((await run(kind, where, ['backup'], base)).status, 0);
        const [name] = readdirSync(path.join(where.dir, 'backups'));
        const folder = path.join('backups', name ?? '');
        const full = path.join(where.dir, folder);
        writeFileSync(where.log, '');
        const restored = () => calls(where.log).some((argv) => argv.includes('pg_restore'));

        const missing = await run(kind, where, ['restore', 'backups/nowhere'], base);
        assert.notEqual(missing.status, 0, missing.output);
        assert.match(missing.output, /no backup/i);

        // A schema newer than this install's: restoring it would hand old code new tables.
        const behind = await run(kind, where, ['restore', folder], {
          ...base,
          FAKE_MIGRATIONS: '30',
        });
        assert.notEqual(behind.status, 0, behind.output);
        assert.match(behind.output, /34 migrations.*30/);
        assert.equal(restored(), false, 'a newer schema was restored');

        const older = await run(kind, where, ['restore', folder], {
          ...base,
          AUTOMATE_VERSION: '3.1.0',
        });
        assert.notEqual(older.status, 0, older.output);
        assert.match(older.output, /3\.2\.0.*newer/);
        assert.equal(restored(), false, 'a newer release was restored');

        // Secrets that differ from the ones the data was encrypted with.
        const envFile = path.join(where.dir, '.env');
        const original = readFileSync(envFile, 'utf8');
        writeFileSync(
          envFile,
          original.replace(/^VAULT_SECRET=.*$/m, `VAULT_SECRET=${'f'.repeat(48)}`),
        );
        const foreign = await run(kind, where, ['restore', folder], base);
        assert.notEqual(foreign.status, 0, foreign.output);
        assert.match(foreign.output, /VAULT_SECRET/);
        assert.equal(restored(), false, 'data was restored under a different vault key');
        writeFileSync(envFile, original);

        // One byte changed in one part.
        const dump = path.join(full, 'database.dump');
        const bytes = readFileSync(dump);
        writeFileSync(dump, `${bytes.toString()}x`);
        const damaged = await run(kind, where, ['restore', folder], base);
        assert.notEqual(damaged.status, 0, damaged.output);
        assert.match(damaged.output, /database\.dump.*does not match/);
        assert.equal(restored(), false, 'a damaged dump was restored');
        writeFileSync(dump, bytes);

        const good = await run(kind, where, ['restore', folder], base);
        assert.equal(good.status, 0, good.output);
        const all = calls(where.log);
        assert.ok(restored(), 'the database was not restored');
        assert.ok(
          all.some(
            (argv) =>
              argv.includes('objectstore') && argv.some((part) => part.includes('objects.tar')),
          ),
          'the objects were not restored',
        );
        assert.ok(composeCall(all, 'up')?.includes('-d'), 'the install was not started again');
      } finally {
        await server.close();
        where.cleanup();
      }
    },
  );

  test(
    `${label}: --remote cloudflare records the tunnel, starts its profile, and refuses half a setup`,
    { skip },
    async () => {
      const where = install();
      const server = await readyServer();
      try {
        const base = { AUTOMATE_PORT: String(server.port) };
        const tunnel = {
          // Assembled, not a literal: a tunnel token is a credential.
          TUNNEL_TOKEN: ['eyJh', 'IjoiZmFrZSJ9', '/+='].join(''),
          CF_ACCESS_TEAM_DOMAIN: 'acme',
          CF_ACCESS_AUD: 'aud-0123',
        };
        const half = await run(kind, where, ['--remote', 'cloudflare'], {
          ...base,
          CF_ACCESS_TEAM_DOMAIN: 'acme',
        });
        assert.notEqual(half.status, 0, half.output);
        assert.match(half.output, /TUNNEL_TOKEN/);
        assert.match(half.output, /CF_ACCESS_AUD/);
        assert.equal(composeCall(calls(where.log), 'up'), undefined, 'nothing may start');

        const solo = await run(kind, where, ['--profile', 'solo', '--remote', 'cloudflare'], {
          ...base,
          ...tunnel,
        });
        assert.notEqual(solo.status, 0, solo.output);
        assert.match(solo.output, /AUTOMATE_PROFILE=solo/);
        writeFileSync(where.log, '');

        const started = await run(kind, where, ['--profile', 'startup', '--remote', 'cloudflare'], {
          ...base,
          ...tunnel,
        });
        assert.equal(started.status, 0, started.output);
        const env = readEnv(path.join(where.dir, '.env'));
        assert.equal(env.get('AUTOMATE_REMOTE'), 'cloudflare');
        // Kept in .env, so the next plain start still has the tunnel; the token survives
        // characters (`/`, `+`, `=`) a sed replacement would mangle.
        assert.equal(env.get('TUNNEL_TOKEN'), tunnel.TUNNEL_TOKEN);
        assert.equal(env.get('CF_ACCESS_AUD'), 'aud-0123');
        const up = composeCall(calls(where.log), 'up');
        assert.ok(up, 'no compose up');
        const at = up.indexOf('--profile');
        assert.equal(
          up[at + 1],
          'cloudflare',
          `the tunnel profile was not started: ${up.join(' ')}`,
        );
        assert.ok(!started.output.includes(tunnel.TUNNEL_TOKEN), 'the tunnel token was printed');
        assert.match(started.output, /Cloudflare/);

        writeFileSync(where.log, '');
        const again = await run(kind, where, [], base);
        assert.equal(again.status, 0, again.output);
        assert.ok(composeCall(calls(where.log), 'up')?.includes('cloudflare'), 'tunnel dropped');
      } finally {
        await server.close();
        where.cleanup();
      }
    },
  );

  test(`${label}: uninstall keeps the data unless --purge is given`, { skip }, async () => {
    const where = install();
    try {
      writeFileSync(path.join(where.dir, '.env'), 'COOKIE_SECRET=x\n');
      const keep = await run(kind, where, ['uninstall'], {});
      assert.equal(keep.status, 0, keep.output);
      const down = composeCall(calls(where.log), 'down');
      assert.ok(down, 'no compose down');
      assert.equal(down.includes('-v'), false, 'uninstall removed the volumes');
      assert.ok(existsSync(path.join(where.dir, '.env')));
      writeFileSync(where.log, '');
      const purge = await run(kind, where, ['uninstall', '--purge'], {});
      assert.equal(purge.status, 0, purge.output);
      assert.ok(composeCall(calls(where.log), 'down')?.includes('-v'), '--purge kept the volumes');
      assert.equal(existsSync(path.join(where.dir, '.env')), false, '--purge kept .env');
    } finally {
      where.cleanup();
    }
  });

  test(`${label}: update moves AUTOMATE_VERSION, then pulls and restarts`, { skip }, async () => {
    const where = install();
    const server = await readyServer();
    try {
      const port = String(server.port);
      await run(kind, where, [], { AUTOMATE_PORT: port });
      writeFileSync(where.log, '');
      const pinned = await run(kind, where, ['update', '--version', '3.1.4'], {
        AUTOMATE_PORT: port,
      });
      assert.equal(pinned.status, 0, pinned.output);
      assert.equal(readEnv(path.join(where.dir, '.env')).get('AUTOMATE_VERSION'), '3.1.4');
      assert.ok(composeCall(calls(where.log), 'pull'));
      assert.ok(composeCall(calls(where.log), 'up'));
      const latest = await run(kind, where, ['update'], {
        AUTOMATE_PORT: port,
        AUTOMATE_RELEASES_URL: `http://127.0.0.1:${port}/releases/latest`,
      });
      assert.equal(latest.status, 0, latest.output);
      assert.equal(readEnv(path.join(where.dir, '.env')).get('AUTOMATE_VERSION'), '9.8.7');
      const secrets = [...readEnv(path.join(where.dir, '.env')).keys()].filter(
        (key) => key !== 'AUTOMATE_VERSION',
      );
      assert.ok(secrets.includes('COOKIE_SECRET'), 'update dropped the secrets');
    } finally {
      await server.close();
      where.cleanup();
    }
  });

  test(`${label}: stop, status and logs pass through to compose`, { skip }, async () => {
    const where = install();
    try {
      writeFileSync(path.join(where.dir, '.env'), 'COOKIE_SECRET=x\n');
      for (const [verb, expected] of [
        ['stop', 'stop'],
        ['status', 'ps'],
        ['logs', 'logs'],
      ]) {
        writeFileSync(where.log, '');
        const result = await run(kind, where, [verb], {});
        assert.equal(result.status, 0, result.output);
        assert.ok(
          composeCall(calls(where.log), expected),
          `${verb} did not run compose ${expected}`,
        );
      }
      const unknown = await run(kind, where, ['frobnicate'], {});
      assert.notEqual(unknown.status, 0);
      assert.match(unknown.output, /Usage/);
    } finally {
      where.cleanup();
    }
  });
}
