import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const cwd = process.cwd();

function detectPackageManager(): 'pnpm' | 'yarn' | 'npm' {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function findPlaywrightConfig(): string | null {
  for (const name of ['playwright.config.ts', 'playwright.config.js']) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function patchConfig(configPath: string): boolean {
  const content = fs.readFileSync(configPath, 'utf8');
  if (content.includes('@automate/reporter')) {
    console.log('  ✓ @automate/reporter already in config');
    return false;
  }

  const match = content.match(/reporter\s*:\s*\[/);
  if (!match || match.index === undefined) {
    console.log('  ⚠ Could not find reporter array — add manually:');
    console.log("    reporter: [['list'], ['@automate/reporter']]");
    return false;
  }

  const insertAt = match.index + match[0].length;
  const updated = content.slice(0, insertAt) + "\n    ['@automate/reporter']," + content.slice(insertAt);
  fs.writeFileSync(configPath, updated, 'utf8');
  return true;
}

export function run(): void {
  console.log('⚡ Automate Setup\n');

  const pm = detectPackageManager();
  const installCmd = { pnpm: 'pnpm add -D', yarn: 'yarn add -D', npm: 'npm install -D' }[pm];
  console.log(`1. Installing @automate/reporter (${pm})...`);
  try {
    execSync(`${installCmd} @automate/reporter`, { stdio: 'inherit', cwd });
    console.log('  ✓ Installed\n');
  } catch {
    console.log('  ⚠ Install failed — run manually: npm install -D @automate/reporter\n');
  }

  const config = findPlaywrightConfig();
  if (config) {
    console.log(`2. Updating ${path.basename(config)}...`);
    const patched = patchConfig(config);
    if (patched) console.log('  ✓ Added @automate/reporter to config\n');
  } else {
    console.log('2. No playwright.config found — add reporter manually:\n');
    console.log("   reporter: [['list'], ['@automate/reporter']]\n");
  }

  console.log('3. Run your tests with:\n');
  console.log('   AUTOMATE_DASHBOARD_URL=http://localhost:4000 npx playwright test\n');
  console.log('Done! Open http://localhost:4000 to see results.');
}
