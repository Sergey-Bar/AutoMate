#!/usr/bin/env node
import { HttpTuiApi, TuiError, gapView, scoreView } from './api.js';
import {
  buildCommand,
  isKnownCommand,
  printUsage,
  UnknownCommandError,
  MissingArgumentError,
} from './command-line.js';
import type { TuiView } from '@automate/shared-contracts';

/**
 * The entry point.
 *
 * ## It is a **reader**, not a shell
 *
 * There is no stdin parser, no `child_process`, and no key handler that builds an
 * argv. The whole interactive surface is: read one command name from `argv`, send
 * it to the API, print what came back. That is deliberate and it is the property the
 * whole package exists to guarantee — a terminal in a multi-repo install holds a
 * repository path, and an RCE surface for whoever holds it is not an acceptable
 * default for a QA dashboard.
 *
 * Every decision this makes lives in `command-line.ts`, which is unit-tested; what
 * is left here is the I/O, and I/O is the part that is hard to assert about and
 * cheap to read.
 */

const [commandName, ...rest] = process.argv.slice(2);

if (commandName === undefined || commandName === '--help' || commandName === '-h') {
  for (const line of printUsage()) process.stdout.write(`${line}\n`);
  process.exit(commandName === undefined ? 1 : 0);
}

if (!isKnownCommand(commandName)) {
  process.stderr.write(`Unknown command "${commandName}".\n\n`);
  for (const line of printUsage()) process.stderr.write(`${line}\n`);
  process.exit(2);
}

const baseUrl = process.env['AUTOMATE_API_URL'] ?? 'http://127.0.0.1:3000';
const api = new HttpTuiApi(baseUrl, fetch, process.env['AUTOMATE_API_TOKEN']);

try {
  const view = await api.send(buildCommand(commandName, rest));
  for (const line of render(view)) process.stdout.write(`${line}\n`);
} catch (error) {
  // The server's own words, not a synthesised summary. A terminal that prints
  // "request failed" for a 409 the API explained in words is hiding the only
  // sentence that would have helped.
  if (error instanceof MissingArgumentError || error instanceof UnknownCommandError) {
    process.stderr.write(`${error.message}\n\n`);
    for (const line of printUsage()) process.stderr.write(`${line}\n`);
    process.exit(2);
  }
  if (error instanceof TuiError) {
    process.stderr.write(`API answered ${String(error.status)}\n${error.detail}\n`);
    process.exit(1);
  }
  throw error;
}

/** The view was parsed by `HttpTuiApi`, so every field below is present. */
function render(view: TuiView): string[] {
  // A score is rendered through the score renderer, which puts the capping row on
  // the same line as the total. A gap list has no total, so it needs no limiter.
  if (view.total !== undefined) return [...scoreView(view), '', ...gapView(view)];
  return view.rows.map((row) => `  ${row.title.padEnd(40)}${row.detail}`);
}
