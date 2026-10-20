// Not a test. Started by store.test.mjs, which kills it between the inserts and the commit
// to show that an ingest interrupted at its worst moment leaves nothing half-written.
import { readFileSync, writeFileSync } from 'node:fs';
import { openStore } from '../src/store.mjs';

const [directory, reportPath, markerPath] = process.argv.slice(2);
if (directory === undefined || reportPath === undefined || markerPath === undefined) {
  throw new Error('usage: crash-worker <store directory> <report> <marker file>');
}

const store = openStore(directory);
store.ingest(new Uint8Array(readFileSync(reportPath)), {
  observedAt: '2026-10-19T00:00:00Z',
  hooks: {
    beforeCommit() {
      // Every insert has run and nothing is committed. Tell the parent, then wait to be
      // killed. `Atomics.wait` blocks the thread without spinning.
      writeFileSync(markerPath, 'inserted, not committed');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    },
  },
});
