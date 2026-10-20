// Not a test. A command for the runner tests to run.
//
// usage: node runner-fixture.mjs <mode> [arguments]
//   exit <code>                 exit with a code
//   print <text>                write text to stdout and exit 0
//   args                        write the arguments it received, as JSON, to stdout
//   env                         write the environment variable names it received, as JSON
//   getenv <name>               write the value of one variable to stdout
//   pwd                         write the working directory
//   sleep                       stay alive until killed
//   tree <record>               start a three-process tree (tree-fixture) and stay alive
//   flood                       write to stdout without stopping
//   report <path> <source>      write a copy of a file (new modification time) to a path, exit 0
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setInterval } from 'node:timers';

const [mode, ...rest] = process.argv.slice(2);

if (mode === 'exit') {
  process.exit(Number(rest[0] ?? 0));
} else if (mode === 'print') {
  process.stdout.write(`${rest.join(' ')}\n`);
} else if (mode === 'args') {
  process.stdout.write(JSON.stringify(rest));
} else if (mode === 'env') {
  process.stdout.write(JSON.stringify(Object.keys(process.env).sort()));
} else if (mode === 'getenv') {
  process.stdout.write(`${process.env[rest[0] ?? ''] ?? '(unset)'}\n`);
} else if (mode === 'pwd') {
  process.stdout.write(process.cwd());
} else if (mode === 'sleep') {
  process.stdout.write('started\n');
  setInterval(() => {}, 1000);
} else if (mode === 'tree') {
  const record = rest[0] ?? '';
  spawn(
    process.execPath,
    [path.resolve(import.meta.dirname, 'tree-fixture.mjs'), 'root', record, 'direct'],
    {
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  setInterval(() => {}, 1000);
} else if (mode === 'flood') {
  const chunk = 'x'.repeat(1024) + '\n';
  const pump = () => {
    while (process.stdout.write(chunk)) {
      // keep writing until the pipe or file pushes back
    }
    process.stdout.once('drain', pump);
  };
  pump();
} else if (mode === 'report') {
  const [target = '', source = ''] = rest;
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(source));
}
