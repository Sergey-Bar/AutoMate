// Not a test. Prints the S4 results as a table so they can be reproduced on another host:
//
//   node spikes/local-feasibility/test/measure.mjs
//
// The rows for `taskkill-tree` are only meaningful where `taskkill` works. Where it exits
// non-zero the row says so instead of reporting survivors as if the approach had run.
import { alive, sleep, startTree, sweep, waitFor } from './tree-harness.mjs';

/** @param {string} line */
const print = (line) => process.stdout.write(`${line}\n`);

if (process.platform !== 'win32') {
  print('S4 measures Windows behaviour; nothing to do on this platform.');
  process.exit(0);
}

const cases = [
  ['naive-kill', 'direct', 'direct'],
  ['naive-kill', 'direct', 'cmd-shim'],
  ['taskkill-tree', 'direct', 'direct'],
  ['taskkill-tree', 'direct', 'cmd-shim'],
  ['taskkill-tree', 'ignore', 'direct'],
  ['taskkill-tree', 'orphan', 'direct'],
  ['taskkill-tree', 'storm', 'direct'],
  ['job-object', 'direct', 'direct'],
  ['job-object', 'direct', 'cmd-shim'],
  ['job-object', 'ignore', 'direct'],
  ['job-object', 'orphan', 'direct'],
  ['job-object', 'storm', 'direct'],
];

print(`node ${process.version} on ${process.platform} ${process.arch}`);
print('approach       variant  via       survivors                     ms     note');
for (const [approach, variant, via] of cases) {
  const tree = await startTree(approach, variant, /** @type {'direct' | 'cmd-shim'} */ (via));
  const before = tree.pids();
  const started = Date.now();
  const { taskkillExit } = await tree.handle.terminate();
  await waitFor(() => tree.pids().every((entry) => !alive(entry.pid)), 8000);
  const survivors = tree.pids().filter((entry) => alive(entry.pid));
  /** @type {Record<string, number>} */
  const roleCounts = {};
  for (const entry of survivors) roleCounts[entry.role] = (roleCounts[entry.role] ?? 0) + 1;
  const summary =
    Object.entries(roleCounts)
      .map(([role, count]) => (count > 1 ? `${role} x${String(count)}` : role))
      .join(', ') || '-';
  const note =
    approach === 'taskkill-tree' && taskkillExit !== 0
      ? `taskkill exited ${String(taskkillExit)}: this row is not a measurement of the approach`
      : '';
  print(
    `${approach.padEnd(14)} ${variant.padEnd(8)} ${via.padEnd(9)} ${summary.padEnd(29)} ${String(
      Date.now() - started,
    ).padEnd(6)} ${note}`,
  );
  sweep(tree.pids());
  await sleep(150);
  tree.dir.cleanup();
  if (before.length === 0) print('  (the tree did not start)');
}

// Launcher overhead: time from starting the command to its first recorded pid.
for (const approach of ['naive-kill', 'job-object']) {
  const samples = [];
  for (let run = 0; run < 3; run += 1) {
    const started = Date.now();
    const tree = await startTree(approach, 'direct', 'direct');
    samples.push(Date.now() - started);
    await tree.handle.terminate();
    sweep(tree.pids());
    await sleep(150);
    tree.dir.cleanup();
  }
  print(`start-up to a ready tree, ${approach}: ${samples.join(', ')} ms (three runs)`);
}
process.exit(0);
