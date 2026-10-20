// Not a test. A process tree for the S4 tests: root, child, grandchild, each recording its
// pid in a file so the parent never has to enumerate processes.
//
// usage: node tree-fixture.mjs <role> <record file> <variant>
//   roles:    root | child | grandchild | spawner | idle
//   variants: direct | orphan | ignore | storm
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { setInterval } from 'node:timers';

const [role, record, variant = 'direct'] = process.argv.slice(2);
if (role === undefined || record === undefined)
  throw new Error('usage: tree-fixture <role> <record> [variant]');
appendFileSync(record, `${role} ${String(process.pid)}\n`);

const self = path.resolve(import.meta.dirname, 'tree-fixture.mjs');
/**
 * @param {string} childRole
 * @param {{ detached?: boolean }} [options]
 */
const start = (childRole, options = {}) => {
  const child = spawn(process.execPath, [self, childRole, record, variant], {
    stdio: 'ignore',
    windowsHide: true,
    detached: options.detached === true,
  });
  if (options.detached === true) child.unref();
  return child;
};

const keepAlive = () => setInterval(() => {}, 1000);

if (role === 'root') {
  start('child');
  keepAlive();
} else if (role === 'child') {
  if (variant === 'orphan') {
    // Start a grandchild and exit, so the grandchild's parent no longer exists.
    start('grandchild', { detached: true });
    setTimeout(() => process.exit(0), 300);
  } else {
    start(variant === 'storm' ? 'spawner' : 'grandchild');
    keepAlive();
  }
} else if (role === 'grandchild') {
  if (variant === 'ignore') {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) process.on(signal, () => {});
  }
  keepAlive();
} else if (role === 'spawner') {
  // A process that keeps creating children, to race a termination that walks the tree once.
  setInterval(() => start('idle'), 15);
  keepAlive();
} else if (role === 'idle') {
  keepAlive();
}
