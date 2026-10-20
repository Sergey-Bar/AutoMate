#!/usr/bin/env node
/**
 * The launcher.
 *
 *   automate-local serve [--data-dir <dir>] [--port <n>]
 *   automate-local scan <folder> [--data-dir <dir>]
 *   automate-local diagnostics [--data-dir <dir>]
 *
 * `serve` starts the engine and the local interface and prints the address to open. The
 * address carries a one-time token after the `#`, which a browser never sends to the server.
 * The token is also written to a file only the current user should be able to read.
 */
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { writeDiagnostics } from '../src/diagnostics.mjs';
import { createEngine } from '../src/engine.mjs';
import { createRunner } from '../src/runner.mjs';
import { findingsRoutes, importRoutes, runRoutes, toolboxRoutes } from '../src/routes.mjs';
import { startServer } from '../src/server.mjs';

/**
 * @param {string[]} args
 * @param {string} name
 */
function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function defaultDataDir() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'AutomateLocal');
  }
  return path.join(os.homedir(), '.automate-local');
}

/** @param {string} line */
const print = (line) => process.stdout.write(`${line}\n`);

/** @param {string[]} argv */
export async function main(argv) {
  const [command = 'serve', ...rest] = argv;
  const dataDir = path.resolve(option(rest, '--data-dir') ?? defaultDataDir());
  mkdirSync(dataDir, { recursive: true });
  const engine = createEngine({ dataDir });

  if (command === 'scan') {
    const target = rest.find((arg) => !arg.startsWith('--') && arg !== option(rest, '--data-dir'));
    if (target === undefined) {
      process.stderr.write('usage: automate-local scan <folder>\n');
      engine.close();
      return 2;
    }
    const result = await engine.scan(target);
    const dash = result.repositoryId ? engine.dashboard(result.repositoryId) : null;
    print(
      JSON.stringify({
        ...result,
        testsFound: dash?.kpis.testsFound,
        reports: dash?.kpis.reportsFound,
      }),
    );
    engine.close();
    return result.status === 'failed' ? 1 : 0;
  }

  if (command === 'diagnostics') {
    print(writeDiagnostics(engine, path.join(dataDir, 'diagnostics')));
    engine.close();
    return 0;
  }

  if (command === 'serve') {
    const port = Number(option(rest, '--port') ?? 0);
    const runner = createRunner({ engine, dataDir });
    const server = await startServer({
      engine,
      port,
      routes: [
        runRoutes({ engine, runner }),
        toolboxRoutes({ engine }),
        findingsRoutes({ engine }),
        importRoutes({ engine }),
      ],
    });
    const tokenFile = path.join(dataDir, 'token');
    writeFileSync(tokenFile, `${server.token}\n`, { mode: 0o600 });
    try {
      chmodSync(tokenFile, 0o600);
    } catch {
      // Windows ignores the mode; the file lives in the user's own profile.
    }
    print(`AUTOMATE (local) is running at ${server.bootstrapUrl}`);
    print(`Token file (readable by you only): ${tokenFile}`);
    print('Nothing leaves this computer. Press Ctrl+C to stop.');
    const stop = async () => {
      const active = runner.activeId();
      if (active !== null) {
        runner.cancel(active);
        await runner.whenDone(active);
      }
      await server.close();
      engine.close();
      process.exit(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return await new Promise(() => {});
  }

  process.stderr.write(`unknown command: ${command}\n`);
  engine.close();
  return 2;
}

if (
  import.meta.url === new URL(process.argv[1] ?? '', 'file://').href ||
  process.argv[1]?.endsWith('automate-local.mjs')
) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${String(error?.message ?? error)}\n`);
      process.exitCode = 1;
    },
  );
}
