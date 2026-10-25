import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
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
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + '\\n');
const state = process.env.FAKE_DOCKER_STATE || 'running';
if (args[0] === 'info' && state === 'stopped') process.exit(1);
if (args[0] === 'compose' && args[1] === 'version' && state === 'no-compose') process.exit(1);
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

/** @param {string} file @returns {Map<string, string>} */
function readEnv(file) {
  return new Map(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^[A-Z_][A-Z0-9_]*=/.test(line))
      .map(
        (line) =>
          /** @type {[string, string]} */ ([
            line.slice(0, line.indexOf('=')),
            line.slice(line.indexOf('=') + 1),
          ]),
      ),
  );
}

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
