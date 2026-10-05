#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const tscPath = resolve(
  'node_modules/.pnpm/@typescript+typescript-win32-x64@7.0.2/node_modules/@typescript/typescript-win32-x64/lib/tsc.exe',
);
const args = process.argv.slice(2);
const result = spawnSync(tscPath, args, { stdio: 'inherit', shell: true });
process.exitCode = result.status ?? 0;
