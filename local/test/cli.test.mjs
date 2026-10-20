import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { FILES_DIR } from './support.mjs';
import { URL, URLSearchParams } from 'node:url';

const BIN = path.resolve(import.meta.dirname, '..', 'bin', 'automate-local.mjs');
const fixture = (name) => readFileSync(path.join(FILES_DIR, name));

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'automate-cli-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }) };
}

/**
 * Runs the launcher with output redirected to files, because a piped child hangs in the
 * sandbox this was written in.
 *
 * @param {string[]} args
 * @param {string} directory
 */
function run(args, directory) {
  const out = path.join(directory, `out-${String(Math.random()).slice(2, 8)}.txt`);
  const fd = openSync(out, 'w');
  const child = spawn(process.execPath, [BIN, ...args], {
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  return { child, exited, output: () => readFileSync(out, 'utf8'), done: () => closeSync(fd) };
}

test('scan prints a summary and leaves the folder untouched', async () => {
  const s = scratch();
  try {
    const repo = path.join(s.dir, 'repo');
    mkdirSync(path.join(repo, 'reports'), { recursive: true });
    writeFileSync(path.join(repo, 'reports', 'junit.xml'), fixture('junit-basic.xml'));
    const proc = run(['scan', repo, '--data-dir', path.join(s.dir, 'data')], s.dir);
    assert.equal(await proc.exited, 0);
    proc.done();
    const summary = JSON.parse(proc.output().trim().split('\n').at(-1) ?? '{}');
    assert.equal(summary.status, 'complete');
    assert.equal(summary.testsFound.value, 4);
    assert.deepEqual(readdirSync(repo).sort(), ['reports']);
  } finally {
    s.cleanup();
  }
});

test('scan of a missing folder exits non-zero with a reason', async () => {
  const s = scratch();
  try {
    const proc = run(
      ['scan', path.join(s.dir, 'nope'), '--data-dir', path.join(s.dir, 'data')],
      s.dir,
    );
    assert.equal(await proc.exited, 1);
    proc.done();
    assert.match(proc.output(), /not-a-directory/);
  } finally {
    s.cleanup();
  }
});

test('serve prints an address with the token after the #, writes a token file, and answers', async () => {
  const s = scratch();
  const data = path.join(s.dir, 'data');
  const proc = run(['serve', '--data-dir', data], s.dir);
  try {
    let url = '';
    for (let attempt = 0; attempt < 100 && url === ''; attempt += 1) {
      url = /running at (http:\/\/127\.0\.0\.1:\d+\/#t=\S+)/.exec(proc.output())?.[1] ?? '';
      if (url === '') await delay(50);
    }
    assert.ok(url, `no address printed: ${proc.output()}`);
    const parsed = new URL(url);
    const token = new URLSearchParams(parsed.hash.slice(1)).get('t') ?? '';
    assert.equal(readFileSync(path.join(data, 'token'), 'utf8').trim(), token);
    const status = await new Promise((resolve, reject) => {
      http
        .get(
          {
            host: '127.0.0.1',
            port: Number(parsed.port),
            path: '/api/v1/health',
            headers: { Authorization: `Bearer ${token}` },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
          },
        )
        .on('error', reject);
    });
    assert.equal(status, 200);
    assert.match(proc.output(), /Nothing leaves this computer/);
  } finally {
    proc.child.kill();
    await proc.exited;
    proc.done();
    s.cleanup();
  }
});

test('diagnostics are a file the user reads first, with no personal data', async () => {
  const s = scratch();
  try {
    const repo = path.join(s.dir, 'repo');
    mkdirSync(path.join(repo, 'reports'), { recursive: true });
    writeFileSync(path.join(repo, 'reports', 'junit.xml'), fixture('node-junit.xml'));
    const data = path.join(s.dir, 'data');
    const scan = run(['scan', repo, '--data-dir', data], s.dir);
    assert.equal(await scan.exited, 0);
    scan.done();
    const diag = run(['diagnostics', '--data-dir', data], s.dir);
    assert.equal(await diag.exited, 0);
    diag.done();
    const file = diag.output().trim().split('\n').at(-1) ?? '';
    const text = readFileSync(file, 'utf8');
    assert.ok(text.includes('Review this file before sharing'));
    assert.ok(!text.includes(repo), 'the repository path leaked');
    assert.ok(!text.includes(s.dir), 'a temp path leaked');
    assert.ok(!text.toLowerCase().includes(os.hostname().toLowerCase()), 'the host name leaked');
    assert.ok(!/[A-Za-z]:[\\/]/.test(text), 'an absolute path leaked');
  } finally {
    s.cleanup();
  }
});
