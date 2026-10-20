// Not a test. Plays the part of the product's runner for the "supervisor is killed" case in
// S4: it starts a process tree under an approach and then idles until the test kills it.
//
// usage: node supervisor.mjs <approach> <variant> <direct|cmd-shim> <detached|attached> <record> <shim>
import path from 'node:path';
import { setInterval } from 'node:timers';
import { launch } from '../src/proctree.mjs';

const [approach, variant, via, attachment, record, shim] = process.argv.slice(2);
if (record === undefined || shim === undefined) throw new Error('usage: see the header comment');
const fixture = path.resolve(import.meta.dirname, 'tree-fixture.mjs');

launch(
  via === 'cmd-shim'
    ? {
        approach: approach ?? 'naive-kill',
        file: 'cmd.exe',
        args: ['/d', '/s', '/c', `"${shim}"`],
        detached: attachment === 'detached',
        options: { windowsVerbatimArguments: true },
      }
    : {
        approach: approach ?? 'naive-kill',
        file: process.execPath,
        args: [fixture, 'root', record, variant ?? 'direct'],
        detached: attachment === 'detached',
      },
);
setInterval(() => {}, 1000);
