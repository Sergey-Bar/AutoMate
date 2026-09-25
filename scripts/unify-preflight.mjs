import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Unified-platform preflight guard.
 *
 * After the big-bang consolidation, this script asserts that the repository is
 * a single unified workspace with NO remaining references to the legacy trees
 * (`AutoMate/`, `Automate-Dashboard/`) or the removed `apps/shell`. It never
 * throws on missing files (a missing legacy artifact is a PASS) and exits 0
 * only when every check passes, 1 otherwise.
 *
 * Matching is deliberately case-sensitive on the capitalized legacy path/dir
 * tokens ("Automate/", "AutoMate/", "Automate-Dashboard") so the lowercase
 * scoped packages (@automate/api, @automate/ui, ...) and the product brand
 * name "Automate" in prose are NOT flagged. The still-published external
 * reporter package `@automate/reporter` is intentionally allowed.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const abs = (rel) => path.join(repoRoot, rel);
const hasPath = (rel) => existsSync(abs(rel));
const readText = (rel) => (hasPath(rel) ? readFileSync(abs(rel), 'utf8') : null);

// Legacy references forbidden in build/CI/tooling/config files.
const CONFIG_FORBIDDEN = [
  // Catches legacy path references "Automate/...", "./Automate/" — but NOT the
  // "Automate" brand name (e.g. shields.io "Automate-blueviolet" badges or
  // "Automate —" prose) and NOT lowercase scoped packages "@automate/*".
  // "Automate-Dashboard" is caught by its own dedicated pattern below.
  { re: /(?<![@\w])Automate\//, label: 'legacy Automate/ path' },
  // Any @automate/* package NOT in the unified allowlist is a legacy reference.
  {
    re: /@automate\/(?!api\b|unified-web\b|ui\b|db\b|auth\b|realtime\b|shared-contracts\b|migrate-cli\b|integration-tests\b|reporter\b)[a-z][a-z0-9-]*/,
    label: 'non-allowlisted @automate/* package',
  },
  { re: /Automate-Dashboard/, label: 'legacy dir Automate-Dashboard' },
  { re: /AutoMate\//, label: 'legacy dir AutoMate/' },
  { re: /Automate\/dashboard/, label: 'nested legacy Automate/dashboard' },
  { re: /Automate\/(apps|packages|pnpm-lock|docs-site|reports)\b/, label: 'legacy Automate/<path>' },
  { re: /@automate\/dashboard-/, label: 'legacy package @automate/dashboard-*' },
  { re: /@automate\/shell\b/, label: 'legacy package @automate/shell' },
  { re: /(^|[^.\w])apps\/shell\b/, label: 'removed apps/shell' },
  { re: /\bcd\s+Automate\b/, label: 'cd Automate' },
  { re: /-C\s+Automate\b/, label: 'pnpm -C Automate' },
  { re: /working-directory:\s*Automate\b/, label: 'working-directory: Automate' },
  { re: /context:\s*\.{0,2}\/Automate\b/, label: 'docker context ./Automate' },
];

// Narrower set for docs: allow historical brand mentions, forbid stale
// operational instructions / legacy package + dir references.
const DOCS_FORBIDDEN = [
  { re: /Automate-Dashboard/, label: 'Automate-Dashboard' },
  { re: /Automate\/dashboard/, label: 'Automate/dashboard' },
  { re: /@automate\/dashboard-/, label: '@automate/dashboard-*' },
  { re: /(^|[^.\w])apps\/shell\b/, label: 'apps/shell' },
  { re: /\bcd\s+Automate\b/, label: 'cd Automate' },
];

const checks = [];
const addCheck = (name, ok, detail) => checks.push({ name, ok, detail });

function firstMatch(text, patterns) {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const { re, label } of patterns) {
      if (re.test(lines[i])) {
        return `line ${i + 1} [${label}]: ${lines[i].trim().slice(0, 120)}`;
      }
    }
  }
  return null;
}

function checkFileConfig(rel, name) {
  const text = readText(rel);
  if (text === null) {
    addCheck(name, true, `${rel} absent (ok)`);
    return;
  }
  const m = firstMatch(text, CONFIG_FORBIDDEN);
  addCheck(name, !m, m ? `${rel}: ${m}` : `${rel} clean`);
}

function walkFiles(relDir, filterRe) {
  const out = [];
  const root = abs(relDir);
  if (!existsSync(root)) return out;
  const stack = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (filterRe.test(entry.name)) out.push(full);
    }
  }
  return out;
}

// 1. Legacy directories removed from the working tree.
addCheck(
  'Legacy dir Automate-Dashboard removed',
  !hasPath('Automate-Dashboard'),
  hasPath('Automate-Dashboard') ? 'Automate-Dashboard/ still exists on disk' : 'absent',
);
addCheck(
  'Deprecated apps/shell removed',
  !hasPath('apps/shell'),
  hasPath('apps/shell') ? 'apps/shell/ still exists on disk' : 'absent',
);

// 2. Legacy CI workflows removed.
addCheck(
  'Legacy workflow ci-automate.yml removed',
  !hasPath('.github/workflows/ci-automate.yml'),
  hasPath('.github/workflows/ci-automate.yml') ? 'still present' : 'absent',
);
addCheck(
  'Legacy workflow ci-dashboard.yml removed',
  !hasPath('.github/workflows/ci-dashboard.yml'),
  hasPath('.github/workflows/ci-dashboard.yml') ? 'still present' : 'absent',
);

// 3. Workspace globs contain no legacy mounts.
{
  const text = readText('pnpm-workspace.yaml');
  const m = firstMatch(text, CONFIG_FORBIDDEN);
  addCheck('pnpm-workspace.yaml has no legacy globs', !m, m ? m : 'clean');
}

// 4. Root package.json has no legacy proxy scripts.
{
  const raw = readText('package.json');
  let bad = [];
  if (raw) {
    try {
      const json = JSON.parse(raw);
      const scripts = json.scripts ?? {};
      bad = Object.keys(scripts).filter((k) => /^(automate|dashboard):|:all$/.test(k));
      if (/-C\s+Automate\b/.test(String(scripts['security:scan'] ?? ''))) {
        bad.push('security:scan(-C Automate)');
      }
    } catch {
      bad = ['<package.json failed to parse>'];
    }
  }
  addCheck('package.json has no legacy scripts', bad.length === 0, bad.length ? bad.join(', ') : 'clean');
}

// 5. Root config files aligned to unified layout.
checkFileConfig('.prettierignore', '.prettierignore clean');
checkFileConfig('.husky/pre-commit', '.husky/pre-commit clean');
checkFileConfig('commitlint.config.js', 'commitlint.config.js clean');
checkFileConfig('.vscode/launch.json', '.vscode/launch.json clean');

// 6. Docker + nginx point at the unified stack only.
for (const f of [
  'docker-compose.yml',
  'docker-compose.unified.yml',
  'docker-compose.test.yml',
  'nginx.conf',
  'nginx/nginx.conf',
]) {
  checkFileConfig(f, `${f} clean`);
}

// 6b. Deployment assets under docker/** contain no legacy references.
{
  let bad = null;
  for (const full of walkFiles('docker', /\.(ya?ml|conf|sh)$/)) {
    const rel = path.relative(repoRoot, full).replace(/\\/g, '/');
    const m = firstMatch(readFileSync(full, 'utf8'), CONFIG_FORBIDDEN);
    if (m) {
      bad = `${rel}: ${m}`;
      break;
    }
  }
  addCheck('docker/** has no legacy references', !bad, bad ?? 'clean');
}

// 7. Remaining GitHub workflows have no legacy references.
{
  let bad = null;
  for (const full of walkFiles('.github/workflows', /\.ya?ml$/)) {
    const rel = path.relative(repoRoot, full).replace(/\\/g, '/');
    const m = firstMatch(readFileSync(full, 'utf8'), CONFIG_FORBIDDEN);
    if (m) {
      bad = `${rel}: ${m}`;
      break;
    }
  }
  addCheck('.github/workflows/* have no legacy references', !bad, bad ?? 'clean');
}

// 8. Docs describe a single unified product.
// Operational docs (how to build/run/deploy the product NOW) must be free of
// ALL legacy paths/packages. Planning/historical docs (strategy, PRD,
// architecture, migration/parity records) may reference legacy names as history.
{
  const isOperationalDoc = (rel) =>
    rel === 'README.md' ||
    rel === 'AGENTS.md' ||
    rel === 'docs/deployment.md' ||
    rel === 'docs/migration-guide.md' ||
    rel.startsWith('docs/operations/');
  const docFiles = [abs('README.md'), abs('AGENTS.md'), ...walkFiles('docs', /\.mdx?$/)];
  let bad = null;
  for (const full of docFiles) {
    if (!existsSync(full)) continue;
    const rel = path.relative(repoRoot, full).replace(/\\/g, '/');
    const operational = isOperationalDoc(rel);
    const patterns = operational ? CONFIG_FORBIDDEN : DOCS_FORBIDDEN;
    const m = firstMatch(readFileSync(full, 'utf8'), patterns);
    if (m) {
      bad = `${rel} [${operational ? 'operational' : 'historical'}]: ${m}`;
      break;
    }
  }
  addCheck('README/AGENTS/docs have no legacy references', !bad, bad ?? 'clean');
}

const passed = checks.filter((c) => c.ok).length;
const failed = checks.length - passed;

console.log('Automate unification preflight (unified-only guard)');
console.log('===================================================');
console.log(`Checks: ${passed} passed, ${failed} failed`);
console.log('');
for (const c of checks) {
  console.log(`[${c.ok ? 'PASS' : 'FAIL'}] ${c.name}`);
  console.log(`       ${c.detail}`);
}
console.log('');
if (failed === 0) {
  console.log('Unified-only workspace: no legacy references detected.');
} else {
  console.log(`Found ${failed} unresolved legacy reference(s) above. Prune them to land the unification.`);
}

process.exit(failed === 0 ? 0 : 1);
