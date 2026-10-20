// Not a test. Helpers for the S4 tests: build the tree, read the pids it recorded, and ask
// the operating system which are still alive.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { launch } from '../src/proctree.mjs';

export const FIXTURE = path.resolve(import.meta.dirname, 'tree-fixture.mjs');

/** @param {number} ms */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {number} pid
 * @returns {boolean}
 */
export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and is not ours to signal; only ESRCH means gone.
    return /** @type {{ code?: string }} */ (error).code === 'EPERM';
  }
}

/**
 * @param {string} record
 * @returns {Array<{ role: string, pid: number }>}
 */
export function recorded(record) {
  if (!existsSync(record)) return [];
  return readFileSync(record, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [role, pid] = line.split(' ');
      return { role: role ?? '', pid: Number(pid) };
    });
}

/**
 * @param {() => boolean} predicate
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(25);
  }
  return predicate();
}

/**
 * Makes a scratch directory with a `.cmd` shim that runs the fixture, the way a package
 * manager's launcher shim does.
 *
 * @param {string} variant
 * @returns {{ directory: string, record: string, shim: string, cleanup: () => void }}
 */
export function scratch(variant) {
  const directory = mkdtempSync(path.join(tmpdir(), 'automate-tree-'));
  const record = path.join(directory, 'pids.txt');
  const shim = path.join(directory, 'shim.cmd');
  writeFileSync(
    shim,
    `@echo off\r\n"${process.execPath}" "${FIXTURE}" root "${record}" ${variant}\r\n`,
  );
  mkdirSync(directory, { recursive: true });
  return {
    directory,
    record,
    shim,
    cleanup() {
      // Anything still running from this scratch directory is ended first.
      for (const { pid } of recorded(record)) {
        try {
          process.kill(pid);
        } catch {
          // already gone
        }
      }
      rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

/**
 * Starts the tree under an approach.
 *
 * @param {string} approach
 * @param {string} variant
 * @param {'direct' | 'cmd-shim'} via
 * @param {{ detached?: boolean }} [options]
 */
export async function startTree(approach, variant, via, options = {}) {
  const dir = scratch(variant);
  const handle =
    via === 'cmd-shim'
      ? launch({
          approach,
          file: 'cmd.exe',
          args: ['/d', '/s', '/c', `"${dir.shim}"`],
          detached: options.detached,
          options: { windowsVerbatimArguments: true },
        })
      : launch({
          approach,
          file: process.execPath,
          args: [FIXTURE, 'root', dir.record, variant],
          detached: options.detached,
        });
  const expected = variant === 'orphan' ? 3 : variant === 'storm' ? 4 : 3;
  await waitFor(() => recorded(dir.record).length >= expected, 20_000);
  return { dir, handle, pids: () => recorded(dir.record) };
}

/**
 * Ends every process still running from a tree, so a failed test cannot leave a mess.
 *
 * @param {Array<{ pid: number }>} pids
 */
export function sweep(pids) {
  for (const { pid } of pids) {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  }
}

export { spawn };
