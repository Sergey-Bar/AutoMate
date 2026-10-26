#!/usr/bin/env node
import { run } from './cli.js';
import { readEnvironment } from './environment.js';

process.exitCode = await run(process.argv.slice(2), {
  env: readEnvironment(),
  cwd: process.cwd(),
  fetch: globalThis.fetch,
  now: () => new Date(),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
