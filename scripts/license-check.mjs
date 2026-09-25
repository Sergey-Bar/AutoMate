import { spawnSync } from 'node:child_process';

const workspaces = [
  'apps/api',
  'apps/web',
  'packages/auth',
  'packages/db',
  'packages/realtime',
  'packages/shared-contracts',
  'packages/ui',
  'apps/runner',
  'packages/automation',
  'packages/connectors/github',
  'packages/connectors/jira',
  'packages/connectors/sdk',
  'packages/connectors/slack',
  'packages/orchestration',
  'packages/reporter',
  'packages/reporting',
  'packages/runner-sdk',
  'tools/migrate-cli',
];
const forbiddenLicenses = 'GPL-3.0;AGPL-3.0';

function runPnpm(args) {
  if (process.env['npm_execpath']) {
    return spawnSync(process.execPath, [process.env['npm_execpath'], ...args], { stdio: 'inherit' });
  }

  if (process.platform === 'win32') {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', 'pnpm', ...args], { stdio: 'inherit' });
  }

  return spawnSync('pnpm', args, { stdio: 'inherit' });
}

for (const workspace of workspaces) {
  console.info(`Checking production licenses for ${workspace}`);
  const result = runPnpm(['--dir', workspace, 'exec', 'license-checker-evergreen', '--production', '--failOn', forbiddenLicenses]);

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
