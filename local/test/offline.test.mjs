import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { URL, URLSearchParams, pathToFileURL } from 'node:url';
import { FILES_DIR } from './support.mjs';

/**
 * MVP-0's last exit criterion, end to end: with the network disabled, the application
 * starts, scans, ingests and shows the dashboard, and makes no outbound connection.
 *
 * The real launcher runs under `offline-guard.mjs`, which refuses and records any TCP, DNS
 * or UDP use other than loopback. The test then does what a person does: opens the printed
 * address, exchanges the token for a session, submits the folder, reads the dashboard,
 * follows a report link and downloads the original file. It ends by reading the guard's
 * record, which must hold nothing but the line saying the guard was loaded.
 */

const BIN = path.resolve(import.meta.dirname, '..', 'bin', 'automate-local.mjs');
// A file URL, because --import reads a Windows absolute path as a URL scheme.
const GUARD = pathToFileURL(path.resolve(import.meta.dirname, 'offline-guard.mjs')).href;
const fixture = (name) => readFileSync(path.join(FILES_DIR, name));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Starts node under the guard with output redirected to files (a piped child hangs in some
 * sandboxes; see cli.test.mjs).
 *
 * @param {string[]} args
 * @param {string} directory
 */
function guarded(args, directory) {
  const log = path.join(directory, 'network.log');
  const out = path.join(directory, `out-${String(Math.random()).slice(2, 8)}.txt`);
  const fd = openSync(out, 'w');
  const child = spawn(process.execPath, ['--import', GUARD, ...args], {
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    env: { ...process.env, AUTOMATE_OFFLINE_LOG: log },
  });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  return {
    child,
    exited,
    output: () => readFileSync(out, 'utf8'),
    network: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []),
    done: () => closeSync(fd),
  };
}

/**
 * @param {number} port
 * @param {{ method?: string, path: string, headers?: Record<string, string>, body?: string }} request
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, body: Buffer }>}
 */
function call(port, request) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: request.method ?? 'GET',
        path: request.path,
        headers: { Host: `127.0.0.1:${String(port)}`, ...request.headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(request.body);
  });
}

/** @param {string} root */
function treeDigest(root) {
  const hash = createHash('sha256');
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const full = path.join(directory, name);
      const info = statSync(full);
      hash.update(`${path.relative(root, full)}|${String(info.mtimeMs)}|${String(info.size)}|`);
      if (info.isDirectory()) walk(full);
      else hash.update(readFileSync(full));
    }
  };
  walk(root);
  return hash.digest('hex');
}

test('the guard sees and refuses an outbound connection, a lookup and a fetch', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'automate-offline-'));
  try {
    const script = [
      "import net from 'node:net';",
      "import dns from 'node:dns';",
      "net.connect(80, '203.0.113.7').on('error', () => {});",
      "dns.lookup('example.invalid', () => {});",
      "await fetch('http://198.51.100.9/').catch(() => {});",
      'await new Promise((r) => setTimeout(r, 200));',
    ].join('\n');
    const proc = guarded(['--input-type=module', '-e', script], dir);
    assert.equal(await proc.exited, 0);
    proc.done();
    const lines = proc.network();
    assert.equal(lines[0], 'armed');
    assert.ok(lines.includes('tcp 203.0.113.7'), lines.join(' | '));
    assert.ok(lines.includes('dns example.invalid'), lines.join(' | '));
    assert.ok(lines.includes('tcp 198.51.100.9'), lines.join(' | '));
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('offline, the launcher starts, scans, ingests and shows the dashboard, and connects nowhere', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'automate-offline-'));
  const repo = path.join(dir, 'repo');
  mkdirSync(path.join(repo, 'reports'), { recursive: true });
  mkdirSync(path.join(repo, 'coverage'), { recursive: true });
  writeFileSync(path.join(repo, 'reports', 'junit.xml'), fixture('junit-basic.xml'));
  writeFileSync(path.join(repo, 'reports', 'zero.xml'), fixture('junit-zero-tests.xml'));
  writeFileSync(path.join(repo, 'coverage', 'lcov.info'), fixture('node-lcov.info'));
  writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ devDependencies: { vitest: '1' } }),
  );
  const before = treeDigest(repo);
  const proc = guarded([BIN, 'serve', '--data-dir', path.join(dir, 'data')], dir);
  try {
    let address = '';
    for (let attempt = 0; attempt < 200 && address === ''; attempt += 1) {
      address = /running at (http:\/\/127\.0\.0\.1:\d+\/#t=\S+)/.exec(proc.output())?.[1] ?? '';
      if (address === '') await delay(50);
    }
    assert.ok(address, `no address printed: ${proc.output()}`);
    const url = new URL(address);
    const port = Number(url.port);
    const token = new URLSearchParams(url.hash.slice(1)).get('t') ?? '';
    const origin = `http://127.0.0.1:${String(port)}`;

    // 1. The address opens the bootstrap page, which trades the token for a session.
    assert.equal((await call(port, { path: '/' })).status, 200);
    const session = await call(port, {
      method: 'POST',
      path: '/api/v1/session',
      headers: { Authorization: `Bearer ${token}`, Origin: origin },
    });
    assert.equal(session.status, 204);
    const cookie = String(session.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
    const browser = { Cookie: cookie };

    // 2. The folder form scans and lands on the dashboard.
    const submitted = await call(port, {
      method: 'POST',
      path: '/ui/repositories',
      headers: {
        ...browser,
        Origin: origin,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ path: repo }).toString(),
    });
    assert.equal(submitted.status, 303, submitted.body.toString());
    const dashboardPath = String(submitted.headers.location);
    assert.match(dashboardPath, /^\/repositories\/[0-9a-f]+$/);

    // 3. The dashboard shows the figures, the zero-test report, and links to its reports.
    const dashboard = await call(port, { path: dashboardPath, headers: browser });
    assert.equal(dashboard.status, 200);
    const html = dashboard.body.toString();
    assert.match(html, /First-pass rate/);
    assert.match(html, /87\.76%/);
    assert.match(html, /1 report contains no tests/);
    const reportLinks = [...html.matchAll(/href="(\/reports\/[0-9a-f]{64})"/g)].map((m) => m[1]);
    assert.equal(reportLinks.length, 3, 'one link per report read');

    // 4. Drill down: each report page lists what it holds and offers the original bytes.
    const expected = new Map(
      ['junit-basic.xml', 'junit-zero-tests.xml', 'node-lcov.info'].map((name) => [
        sha256(fixture(name)),
        fixture(name),
      ]),
    );
    for (const link of reportLinks) {
      const page = await call(port, { path: link ?? '', headers: browser });
      assert.equal(page.status, 200, link);
      const raw = /href="(\/api\/v1\/reports\/[0-9a-f]{64}\/raw)"/.exec(page.body.toString())?.[1];
      assert.ok(raw, `${String(link)} offers no original file`);
      const bytes = await call(port, { path: raw, headers: browser });
      assert.equal(bytes.status, 200);
      assert.deepEqual(bytes.body, expected.get(sha256(bytes.body)), raw);
    }
  } finally {
    proc.child.kill();
    await proc.exited;
    proc.done();
  }
  try {
    // 5. Nothing left loopback, and the repository is as it was.
    assert.deepEqual(proc.network(), ['armed']);
    assert.equal(treeDigest(repo), before);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
