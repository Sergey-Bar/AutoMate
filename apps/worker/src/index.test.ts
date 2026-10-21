import { describe, expect, it } from 'vitest';
import * as entry from './index.js';
import * as config from './config.js';
import * as healthServer from './health-server.js';
import * as inMemoryStore from './in-memory-store.js';
import * as mainModule from './main.js';
import * as postgresStore from './postgres-store.js';
import * as scheduler from './scheduler.js';
import * as worker from './worker.js';

describe('the package entry', () => {
  it('re-exports every runtime export of every module, as the same binding', () => {
    // A module dropped from the barrel, or shadowed by a same-named export from
    // another module, is a break for every importer of `@automate/worker`.
    const modules = [
      config,
      healthServer,
      inMemoryStore,
      mainModule,
      postgresStore,
      scheduler,
      worker,
    ];
    const expected = Object.assign({}, ...modules) as Record<string, unknown>;

    expect(Object.keys(entry).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, value] of Object.entries(expected)) {
      expect((entry as Record<string, unknown>)[name], name).toBe(value);
    }
  });

  it('exposes the composition the deployment relies on', () => {
    expect(Object.keys(entry)).toEqual(
      expect.arrayContaining([
        'ExecutionWorker',
        'PostgresExecutionStore',
        'InMemoryExecutionStore',
        'WorkerHealthServer',
        'parseWorkerConfig',
        'pollSchedules',
        'main',
        'installProcessFailureHandlers',
      ]),
    );
  });
});
