import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { alive, recorded, scratch, startTree, sweep, waitFor } from './tree-harness.mjs';

const SUPERVISOR = path.resolve(import.meta.dirname, 'supervisor.mjs');
const WINDOWS = process.platform === 'win32';

if (!WINDOWS) {
  test('S4 is a Windows measurement; POSIX behaviour is documented and not tested here', () => {
    assert.notEqual(process.platform, 'win32');
  });
} else {
  /**
   * Ends a tree with an approach and reports who is still alive afterwards.
   *
   * @param {string} approach
   * @param {string} variant
   * @param {'direct' | 'cmd-shim'} via
   */
  async function terminateAndCount(approach, variant, via) {
    const tree = await startTree(approach, variant, via);
    try {
      const before = tree.pids();
      assert.ok(before.length >= 3, `the tree did not start: ${JSON.stringify(before)}`);
      const started = Date.now();
      await tree.handle.terminate();
      await waitFor(() => tree.pids().every((entry) => !alive(entry.pid)), 8000);
      return {
        elapsed: Date.now() - started,
        roles: before.map((entry) => entry.role),
        survivors: tree.pids().filter((entry) => alive(entry.pid)),
      };
    } finally {
      sweep(tree.pids());
      tree.dir.cleanup();
    }
  }

  test('baseline: killing only the child leaves a shim-launched tree running', async () => {
    // What apps/runner/src/generic-spawn.ts does today. The cmd.exe shim stands in for any
    // launcher that is not a Node process, such as the .cmd file a package manager installs.
    const result = await terminateAndCount('naive-kill', 'direct', 'cmd-shim');
    assert.deepEqual(
      result.survivors.map((entry) => entry.role).sort(),
      ['child', 'grandchild', 'root'],
      'every descendant of the shim survives',
    );
  });

  test('observed: an all-Node tree dies with its root, because Node ties its children to a job', async () => {
    // Not a guarantee to build on. It is an implementation detail of Node on Windows, it
    // does not extend past a non-Node launcher, and it is recorded so nobody is surprised
    // that the baseline above does not fail for a plain Node command.
    const result = await terminateAndCount('naive-kill', 'direct', 'direct');
    assert.deepEqual(result.survivors, []);
  });

  for (const [variant, via] of /** @type {Array<[string, 'direct' | 'cmd-shim']>} */ ([
    ['direct', 'direct'],
    ['direct', 'cmd-shim'],
    ['ignore', 'direct'],
    ['orphan', 'direct'],
    ['storm', 'direct'],
    ['storm', 'cmd-shim'],
  ])) {
    test(`job object: nothing survives (${variant}, ${via})`, async () => {
      const result = await terminateAndCount('job-object', variant, via);
      assert.deepEqual(result.survivors, [], `survivors after ${String(result.elapsed)} ms`);
      assert.ok(result.elapsed < 5000, `termination took ${String(result.elapsed)} ms`);
    });
  }

  /**
   * Starts a supervisor that starts the tree, kills the supervisor itself, and reports who
   * is left.
   *
   * @param {string} approach
   * @param {'direct' | 'cmd-shim'} via
   * @param {'attached' | 'detached'} attachment
   */
  async function killSupervisor(approach, via, attachment) {
    const dir = scratch('direct');
    const supervisor = spawn(
      process.execPath,
      [SUPERVISOR, approach, 'direct', via, attachment, dir.record, dir.shim],
      { stdio: 'ignore', windowsHide: true },
    );
    const exited = new Promise((resolve) => supervisor.once('exit', resolve));
    try {
      await waitFor(() => recorded(dir.record).length >= 3, 20_000);
      const before = recorded(dir.record);
      assert.ok(before.length >= 3, 'the tree did not start');
      supervisor.kill();
      await exited;
      await waitFor(() => before.every((entry) => !alive(entry.pid)), 6000);
      return recorded(dir.record).filter((entry) => alive(entry.pid));
    } finally {
      sweep(recorded(dir.record));
      dir.cleanup();
    }
  }

  test('supervisor killed: a shim-launched tree outlives it without a job object', async () => {
    const survivors = await killSupervisor('naive-kill', 'cmd-shim', 'attached');
    assert.deepEqual(survivors.map((entry) => entry.role).sort(), ['child', 'grandchild', 'root']);
  });

  test('supervisor killed: a detached tree outlives it without a job object', async () => {
    const survivors = await killSupervisor('naive-kill', 'direct', 'detached');
    assert.deepEqual(survivors.map((entry) => entry.role).sort(), ['child', 'grandchild', 'root']);
  });

  test('supervisor killed: with a job object nothing outlives it', async () => {
    assert.deepEqual(await killSupervisor('job-object', 'direct', 'attached'), []);
    assert.deepEqual(await killSupervisor('job-object', 'cmd-shim', 'attached'), []);
  });
}
