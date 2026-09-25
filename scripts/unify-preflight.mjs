import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok, detail });
const abs = (relativePath) => path.join(repoRoot, relativePath);
const read = (relativePath) =>
  existsSync(abs(relativePath)) ? readFileSync(abs(relativePath), 'utf8') : '';

function gitFiles() {
  try {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function walk(relativePath, onFile) {
  const root = abs(relativePath);
  if (!existsSync(root)) return;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (
          !['.git', '.kilo', 'node_modules', 'dist', 'build', 'coverage', 'test-results'].includes(
            entry.name,
          )
        ) {
          stack.push(fullPath);
        }
      } else {
        onFile(fullPath);
      }
    }
  }
}

for (const relativePath of [
  'AutoMate',
  'Automate',
  'Automate-Dashboard',
  'apps/shell',
  'docker',
  'nginx',
  'apps/api/Dockerfile',
  'apps/web/Dockerfile',
  'docker-compose.yml',
  'docker-compose.test.yml',
]) {
  add(
    `${relativePath} is absent`,
    !existsSync(abs(relativePath)),
    existsSync(abs(relativePath)) ? 'present' : 'absent',
  );
}
add(
  'canonical unified compose exists',
  existsSync(abs('docker-compose.unified.yml')),
  existsSync(abs('docker-compose.unified.yml')) ? 'present' : 'missing',
);
const unifiedCompose = read('docker-compose.unified.yml');
for (const service of ['postgres:', 'migrate:', 'api:', 'worker:', 'runner:', 'web:']) {
  add(
    `unified compose defines ${service.replace(':', '')}`,
    unifiedCompose.includes(service),
    unifiedCompose.includes(service) ? 'present' : 'missing',
  );
}
add(
  'unified compose persists artifacts',
  unifiedCompose.includes('artifact_data:'),
  unifiedCompose.includes('artifact_data:') ? 'present' : 'missing',
);

const tracked = gitFiles();
const generatedPattern =
  /(^|\/)(dist|build|coverage|test-results|playwright-report|blob-report|__pycache__|var)(\/|$)|(^|\/)(\.sisyphus|\.artifacts)(\/|$)|\.pyc$/;
const generatedTracked = tracked.filter(
  (file) => generatedPattern.test(file) && existsSync(abs(file)),
);
add(
  'generated paths are untracked',
  generatedTracked.length === 0,
  generatedTracked.join(', ') || 'none',
);

const nestedLocks = [];
walk('.', (file) => {
  const relative = path.relative(repoRoot, file).replaceAll('\\', '/');
  if (
    relative !== 'pnpm-lock.yaml' &&
    ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb'].includes(path.basename(file))
  ) {
    nestedLocks.push(relative);
  }
});
add(
  'workspace has one dependency lockfile',
  nestedLocks.length === 0,
  nestedLocks.join(', ') || 'none',
);

const nestedRepositories = [];
const duplicateAuthorities = [];
const authorityNames = new Set([
  'pnpm-workspace.yaml',
  'turbo.json',
  'eslint.config.js',
  '.prettierrc',
  'tsconfig.base.json',
]);
function scanBoundaries(relativePath, depth = 0) {
  const current = abs(relativePath);
  if (!existsSync(current)) return;
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    const relative = path.relative(repoRoot, fullPath).replaceAll('\\', '/');
    if (entry.name === '.git' && depth > 0) {
      nestedRepositories.push(relative);
      continue;
    }
    if (entry.isDirectory()) {
      if (
        !['.kilo', 'node_modules', 'dist', 'build', 'coverage', 'test-results'].includes(entry.name)
      ) {
        scanBoundaries(relative, depth + 1);
      }
    } else if (depth > 0 && authorityNames.has(entry.name)) {
      const text = readFileSync(fullPath, 'utf8');
      if (entry.name === 'eslint.config.js' && text.includes('export { default }')) continue;
      duplicateAuthorities.push(relative);
    }
  }
}
scanBoundaries('.');
add(
  'nested repositories are absent',
  nestedRepositories.length === 0,
  nestedRepositories.join(', ') || 'none',
);
add(
  'nested tool authorities are absent',
  duplicateAuthorities.length === 0,
  duplicateAuthorities.join(', ') || 'none',
);

const skippedTests = tracked
  .filter((file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file))
  .filter((file) => /\.(skip|only)\s*\(/.test(read(file)));
add(
  'tests do not use .skip or .only',
  skippedTests.length === 0,
  skippedTests.join(', ') || 'none',
);

let packageJson = {};
try {
  packageJson = JSON.parse(read('package.json'));
} catch {
  add('package.json parses', false, 'invalid JSON');
}
add('package.json parses', Boolean(packageJson.name), packageJson.name || 'missing name');

const requiredScripts = [
  'format:check',
  'lint',
  'typecheck',
  'test',
  'build',
  'test:e2e',
  'unify:preflight',
  'verify',
];
const scripts = packageJson.scripts ?? {};
const missingScripts = requiredScripts.filter((name) => typeof scripts[name] !== 'string');
add(
  'root command surface is complete',
  missingScripts.length === 0,
  missingScripts.join(', ') || 'complete',
);

const workspace = read('pnpm-workspace.yaml');
for (const glob of ['apps/*', 'packages/*', 'packages/connectors/*', 'tools/*', 'tests/*']) {
  add(
    `workspace includes ${glob}`,
    workspace.includes(`- '${glob}'`) || workspace.includes(`- "${glob}"`),
    workspace.includes(glob) ? 'present' : 'missing',
  );
}

const ignoreLines = read('.gitignore')
  .split(/\r?\n/)
  .map((line) => line.trim());
add(
  'legacy ignore is root-anchored',
  ignoreLines.includes('/AutoMate/') && !ignoreLines.includes('Automate/'),
  ignoreLines.includes('/AutoMate/') ? 'root rule present' : 'root rule missing',
);

add('root Playwright config exists', existsSync(abs('playwright.config.ts')), 'required');
add(
  'duplicate Playwright config is absent',
  !existsSync(abs('e2e/integration/playwright.config.ts')),
  'child config must be removed',
);

const router = read('apps/web/src/router.ts');
add(
  'web route graph has no ignored child imports',
  !router.includes('routes/automate/'),
  'ignored child route imports are absent',
);
add(
  'ignored automate child directory is absent',
  !existsSync(abs('apps/web/src/routes/automate')),
  'no ignored source dependency is present',
);

const forbiddenScripts = ['automation:score', 'docker:smoke', 'automate:all', 'dashboard:all'];
const presentForbiddenScripts = forbiddenScripts.filter((name) => name in scripts);
add(
  'obsolete root scripts are absent',
  presentForbiddenScripts.length === 0,
  presentForbiddenScripts.join(', ') || 'none',
);

for (const file of [
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json',
  '.github/workflows/unified-ci.yml',
]) {
  const text = read(file);
  const hasLegacy = /(^|[^\w])AutoMate\//.test(text) || /Automate-Dashboard\//.test(text);
  add(`${file} has no legacy mount`, !hasLegacy, hasLegacy ? 'legacy mount found' : 'clean');
}

const workflowDirectory = abs('.github/workflows');
const workflowFiles = existsSync(workflowDirectory)
  ? readdirSync(workflowDirectory).filter((file) => file.endsWith('.yml'))
  : [];
const obsoleteWorkflows = workflowFiles.filter((file) =>
  ['publish-docker.yml', 'runner.yml', 'integration.yml'].includes(file),
);
add(
  'obsolete or duplicate workflows are absent',
  obsoleteWorkflows.length === 0,
  obsoleteWorkflows.join(', ') || 'none',
);
const workflowText = workflowFiles.map((file) => read(`.github/workflows/${file}`)).join('\n');
const mutableActions = workflowText.match(/uses:\s*[^\s@]+@(?:v\d+|main|master)/g) ?? [];
add(
  'GitHub Actions are pinned to commit SHAs',
  mutableActions.length === 0,
  mutableActions.join(', ') || 'all pinned',
);
add(
  'workflows use the root Playwright command',
  !workflowText.includes('npx playwright') &&
    !workflowText.includes('working-directory: e2e/integration'),
  workflowText.includes('npx playwright')
    ? 'child Playwright invocation found'
    : 'root command surface only',
);

const passed = checks.filter((check) => check.ok).length;
const failed = checks.length - passed;
console.info('Unified repository boundary preflight');
console.info(`Checks: ${passed} passed, ${failed} failed`);
for (const check of checks) {
  console.info(`[${check.ok ? 'PASS' : 'FAIL'}] ${check.name}`);
  console.info(`       ${check.detail}`);
}
process.exit(failed === 0 ? 0 : 1);
